import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Match,RULES} from '../public/engine.mjs';
const map=JSON.parse(readFileSync(new URL('../public/assets/map.json',import.meta.url),'utf8'));
const ticks=(m,n)=>{for(let i=0;i<n;i++)m.tick()};
function clean(){const m=new Match(map,true);const p=m.addPlayer('p','tester',0);m.start();m.state='playing';m.blocks.fill(0);p.shieldUntil=1e9;return[m,p]}
const input=(m,p,dir,bomb=false)=>m.setInput(p.id,{seq:p.lastSequence+1,dir,bomb});

test('holding up while slightly off centre slides into the open lane instead of sticking',()=>{
  const[m,p]=clean();m.blocks[5*15+6]=8005;p.x=5.82;p.y=6.5;input(m,p,'up');ticks(m,90);
  assert(p.y<5.5,`stuck at ${p.x.toFixed(3)},${p.y.toFixed(3)}`);assert(Math.abs(p.x-5.5)<.05);
});
test('running toward a bubble can establish the rhythm before physical contact',()=>{
  const[m,p]=clean();p.x=7.5;p.y=10.5;
  m.bombs.push({id:999,x:7,y:6,owner:'q',team:1,power:1,born:0,explodeAt:99});
  input(m,p,'up');ticks(m,73);input(m,p,'up',true);ticks(m,50);
  assert.equal(p.phaseCount,1);assert(p.y<6,`did not cross: y=${p.y}`);
});
test('bun house has four solid corner cells and an open cross through the centre',()=>{
  const[m,p]=clean();
  for(const [x,y]of [[4,1],[6,1],[4,3],[6,3]])assert.equal(m.canStand(p,x+.5,y+.5),false,`corner ${x},${y}`);
  for(const [x,y]of [[5,1],[4,2],[5,2],[6,2],[5,3]])assert.equal(m.canStand(p,x+.5,y+.5),true);
});
test('house centre does not grant blast immunity, while corners stop the flame ray',()=>{
  const[m,p]=clean();m.time=1;p.shieldUntil=0;p.x=5.5;p.y=2.5;p.inHouse=0;
  const b={id:998,x:5,y:4,owner:'q',team:1,power:4,born:0,explodeAt:99};m.bombs=[b];m.explode(b);
  assert.equal(p.status,'trapped');
  const c={...b,id:999,x:4};m.bombs=[c];m.explode(c);assert(!m.flames.some(f=>f.x===4&&f.y===2));
});
test('returning all three opponent buns wins even when a home bun is still missing',()=>{
  const m=new Match(map);const red=m.addPlayer('r','red',0),blue=m.addPlayer('b','blue',1);
  for(let i=0;i<2;i++){m.addPlayer('r'+i,'red',0);m.addPlayer('b'+i,'blue',1)}m.start();m.state='playing';
  blue.inHouse=0;blue.x=5.5;blue.y=2.5;m.objectives(blue);assert.equal(blue.carry,0);blue.inHouse=null;
  for(let i=0;i<3;i++){red.inHouse=1;red.x=9.5;red.y=2.5;m.objectives(red);red.inHouse=0;red.x=5.5;m.objectives(red)}
  assert.equal(m.state,'finished');assert.equal(m.winner,0);
});
test('run-up phasing works at different speeds with speed-scaled approach distance',()=>{
  for(const speed of [3,5,8]){
    const[m,p]=clean();p.speed=speed;p.x=7.5;p.y=6.5+speed*.6+1;
    m.bombs.push({id:999,x:7,y:6,owner:'q',team:1,power:1,born:0,explodeAt:99});
    input(m,p,'up');ticks(m,73);input(m,p,'up',true);ticks(m,Math.ceil(2/speed/RULES.tick));
    assert.equal(p.phaseCount,1,`speed ${speed}`);assert(p.y<6,`speed ${speed} crossing`);
  }
});
test('borrowed bubble can mount a pillar from each supported directional edge',()=>{
  for(const [dir,x,y,wx,wy]of [['up',7.04,7.5,6,6],['down',7.96,5.5,8,6],['right',6.5,6.96,7,7],['left',8.5,6.04,7,5]]){
    const[m,p]=clean();p.x=x;p.y=y;m.blocks[wy*15+wx]=8006;
    m.bombs.push({id:999,x:7,y:6,owner:'q',team:1,power:1,born:0,explodeAt:99});
    input(m,p,dir);ticks(m,73);input(m,p,dir,true);ticks(m,18);
    assert.equal(p.onWall,`${wx},${wy}`,dir);
  }
});
test('a short directional tap arriving within one tick is not discarded',()=>{
  const[m,p]=clean();p.x=7.5;p.y=8.5;input(m,p,'up');input(m,p,null);m.tick();
  assert(p.y<8.5);const y=p.y;ticks(m,10);assert.equal(p.y,y);
});
