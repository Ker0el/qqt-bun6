import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WaterMatch} from '../public/water11.mjs';
import {Match,RULES} from '../public/engine.mjs';
import {hiddenInWater,waterElementPosition} from '../public/water-visuals.mjs';
const map=JSON.parse(readFileSync(new URL('../public/assets/water11.json',import.meta.url)));
function setup(){const m=new WaterMatch(map,false,719),p=m.addPlayer('p','水手测试',0);m.start();for(let i=0;i<510;i++)m.tick();p.shieldUntil=1e9;return[m,p]}
test('partially entered caves allow inward correction and vertical exit',()=>{
 const[m,p]=setup();m.bombs=[];
 for(const h of map.objects.filter(o=>o.id===5010))for(const side of [-1,1]){
  p.x=h.x+.5+side*.3;p.y=h.y+.1;
  assert(m.canMove(p,p.x-side*.03,p.y,side<0?'right':'left'),'must allow correction toward cave centre');
  assert(!m.canMove(p,p.x+side*.03,p.y,side<0?'left':'right'),'must retain the side wall');
  p.input.dir='down';for(let i=0;i<100;i++)m.move(p,1/120);
  assert(p.y>h.y+1,'must leave through the lower opening');
 }
});
test('native image anchors align with collision cells',()=>{
 for(const o of map.objects){const pos=waterElementPosition(o);assert.equal(pos.x+o.offset[0],o.x*40);assert.equal(pos.y+o.offset[1],o.y*40);}
 const ice=map.objects.find(o=>o.id===5002);assert.equal(waterElementPosition(ice).x,ice.x*40-5);
});
test('players overlapping a new sailor bomb can leave but cannot walk back through it',()=>{
 for(const dir of ['up','down','left','right']){
  const[m,p]=setup();m.blocks.fill(0);m.bombs=[];p.x=7.5;p.y=3.5;
  Object.assign(m.boss,{x:p.x,y:p.y,nextBomb:0});assert(m.bossBomb());
  const bomb=m.bombs[0];assert(p.passes.includes(bomb.id));
  p.input.dir=dir;for(let i=0;i<40;i++)m.move(p,1/120);
  assert(Math.hypot(p.x-7.5,p.y-3.5)>1);assert(!p.passes.includes(bomb.id));
  const opposite={up:'down',down:'up',left:'right',right:'left'}[dir];p.input.dir=opposite;
  for(let i=0;i<40;i++)m.move(p,1/120);
  assert(Math.hypot(p.x-7.5,p.y-3.5)>.9);
 }
});
test('off-centre vertical approaches gently align with both cave openings',()=>{
 const[m,p]=setup();m.bombs=[];
 for(const h of map.objects.filter(o=>o.id===5010))for(const offset of [-.55,.55])for(const dir of ['up','down']){
  p.x=h.x+.5+offset;p.y=dir==='down'?h.y-.7:h.y+1.7;p.input.dir=dir;p.slideDir=null;
  for(let i=0;i<50;i++)m.move(p,1/120);
  assert(Math.abs(p.x-h.x-.5)<.04,`entry not aligned: ${p.x}`);
  assert(dir==='down'?p.y>h.y:p.y<h.y+1,'must enter without sticking');
 }
});
test('turning sideways near either cave opening slides out rather than sticking',()=>{
 const[m,p]=setup();m.blocks.fill(0);m.bombs=[];
 for(const h of map.objects.filter(o=>o.id===5010))for(const edge of [-1,1])for(const dir of ['left','right']){
  p.x=h.x+.5;p.y=edge<0?h.y-.1:h.y+1.1;p.input.dir=dir;
  for(let i=0;i<90;i++)m.move(p,1/120);
  assert(dir==='left'?p.x<h.x-.5:p.x>h.x+1.5);
 }
});
test('both players and sailor hide inside either cave and reappear on exit',()=>{
 const holes=map.objects.filter(o=>o.id===5010);assert.equal(holes.length,2);
 for(const h of holes)for(const id of ['p','sailor']){
  assert.equal(hiddenInWater(map,{id,x:h.x+.5,y:h.y+.5}),true);
  assert.equal(hiddenInWater(map,{id,x:h.x+.5,y:h.y+1.01}),false);
 }
 // 糖泡按格心判定：渲染侧传的是 {x:b.x+.5,y:b.y+.5}，和人物走同一套判据
 const hole=holes[0];
 assert.equal(hiddenInWater(map,{id:'bomb',x:hole.x+.5,y:hole.y+.5}),true);
 assert.equal(hiddenInWater(map,{id:'bomb',x:hole.x+.5,y:hole.y+1+.5}),false);
});
test('touching sailor only kills players already trapped',()=>{
 const[m,p]=setup();m.bombs=[];m.boss.phase='wait';m.boss.path=[];m.boss.thinkAt=m.time+10;m.boss.nextGlue=m.time+10;
 p.x=m.boss.x;p.y=m.boss.y;p.shieldUntil=0;m.tickBoss(1/120);assert.equal(p.status,'alive');
 p.status='trapped';p.trappedUntil=m.time+5;m.tickBoss(1/120);assert.equal(p.status,'dead');
});
test('water11 uses original footprint geometry and open spawn cells',()=>{
 assert.equal(map.nativeLayers.length,3);assert.equal(map.blocks.length,195);assert.equal(map.objects.length,63);
 for(const[x,y]of map.spawns)assert.equal(map.blocks[y*15+x],0);
 assert(map.objects.some(o=>o.w===4&&o.h===2));
});
test('boss loot is limited, flies before pickup, and is generated only once',()=>{
 const[m,p]=setup();m.random=()=>0;m.boss.hp=0;m.dropBossLoot();
 const loot=m.items.filter(i=>['rose','chest','luckybag','kubi'].includes(i.kind));assert.equal(loot.length,4);
 assert.equal(new Set(loot.map(i=>`${i.x},${i.y}`)).size,loot.length);
 for(const item of loot){assert(!m.solid(item.x,item.y));assert(item.availableAt>m.time);assert.equal(item.flight.x,m.boss.x);}
 m.dropBossLoot();assert.equal(m.items.length,4);
 const rose=loot[0];p.x=rose.x+.5;p.y=rose.y+.5;m.objectives(p);assert(!p.rewards.rose);
 m.time=rose.availableAt;m.objectives(p);assert.equal(p.rewards.rose,1);assert.equal(m.placeBomb(p),false);
 m.time=m.boss.rewardUntil;m.tick();assert.equal(m.state,'finished');assert.equal(m.winner,0);
});
test('caves allow vertical entry but block side entry and horizontal blasts',()=>{
 const[m,p]=setup();m.blocks.fill(0);m.bombs=[];
 for(const h of map.objects.filter(o=>o.id===5010)){
  p.x=h.x-.5;p.y=h.y+.5;assert.equal(m.canMove(p,h.x+.1,p.y,'right'),false);
  p.x=h.x+.5;p.y=h.y-.5;assert.equal(m.canMove(p,p.x,h.y+.1,'down'),true);
  m.flames=[];const bomb={id:++m.serial,x:h.x-1,y:h.y,owner:'test',power:4};m.bombs.push(bomb);m.explode(bomb);
  assert(!m.flames.some(f=>f.x===h.x&&f.y===h.y));
  m.flames=[];const vertical={id:++m.serial,x:h.x,y:h.y-1,owner:'test',power:2};m.bombs.push(vertical);m.explode(vertical);
  assert(m.flames.some(f=>f.x===h.x&&f.y===h.y));
 }
});
test('sailor moves, places bombs and throws slow glue under server simulation',()=>{
 const[m,p]=setup();const origin={x:m.boss.x,y:m.boss.y};m.blocks.fill(0);p.x=9.5;p.y=6.5;
 let bomb=false,glue=false,moved=false;
 for(let i=0;i<1800;i++){m.tick();bomb||=m.bombs.some(b=>b.owner==='sailor');glue||=m.items.some(i=>i.kind==='smile-trap');moved||=Math.hypot(m.boss.x-origin.x,m.boss.y-origin.y)>.1;}
 assert(bomb);assert(glue);assert(moved);
});
test('sailor takes damage from its own explosion',()=>{
 const[m]=setup();m.bombs=[];m.boss.phase='chase';m.boss.hurtUntil=0;
 const bomb={id:++m.serial,x:Math.floor(m.boss.x),y:Math.floor(m.boss.y),owner:'sailor',power:2};m.bombs.push(bomb);m.explode(bomb);assert.equal(m.boss.hp,9);
});
test('sailor keeps forward progress between grid centres instead of reversing on replans',()=>{
 const[m,p]=setup();m.blocks.fill(0);m.bombs=[];Object.assign(m.boss,{x:3.5,y:3.5,path:[],thinkAt:0,nextBomb:1e9,nextGlue:1e9,phase:'chase'});p.x=12.5;p.y=3.5;
 let previous=m.boss.x;
 for(let i=0;i<120;i++){m.time+=1/120;m.tickBoss(1/120);assert(m.boss.x>=previous-1e-7,'replanning reversed movement');previous=m.boss.x;}
 assert(m.boss.x>7,'must make useful progress');
});
test('ten separate player explosions defeat sailor after death animation',()=>{
 const[m,p]=setup();m.blocks.fill(0);p.x=.5;p.y=.5;
 for(let n=0;n<10;n++){
  m.boss.hurtUntil=0;m.boss.phase='chase';const b={id:++m.serial,x:Math.floor(m.boss.x),y:Math.floor(m.boss.y),power:1,owner:p.id,born:m.time,explodeAt:m.time};m.bombs.push(b);m.explode(b);assert.equal(m.boss.hp,9-n);
 }
 assert.equal(m.state,'playing');for(let n=0;n<1000;n++)m.tick();assert.equal(m.winner,0);assert.equal(m.state,'finished');
});
test('sailor spawns with the ten points its health bar has frames for',()=>{
 const[m]=setup();
 assert.equal(m.boss.maxHp,10);
 assert.equal(m.boss.hp,10);
 assert.equal(m.snapshot().boss.hp,10);
});
test('pve trap lasts five seconds longer than pvp and is only sent when it changes',()=>{
 const[m,p]=setup();m.blocks.fill(0);m.bombs=[];
 Object.assign(m.boss,{x:.5,y:.5,path:[],thinkAt:m.time+99,nextGlue:m.time+99,phase:'wait'});
 p.x=13.5;p.y=11.5;
 assert.equal(RULES.trap,5);assert.equal(RULES.trapPve,RULES.trap+5);
 assert.equal(m.trapDuration,RULES.trapPve);
 assert.equal(m.snapshot().trapDuration,RULES.trapPve);
 assert.equal(m.snapshot().trapDuration,undefined,'a constant field must not be resent every frame');
 m.trapPlayer(p,'sailor');
 assert.equal(p.trappedUntil,m.time+RULES.trapPve);
 for(let i=0;i<Math.round(5.5*120);i++)m.tick();
 assert.equal(p.status,'trapped','must outlive the five-second pvp window');
 for(let i=0;i<Math.round(4.8*120);i++)m.tick();
 assert.equal(p.status,'dead');
 const plain=new Match(map,false);
 assert.equal(plain.trapDuration,RULES.trap,'pvp keeps the native five-second trap');
});
test('the sailor scatters six smile traps per glue volley',()=>{
 const[m,p]=setup();m.blocks.fill(0);m.bombs=[];m.items=[];
 Object.assign(m.boss,{thinkAt:m.time+99,nextGlue:m.time,path:[],phase:'chase'});
 // 每格消耗两次 random；构造 (0,0)…(5,5) 六个互不相同、且都不实心的落点
 const seq=[];for(let i=0;i<6;i++)seq.push((i+.5)/15,(i+.5)/13);
 let n=0;m.random=()=>seq[n++]??0;
 m.tickBoss(1/120);
 assert.deepEqual(m.items.filter(i=>i.kind==='smile-trap').map(i=>`${i.x},${i.y}`),['0,0','1,1','2,2','3,3','4,4','5,5']);
 assert.equal(m.boss.nextGlue,m.time+12,'pace stays at one volley per twelve seconds');
});
test('a bomb can sit inside a cave, which is why the renderer hides it there',()=>{
 const[m,p]=setup();m.blocks.fill(0);m.bombs=[];
 const h=map.objects.find(o=>o.id===5010);
 p.x=h.x+.5;p.y=h.y+.5;
 assert.equal(m.placeBomb(p),true);
 const bomb=m.bombs.at(-1);
 assert.equal(bomb.x,h.x);assert.equal(bomb.y,h.y);
 assert.equal(hiddenInWater(map,{x:bomb.x+.5,y:bomb.y+.5}),true,'the bubble hides with the actors');
 // 爆炸不藏：洞口内不放横向火焰，但纵向火焰照常生成
 m.flames=[];const vertical={id:++m.serial,x:h.x,y:h.y-1,owner:'test',power:2};m.bombs.push(vertical);m.explode(vertical);
 assert(m.flames.some(f=>f.x===h.x&&f.y===h.y));
});
test('stepping into a cave lights it once, and again after leaving',()=>{
 const[m,p]=setup();m.blocks.fill(0);m.events=[];
 const h=map.objects.find(o=>o.id===5010);
 const lit=()=>m.events.filter(e=>e.type==='cave-lit'&&e.x===h.x&&e.y===h.y).length;
 p.x=h.x+.5;p.y=h.y+.5;m.tickCaves();
 assert.equal(lit(),1,'entering must light the cave');
 for(let i=0;i<20;i++)m.tickCaves();
 assert.equal(lit(),1,'staying inside must not keep re-firing');
 p.x=h.x+.5;p.y=h.y+1.5;m.tickCaves();
 assert.equal(lit(),1);
 p.x=h.x+.5;p.y=h.y+.5;m.tickCaves();
 assert.equal(lit(),2,'leaving and coming back must light it again');
});
test('the sailor entering a cave stays dark so the cave keeps hiding it',()=>{
 const[m,p]=setup();m.events=[];p.x=13.5;p.y=11.5;
 const h=map.objects.find(o=>o.id===5010);
 Object.assign(m.boss,{x:h.x+.5,y:h.y+.5});
 m.tickCaves();
 assert.equal(m.events.filter(e=>e.type==='cave-lit').length,0);
});
test('water11 eliminates dead players and cooperators can rescue each other',()=>{
 const[m,p]=setup(),q=m.addPlayer('q','队友',0);q.x=p.x;q.y=p.y;
 m.trapPlayer(p,'sailor');m.tick();assert.equal(p.status,'alive');
 m.kill(p);for(let i=0;i<1300;i++)m.tick();assert.equal(p.status,'dead');
 m.kill(q);m.tick();assert.equal(m.winner,1);assert.equal(m.state,'finished');
});
