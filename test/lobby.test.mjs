import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {WebSocket} from 'ws';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('shared lobby lists real rooms, updates population, hides practice and enforces 8 players',async()=>{
  const port=18889,clients=[];
  const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),PUBLIC_ORIGIN:''},windowsHide:true,stdio:['ignore','pipe','pipe']});
  try{
    await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error(`exit ${code}`)))});
    const connect=async()=>{const ws=new WebSocket(`ws://localhost:${port}`),c={ws,messages:[]};clients.push(c);ws.on('message',b=>c.messages.push(JSON.parse(b)));await new Promise(r=>ws.once('open',r));return c};
    const wait=async(c,fn)=>{for(let i=0;i<150;i++){const found=c.messages.find(fn);if(found)return found;await delay(20)}throw Error('lobby protocol timeout')};
    const send=(c,m)=>c.ws.send(JSON.stringify(m));
    const host=await connect(),visitor=await connect();
    send(host,{type:'create',name:'Host'});const{room}=await wait(host,m=>m.type==='joined');
    const listed=await wait(visitor,m=>m.type==='lobby'&&m.rooms.some(r=>r.code===room&&r.count===1));
    assert.equal(listed.rooms[0].joinable,true);assert.equal(listed.rooms[0].red,1);assert.equal(listed.rooms[0].blue,0);
    send(host,{type:'start'});await wait(host,m=>m.type==='error'&&m.message.includes('人数相等'));
    send(visitor,{type:'join',code:room,name:'Visitor'});await wait(visitor,m=>m.type==='joined');
    for(let i=2;i<8;i++){const c=await connect();send(c,{type:'join',code:room,name:`Human${i}`});await wait(c,m=>m.type==='joined')}
    const directory=await fetch(`http://localhost:${port}/api/rooms`).then(r=>r.json());
    const full=directory.rooms.find(r=>r.code===room);assert.equal(full.count,8);assert.equal(full.red,4);assert.equal(full.blue,4);assert.equal(full.joinable,false);
    const extra=await connect();send(extra,{type:'join',code:room,name:'Ninth'});await wait(extra,m=>m.type==='error'&&m.message.includes('8 人'));
    send(extra,{type:'create',practice:true,name:'Practice'});await wait(extra,m=>m.type==='joined');
    const after=await fetch(`http://localhost:${port}/api/rooms`).then(r=>r.json());assert.equal(after.rooms.length,1);assert.equal(after.online,9);
    const recent=await wait(visitor,m=>m.type==='state'&&m.players.length===8);assert.equal(recent.players.length,8);
    assert(recent.players.every(p=>!p.bot),'no synthetic participants');
    send(visitor,{type:'leave'});await wait(host,m=>m.type==='lobby'&&m.rooms.some(r=>r.code===room&&r.count===7&&r.joinable));
    for(const c of clients.slice(0,8))c.ws.close();await wait(extra,m=>m.type==='lobby'&&m.rooms.length===0);
  }finally{for(const c of clients)c.ws.close();server.kill();await delay(100)}
});
