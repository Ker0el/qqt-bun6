import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{spawn}from'node:child_process';import{WebSocket}from'ws';import{Match}from'../public/engine.mjs';
const map=JSON.parse(readFileSync(new URL('../public/assets/map.json',import.meta.url),'utf8'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('buried items are pre-generated, private by default, and revealed only in training',()=>{
 const m=new Match(map,true),p=m.addPlayer('p','tester',0);m.start();m.state='playing';assert(m.hiddenItems.length>0);assert.equal(m.snapshot().hiddenItems.length,0);
 assert(m.setTrainingMod('p','reveal',true));assert.equal(m.snapshot().hiddenItems.length,m.hiddenItems.length);
 const publicMatch=new Match(map,false),q=publicMatch.addPlayer('q','tester',0);publicMatch.start();q.mods.reveal=true;
 assert.equal(publicMatch.setTrainingMod('q','reveal',true),false);assert.equal(publicMatch.snapshot().hiddenItems.length,0);
});
test('noclip collects a buried item once and breaking its wall does not duplicate it',()=>{
 const m=new Match(map,true),p=m.addPlayer('p','tester',0);m.start();m.state='playing';p.shieldUntil=1e9;
 const item=m.hiddenItems.find(i=>i.x>0&&i.x<14&&i.y>0),before=m.hiddenItems.length;
 p.x=item.x+.5;p.y=item.y+.5;m.objectives(p);assert.equal(m.hiddenItems.length,before);
 m.setTrainingMod('p','noclip',true);m.objectives(p);assert.equal(m.hiddenItems.length,before-1);
 const bomb={id:9999,x:item.x-1,y:item.y,owner:'p',power:1,explodeAt:99};m.bombs=[bomb];m.explode(bomb);
 assert(!m.items.some(i=>i.x===item.x&&i.y===item.y));
});
test('chat is scoped to room or lobby, remembers history, and rate-limits spam',async()=>{
 const port=18890,clients=[],server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),PUBLIC_ORIGIN:''},windowsHide:true,stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j);server.once('exit',c=>j(Error('server exit '+c)))});
  const connect=async()=>{const c={ws:new WebSocket(`ws://localhost:${port}`),messages:[]};clients.push(c);c.ws.on('message',x=>c.messages.push(JSON.parse(x)));await new Promise(r=>c.ws.once('open',r));return c};
  const send=(c,m)=>c.ws.send(JSON.stringify(m));const wait=async(c,p)=>{for(let i=0;i<150;i++){const found=c.messages.find(p);if(found)return found;await delay(20)}throw Error('chat timeout')};
  const a=await connect(),b=await connect(),lobby=await connect();send(a,{type:'create',name:'房主'});const{room}=await wait(a,m=>m.type==='joined');send(b,{type:'join',code:room,name:'朋友'});await wait(b,m=>m.type==='joined');
  send(a,{type:'chat',name:'伪造名字',text:'<b>你好</b>'});const chat=await wait(b,m=>m.type==='chat');assert.equal(chat.name,'房主');assert.equal(chat.text,'<b>你好</b>');assert.equal(chat.scope,'room');
  await delay(100);assert(!lobby.messages.some(m=>m.type==='chat'));
  send(a,{type:'chat',text:'too fast'});await wait(a,m=>m.type==='error'&&m.message.includes('发言太快'));
  send(lobby,{type:'chat',name:'大厅访客',text:'大厅消息'});await wait(lobby,m=>m.type==='chat');
  const newcomer=await connect();const history=await wait(newcomer,m=>m.type==='chat-history'&&m.messages.some(x=>x.text==='大厅消息'));assert.equal(history.scope,'lobby');
  assert(!a.messages.some(m=>m.type==='chat'&&m.text==='大厅消息'));
 }finally{for(const c of clients)c.ws.close();server.kill();await delay(100)}
});
