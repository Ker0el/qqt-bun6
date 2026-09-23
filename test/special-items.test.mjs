import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Match,RULES} from '../public/engine.mjs';
const map=JSON.parse(readFileSync(new URL('../public/assets/map.json',import.meta.url)));
function setup(){const m=new Match(map,true),p=m.addPlayer('p','p',0);m.start();m.state='playing';m.blocks.fill(0);p.x=7.5;p.y=8.5;return[m,p]}
test('already placed bombs use their owner upgraded power at explosion',()=>{
 const[m,p]=setup();assert.equal(m.placeBomb(p),true);const b=m.bombs[0];
 assert.equal(b.power,1);m.collectItem(p,{kind:'power'});m.explode(b);
 assert(m.flames.some(f=>f.x===9&&f.y===8));assert(!m.flames.some(f=>f.x===10&&f.y===8));
});
test('power pickup does not upgrade another player bombs',()=>{
 const[m,p]=setup();m.placeBomb(p);const b=m.bombs[0];const q=m.addPlayer('q','q',1);
 m.collectItem(q,{kind:'power'});m.explode(b);assert(!m.flames.some(f=>f.x===9&&f.y===8));
});
test('fork consumes exactly one only when trapped, never revives dead players',()=>{
 const[m,p]=setup();m.collectItem(p,{kind:'fork'});assert.equal(m.useFork('p'),false);assert.equal(p.forks,1);
 p.status='trapped';assert.equal(m.useFork('p'),true);assert.equal(p.status,'alive');assert.equal(p.forks,0);assert(p.shieldUntil<m.time);
 p.status='dead';p.forks=1;assert.equal(m.useFork('p'),false);assert.equal(p.forks,1);
});
test('death scatters consumed upgrades once, excluding inventory and blocked cells',()=>{
 const[m,p]=setup();m.blocks[8*15+9]=8005;p.forks=2;p.bananas=1;p.smiles=1;
 for(const kind of ['capacity','power','power','speed'])m.collectItem(p,{kind});
 m.kill(p);assert.equal(m.items.length,4);assert.equal(p.capacity,RULES.capacity);assert.equal(p.power,RULES.power);assert.equal(p.speed,RULES.speed);
 assert.equal(p.forks,0);assert.equal(p.bananas,0);assert.equal(p.smiles,0);
 assert.equal(new Set(m.items.map(i=>`${i.x},${i.y}`)).size,4);
 for(const i of m.items)assert.equal(m.solid(i.x,i.y),false);
 m.kill(p);assert.equal(m.items.length,4);
 m.spawn(p);m.kill(p);assert.equal(m.items.length,4);
});
test('death drops fly from the death position and cannot be picked up before landing',()=>{
 const[m,p]=setup();m.collectItem(p,{kind:'power'});const origin={x:p.x,y:p.y};m.kill(p);
 const item=m.items[0];assert.equal(item.flight.x,origin.x);assert.equal(item.flight.y,origin.y);assert(item.availableAt>m.time);
 const q=m.addPlayer('q','q',1);q.x=item.x+.5;q.y=item.y+.5;const initial=q.power;
 m.objectives(q);assert.equal(q.power,initial);assert.equal(m.items.length,1);
 m.time=item.availableAt;m.objectives(q);assert.equal(q.power,initial+1);assert.equal(m.items.length,0);
});
test('banana locks movement direction until an obstacle, including key release',()=>{
 const[m,p]=setup();p.dir='right';m.blocks[8*15+10]=8005;m.collectItem(p,{kind:'banana-trap'});
 p.input.dir='left';m.move(p,.05);assert(p.x>7.5);p.input.dir=null;
 for(let i=0;i<100;i++)m.move(p,1/120);
 assert(p.x>9&&p.x<10);assert.equal(p.slideDir,null);
});
test('banana pickup is stored, placement consumes one, and stepping back triggers it',()=>{
 const[m,p]=setup();m.collectItem(p,{kind:'banana'});assert.equal(p.bananas,1);assert.equal(p.slideDir,null);
 assert.equal(m.placeBanana(p.id),true);assert.equal(p.bananas,0);assert.equal(m.placeBanana(p.id),false);
 m.objectives(p);assert.equal(m.items.length,1);assert.equal(p.slideDir,null);
 p.x=8.5;m.tick();p.x=7.5;p.dir='left';m.objectives(p);
 assert.equal(m.items.length,0);assert.equal(p.slideDir,'left');
});
test('sliding ignores steering and action inputs and keeps animation moving',()=>{
 const[m,p]=setup();p.dir='right';m.collectItem(p,{kind:'banana-trap'});
 m.setInput(p.id,{seq:1,dir:'up',bomb:true});assert.equal(p.input.dir,null);assert.equal(p.actions.length,0);
 assert.equal(m.placeBomb(p),false);p.bananas=1;assert.equal(m.placeBanana(p.id),false);
 const y=p.y;m.move(p,1/120);assert(p.x>7.5);assert.equal(p.y,y);assert.equal(p.moving,true);
});
test('the banana slide outruns normal running speed',()=>{
 const[m,p]=setup();p.dir='right';m.collectItem(p,{kind:'banana-trap'});
 assert(RULES.slideSpeed>RULES.maxSpeed,'the slip must outrun the fastest run');
 m.move(p,1/120);assert(Math.abs(p.x-7.5-RULES.slideSpeed/120)<1e-6);
});
test('slide reaches wall contact before restoring held steering',()=>{
 const[m,p]=setup();p.x=9.5;p.y=8.5;p.dir='right';m.blocks[8*15+10]=8005;
 m.collectItem(p,{kind:'banana-trap'});m.setInput(p.id,{seq:1,dir:'up'});m.move(p,1/120);
 assert(Math.abs(p.x-(10-RULES.radius))<.00001);assert.equal(p.y,8.5);assert.equal(p.slideDir,null);
 m.move(p,1/120);assert(p.y<8.5);
});
test('smile slows movement temporarily without reducing collected speed',()=>{
 const[m,p]=setup();p.input.dir='right';const speed=p.speed;m.collectItem(p,{kind:'smile-trap'});
 m.move(p,.1);assert(Math.abs(p.x-7.5-speed*.03)<1e-6);assert.equal(p.speed,speed);
 m.time+=5.01;const x=p.x;m.move(p,.1);assert(Math.abs(p.x-x-speed*.1)<1e-6);
 m.spawn(p);assert.equal(p.slowUntil,0);assert.equal(p.slideDir,null);
});
test('stepping on a banana clears the smile slow',()=>{
 const[m,p]=setup();p.input.dir='right';m.blocks[8*15+10]=8005;
 m.collectItem(p,{kind:'smile-trap'});assert.equal(p.slowUntil,m.time+5);
 const start=p.x;m.move(p,.1);assert(Math.abs(p.x-start-p.speed*.03)<1e-6,'the smile must slow movement first');
 m.collectItem(p,{kind:'banana-trap'});
 assert.equal(p.slowUntil,0,'the slip must clear the smile slow');
 assert.equal(p.slideDir,'right','the banana still locks the slide direction');
 for(let i=0;i<120;i++)m.move(p,1/120);
 assert.equal(p.slideDir,null,'the slide ends at the obstacle');
 p.input.dir='left';
 const x=p.x;m.move(p,.1);assert(Math.abs(x-p.x-p.speed*.1)<1e-6,'speed is back to normal');
});
test('smile is stored until placed and only the player stepping on it is slowed',()=>{
 const[m,p]=setup();m.collectItem(p,{kind:'smile'});assert.equal(p.smiles,1);assert.equal(p.slowUntil,0);
 assert.equal(m.placeTrap(p.id,'smile'),true);assert.equal(p.smiles,0);assert.equal(m.placeTrap(p.id,'smile'),false);
 m.objectives(p);assert.equal(p.slowUntil,0);assert.equal(m.items.length,1);
 const q=m.addPlayer('q','q',1);q.x=p.x;q.y=p.y;m.objectives(q);
 assert.equal(q.slowUntil,m.time+5);assert.equal(p.slowUntil,0);assert.equal(m.items.length,0);
});
