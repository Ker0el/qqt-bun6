import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{Match,RULES}from'../public/engine.mjs';
const map=JSON.parse(readFileSync(new URL('../public/assets/map.json',import.meta.url),'utf8'));
function fixture(){const m=new Match(map,true),p=m.addPlayer('p','player',0);m.start();m.state='playing';m.blocks.fill(0);p.x=7.5;p.y=8.5;p.shieldUntil=0;m.time=4;return[m,p]}
const tick=(m,n)=>{for(let i=0;i<n;i++)m.tick()};
test('bubble outer edge guides into the adjacent lane',()=>{
 const[m,p]=fixture();p.x=8.2;p.y=7.5;m.bombs=[{id:999,x:7,y:6,owner:'q',power:1,explodeAt:99}];
 m.setInput('p',{seq:1,dir:'up'});tick(m,40);assert(p.x>8.4);assert(p.y<7.4);
});
test('wall does not pull a player far sideways toward an adjacent lane',()=>{
 const[m,p]=fixture();p.x=7.7;p.y=7.5;m.blocks[6*15+7]=8005;
 m.setInput('p',{seq:1,dir:'up'});tick(m,40);assert.equal(p.x,7.7);
});
test('a released directional tap retains the facing rhythm until the timed placement',()=>{
 const[m,p]=fixture();p.y=7.5;m.bombs=[{id:999,x:7,y:6,owner:'q',power:1,explodeAt:99}];
 m.setInput('p',{seq:1,dir:'up'});tick(m,1);m.setInput('p',{seq:2,dir:null});tick(m,71);m.setInput('p',{seq:3,dir:'up',bomb:true});tick(m,40);assert.equal(p.phaseCount,1);
});
test('exactly half of the collision body is safe, more than half is hit',()=>{
 for(const[x,hit]of [[7,false],[7.02,true],[6.98,false]]){
  const[m,p]=fixture();p.x=x;p.y=6.5;const b={id:999,x:7,y:6,owner:'q',power:0,explodeAt:99};m.bombs=[b];m.explode(b);assert.equal(p.status,hit?'trapped':'alive',String(x));
 }
});
test('existing floor items burn, newly exposed wall items survive their revealing blast',()=>{
 const[m,p]=fixture();p.shieldUntil=1e9;m.items=[{id:1,x:7,y:6,kind:'speed',availableAt:0}];
 const b={id:999,x:7,y:6,owner:'q',power:1,explodeAt:99};m.bombs=[b];m.explode(b);assert.equal(m.items.length,0);
 const[n,q]=fixture();q.shieldUntil=1e9;n.hiddenItems=[{id:100,x:8,y:6,kind:'speed'}];n.blocks[6*15+8]=8001;n.bombs=[{...b}];n.explode(n.bombs[0]);
 assert.equal(n.items.length,1);assert(n.items[0].availableAt>n.time);
 tick(n,70);n.bombs=[{...b,id:1000}];n.explode(n.bombs[0]);assert.equal(n.items.length,0);
});
test('a destroyed wall keeps a short debris collision before opening',()=>{
 const[m,p]=fixture();p.shieldUntil=1e9;m.blocks[6*15+8]=8001;const b={id:999,x:7,y:6,owner:'q',power:1,explodeAt:99};m.bombs=[b];m.explode(b);
 assert.equal(m.canStand(p,8.5,6.5),false);tick(m,30);assert.equal(m.canStand(p,8.5,6.5),true);
});
test('bubble edge contact does not automatically drag the character sideways',()=>{
 const[m,p]=fixture();p.x=7.82;p.y=7.5;m.bombs=[{id:999,x:7,y:6,owner:'q',power:1,explodeAt:99}];m.setInput('p',{seq:1,dir:'up'});tick(m,40);assert.equal(p.x,7.82);
});
test('single-player normal capture also shows victory after the third enemy bun',()=>{
 const[m,p]=fixture();for(let i=0;i<3;i++){p.inHouse=1;m.objectives(p);p.inHouse=0;m.objectives(p)}assert.equal(m.state,'finished');
});
test('wall drawing state stays foreground inside a wall and clears on open ground',()=>{
 const[m,p]=fixture();m.blocks[6*15+6]=8005;p.x=6.5;p.y=6.5;p.wallPasses=['6,6'];m.move(p,RULES.tick);
 assert.equal(p.renderLayer,'wall');tick(m,50);assert.equal(p.renderLayer,'wall');
 p.x=7.5;p.y=7.5;m.move(p,RULES.tick);assert.equal(p.renderLayer,'ground');
});
