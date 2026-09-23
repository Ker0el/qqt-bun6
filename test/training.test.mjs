import test from 'node:test';
import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';
import{Match,RULES}from'../public/engine.mjs';
const map=JSON.parse(readFileSync(new URL('../public/assets/map.json',import.meta.url),'utf8'));
function fixture(practice=true){const m=new Match(map,practice),p=m.addPlayer('p','tester',0);if(!practice)m.addPlayer('q','opponent',1);m.start();m.state='playing';return[m,p]}
const tick=(m,n)=>{for(let i=0;i<n;i++)m.tick()};
test('training menu actions and even injected flags have no effect in multiplayer',()=>{
  const[m,p]=fixture(false);assert.equal(m.setTrainingMod(p.id,'noclip',true),false);assert.equal(m.beginTrainingWin(p.id),false);
  p.mods.invincible=true;p.shieldUntil=0;m.time=10;m.trapPlayer(p,'q');assert.equal(p.status,'trapped');
});
test('all checkbox modes are scoped to one-player training and disable cleanly',()=>{
  const[m,p]=fixture();m.blocks.fill(0);p.x=7.5;p.y=8.5;
  assert(m.setTrainingMod(p.id,'bombs',true));assert(m.setTrainingMod(p.id,'power',true));
  for(let x=3;x<8;x++){p.x=x+.5;m.time+=.05;assert(m.placeBomb(p))}
  assert.equal(m.bombs.length,5);assert(m.bombs.every(b=>b.power===32));
  assert(m.setTrainingMod(p.id,'bombs',false));assert(m.setTrainingMod(p.id,'power',false));p.x=9.5;m.time+=.2;assert.equal(m.placeBomb(p),false);
  m.bombs=[];assert(m.placeBomb(p));assert.equal(m.bombs[0].power,RULES.power);
});
test('fast movement, invincibility and noclip work only while enabled',()=>{
  const[m,p]=fixture();m.blocks.fill(0);p.x=7.5;p.y=8.5;p.shieldUntil=0;m.time=5;
  m.setTrainingMod(p.id,'speed',true);m.setTrainingMod(p.id,'noclip',true);m.blocks[8*15+8]=8005;
  m.setInput(p.id,{seq:1,dir:'right'});tick(m,10);assert(p.x>9);
  p.x=8.5;p.y=8.5;m.setTrainingMod(p.id,'noclip',false);assert(m.canStand(p,p.x,p.y));
  m.setTrainingMod(p.id,'invincible',true);m.trapPlayer(p,'q');m.kill(p,'q');assert.equal(p.status,'alive');
  m.setTrainingMod(p.id,'invincible',false);m.trapPlayer(p,'q');assert.equal(p.status,'trapped');
});
test('instant-win visibly performs three pickup/deposit trips before concluding',()=>{
  const[m,p]=fixture();assert(m.beginTrainingWin(p.id));tick(m,150);
  assert.equal(p.captures,3);assert.equal(m.winner,0);assert.equal(m.state,'finished');
  assert.equal(m.events.filter(e=>e.type==='training-warp').length,6);
  assert.equal(m.stored[0][1],3);
});
test('held movement keeps the running animation at a wall and stops on release',()=>{
  const[m,p]=fixture();p.x=2.5;p.y=4.5;
  m.setInput(p.id,{seq:1,dir:'left'});tick(m,12);assert.equal(p.x,2.5);assert.equal(p.moving,true);
  m.setInput(p.id,{seq:2,dir:null});tick(m,2);assert.equal(p.moving,false);
});
