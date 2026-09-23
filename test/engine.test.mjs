import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Match, RULES, ARENA_BOUNDS } from '../public/engine.mjs';
const map=JSON.parse(readFileSync(new URL('../public/assets/map.json',import.meta.url),'utf8'));
const ticks=(m,n)=>{for(let i=0;i<n;i++)m.tick()};
function fixture(mode='phase') {const m=new Match(map,true);const p=m.addPlayer('p','tester',0);m.setupDrill('p',mode);return [m,p]}
function press(m,p,dir,bomb=false){m.setInput(p.id,{seq:p.lastSequence+1,dir,bomb})}

test('initial bomb reaches one cell per arm on open ground',()=>{
  const[m,p]=fixture('map');m.blocks.fill(0);p.x=7.5;p.y=8.5;p.shieldUntil=1e9;
  assert.equal(m.placeBomb(p),true);
  const bomb=m.bombs.find(b=>b.owner===p.id);m.explode(bomb);
  for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){
    assert(m.flames.some(f=>f.x===7+dx&&f.y===8+dy));
    assert(!m.flames.some(f=>f.x===7+dx*2&&f.y===8+dy*2));
  }
});

test('native bun06 map contains 15x13 cells, two bases and 8 valid spawns',()=>{
  assert.equal(map.blocks.length,195);assert.equal(map.structures.filter(x=>x>0).length,2);
  assert.equal(map.spawns.length,8);
  for(const [x,y]of map.spawns){assert.equal(map.blocks[y*15+x],0);assert.equal(map.structures[y*15+x],0)}
});
test('a bomb blocks walking without the timed placement',()=>{
  const[m,p]=fixture();press(m,p,'up');ticks(m,160);assert(p.y>=7.21);assert.equal(p.phaseCount,0);
});
test('correctly timed placement crosses a single bomb',()=>{
  const[m,p]=fixture();press(m,p,'up');ticks(m,73);press(m,p,'up',true);ticks(m,40);
  assert.equal(p.phaseCount,1);assert(p.y<6,`expected crossing, got ${p.y}`);
});
test('too early and too late placements cannot cross',()=>{
  for(const n of [30,100]){const[m,p]=fixture();press(m,p,'up');ticks(m,n);press(m,p,'up',true);ticks(m,30);assert.equal(p.phaseCount,0);assert(p.y>=7.21)}
});
test('stacked bombs do not grant a through-path',()=>{
  const[m,p]=fixture();m.bombs.push({...m.bombs[0],id:900,y:5});press(m,p,'up');ticks(m,73);press(m,p,'up',true);ticks(m,30);assert.equal(p.phaseCount,0);assert(p.y>=7.21);
});
test('a wall without the adjacent activation bomb remains solid',()=>{
  const[m,p]=fixture('wall');m.bombs=[];p.x=6.5;press(m,p,'up');ticks(m,73);press(m,p,'up',true);ticks(m,40);assert(p.y>=7.21);assert.equal(p.wallCount,0);
});
test('offset left-wall right-bubble setup acquires wall access with timed placement',()=>{
  const[m,p]=fixture('wall');press(m,p,'up');ticks(m,73);press(m,p,'up',true);ticks(m,16);
  assert.equal(p.wallCount,1);assert(p.wallPasses.includes('6,6'));assert(p.x<7,`expected lateral entry, x=${p.x}`);
  assert.equal(p.onWall,'6,6');
  ticks(m,45);assert.equal(p.onWall,null);assert(p.y<6);
  press(m,p,'down');ticks(m,60);assert(p.y<=5.79,'cannot re-enter the wall without another timed activation');
});
test('chain explosions stop at permanent walls and destroy soft blocks',()=>{
  const[m,p]=fixture('map');m.blocks.fill(0);p.shieldUntil=1e9;
  m.blocks[7*15+7]=8005;m.blocks[5*15+6]=8001;
  const a={id:10,x:6,y:7,owner:p.id,team:0,power:4,born:0,explodeAt:999};
  const b={...a,id:11,x:6,y:6};m.bombs=[a,b];m.explode(a);
  assert.equal(m.bombs.length,0);assert.equal(m.blocks[5*15+6],0);assert.equal(m.blocks[7*15+7],8005);
  assert(!m.flames.some(f=>f.x===8&&f.y===7));assert(m.flames.some(f=>f.x===6&&f.y===5));
});
test('carrying disables placement and delivery conserves the total six buns',()=>{
  const[m,p]=fixture('map');p.x=9.5;p.y=3.7;p.inHouse=1;m.objectives(p);
  assert.equal(p.carry,1);assert.deepEqual(m.stock,[3,2]);assert.equal(m.placeBomb(p),false);
  p.x=5.5;p.inHouse=0;m.objectives(p);assert.equal(p.carry,null);assert.deepEqual(m.stock,[4,2]);assert.equal(p.captures,1);
});
test('dropped friendly bun must be carried home, never auto-returns or duplicates',()=>{
  const[m,p]=fixture('map');p.x=9.5;p.y=3.7;p.inHouse=1;m.objectives(p);p.x=8.5;p.y=4.5;p.inHouse=null;m.kill(p);assert.equal(m.buns.length,1);
  m.kill(p);assert.equal(m.buns.length,1);ticks(m,1000);assert.equal(m.stock.reduce((a,b)=>a+b,0),5);assert.equal(m.buns.length,1);
  const q=m.addPlayer('q','blue',1);q.x=8.5;q.y=4.5;m.objectives(q);
  assert.equal(q.carry,1);assert.deepEqual(m.stock,[3,2]);assert.equal(m.placeBomb(q),false);
  q.x=9.5;q.inHouse=1;m.objectives(q);
  assert.equal(q.carry,null);assert.equal(m.stock.reduce((a,b)=>a+b,0),6);assert.equal(m.buns.length,0);assert.equal(q.captures,0);
});
test('a teammate rescues a trapped player, enemy contact kills, then respawn',()=>{
  const[m,p]=fixture('map');const q=m.addPlayer('q','friend',0);p.status='trapped';p.trappedUntil=10;q.x=p.x;q.y=p.y;m.tick();assert.equal(p.status,'alive');
  p.status='trapped';p.trappedUntil=10;q.team=1;m.tick();assert.equal(p.status,'dead');ticks(m,1100);assert.equal(p.status,'dead');ticks(m,101);assert.equal(p.status,'alive');
});
test('native three-second fuse and five-second trap timing are respected',()=>{
  const[m,p]=fixture('map');assert.equal(m.placeBomb(p),true);ticks(m,360);assert.equal(m.bombs.length,1);ticks(m,1);assert.equal(m.bombs.length,0);
  p.status='trapped';p.trappedUntil=m.time+RULES.trap;ticks(m,599);assert.equal(p.status,'trapped');ticks(m,2);assert.equal(p.status,'dead');
});
test('input cannot directly set positions, stats, or rewind its sequence',()=>{
  const[m,p]=fixture();const x=p.x;
  m.setInput(p.id,{seq:3,dir:'up',x:100,capacity:1000});assert.equal(p.x,x);assert.equal(p.capacity,RULES.capacity);
  m.setInput(p.id,{seq:2,dir:'down'});assert.equal(p.input.dir,'up');
});
test('collecting all buns ends a competitive round',()=>{
  const m=new Match(map);const p=m.addPlayer('p','red',0);m.addPlayer('q','blue',1);m.start();m.state='playing';
  for(let i=0;i<3;i++){p.x=9.5;p.y=2.5;p.inHouse=1;m.objectives(p);p.x=5.5;p.inHouse=0;m.objectives(p)}
  assert.equal(m.state,'finished');assert.equal(m.winner,0);assert.deepEqual(m.stock,[6,0]);
});
test('the requested three-bun objective stays consistent for 1v1 through 4v4',()=>{
  for(let n=1;n<=4;n++){
    const m=new Match(map);for(let i=0;i<n*2;i++)m.addPlayer(String(i),'player',i%2);
    m.start();assert.deepEqual(m.stock,[3,3]);assert.equal(m.totalBuns,6);assert.equal(m.remaining,240);
  }
});
test('3P transfers acquired phase after a turn into the adjacent supported wall',()=>{
  const[m,p]=fixture('wall3');press(m,p,'right');ticks(m,73);press(m,p,'right',true);ticks(m,1);
  press(m,p,'up');ticks(m,15);assert.equal(p.phaseCount,1);assert.equal(p.onWall,'7,6');
});
test('a fresh rhythm survives a quick turn, but an expired pass cannot mount',()=>{
  const[m,p]=fixture('wall3');press(m,p,'right');ticks(m,73);press(m,p,'up',true);ticks(m,20);assert.equal(p.onWall,'7,6');
  const[n,q]=fixture('wall3');press(n,q,'right');ticks(n,73);press(n,q,'right',true);ticks(n,40);press(n,q,'up');ticks(n,20);assert.equal(q.onWall,null);assert.equal(q.wallCount,0);
});
test('bun house can be entered, hides the actor, and can be exited continuously',()=>{
  const[m,p]=fixture('map');p.x=5.5;p.y=4.5;press(m,p,'up');ticks(m,30);
  assert.equal(p.inHouse,0);assert.equal(m.snapshot().players[0].inHouse,0);assert.equal(m.placeBomb(p),true);
  press(m,p,'down');ticks(m,32);assert.equal(p.inHouse,null);assert(p.y>=4.5);
});
test('only entering the enemy house picks up a bun; the outer doorway is not enough',()=>{
  const[m,p]=fixture('map');p.x=9.5;p.y=4.5;m.objectives(p);assert.equal(p.carry,null);
  press(m,p,'up');ticks(m,30);assert.equal(p.inHouse,1);assert.equal(p.carry,1);assert.deepEqual(m.stock,[3,2]);
});
test('house accepts side entry when the path is clear; bombs still block movement',()=>{
  const[m,p]=fixture('map');m.blocks.fill(0);p.x=3.5;p.y=2.5;press(m,p,'right');ticks(m,30);assert.equal(p.inHouse,0);
  p.x=5.5;p.y=3.5;p.inHouse=0;
  m.bombs.push({id:999,x:5,y:4,owner:'q',power:1,born:m.time,explodeAt:99});
  press(m,p,'down');ticks(m,30);assert.equal(p.inHouse,0);
});
test('continuous movement and active phase never put character art outside the arena',()=>{
  const empty={...map,blocks:Array(195).fill(0),structures:Array(195).fill(0),bases:[]};
  const m=new Match(empty,true),p=m.addPlayer('p','edge',0);m.start();m.state='playing';p.shieldUntil=1e9;
  for(const dir of ['up','left','down','right']){
    p.phaseUntil=m.time+100;press(m,p,dir);ticks(m,700);
    assert(p.x>=ARENA_BOUNDS.left&&p.x<=ARENA_BOUNDS.right);
    assert(p.y>=ARENA_BOUNDS.top&&p.y<=ARENA_BOUNDS.bottom);
    // All imported animation frames fit: bounds 31,23..69,83, anchor 50,64.
    assert(8+p.x*40-50+31>=8);assert(8+p.x*40-50+69<=608);
    assert(22+p.y*40-64+23>=0);assert(22+p.y*40-64+83<=542);
  }
});
test('each side of a bun house is traversable without teleporting',()=>{
  for(const [x,y,dir]of [[3.5,2.5,'right'],[7.5,2.5,'left'],[5.5,.5,'down'],[5.5,4.5,'up']]){
    const[m,p]=fixture('map');m.blocks.fill(0);p.x=x;p.y=y;p.inHouse=null;press(m,p,dir);
    let before={x:p.x,y:p.y};for(let i=0;i<30;i++){m.tick();assert(Math.hypot(p.x-before.x,p.y-before.y)<=p.speed*RULES.tick+.0001);before={x:p.x,y:p.y}}
    assert.equal(p.inHouse,0);
  }
});
test('19-pixel collision footprint cannot overlap an adjacent solid grid cell',()=>{
  const[m,p]=fixture('map');m.blocks.fill(0);m.blocks[6*15+8]=8005;p.x=7.5;p.y=6.5;press(m,p,'right');ticks(m,120);
  assert(p.x+RULES.radius<=8.000001,`body entered wall: x=${p.x}`);
});
test('explosion hits once; residual flame animation does not kill someone entering a broken wall',()=>{
  const[m,p]=fixture('map');m.blocks.fill(0);m.blocks[6*15+8]=8001;p.x=8.5;p.y=7.5;p.shieldUntil=0;m.time=1;
  const q=m.addPlayer('q','victim',1);q.x=7.5;q.y=6.5;q.shieldUntil=0;
  const b={id:999,x:7,y:6,owner:'enemy',team:1,power:1,born:0,explodeAt:99};m.bombs=[b];m.explode(b);
  assert.equal(q.status,'trapped');assert.equal(p.status,'alive');assert.equal(m.blocks[6*15+8],0);
  press(m,p,'up');ticks(m,49);assert(p.y<7);assert(m.flames.some(f=>f.x===8&&f.y===6));assert.equal(p.status,'alive');
});
