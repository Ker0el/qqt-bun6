import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { hydratePlayers } from '../public/engine.mjs';
const cwd=new URL('..',import.meta.url);
const delay=ms=>new Promise(r=>setTimeout(r,ms));

test('two independent clients join, ready, move, bomb, reject late join, and transfer host',async()=>{
  const port=18887;
  const server=spawn(process.execPath,['server.mjs'],{cwd,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
  const clients=[];
  try{
    await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`server exit ${code}`)))});
    const connect=async()=>{
      const ws=new WebSocket(`ws://localhost:${port}`);const c={ws,messages:[],state:null,id:null};clients.push(c);
      ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='state')hydratePlayers(m.players);c.messages.push(m);if(m.type==='state')c.state=m;if(m.type==='hello')c.id=m.id});
      await new Promise(r=>ws.once('open',r));return c;
    };
    const wait=async(c,predicate)=>{for(let i=0;i<100;i++){const found=c.messages.find(predicate);if(found)return found;await delay(30)}throw Error('Timed out waiting for protocol state')};
    const a=await connect(),b=await connect();
    a.ws.send(JSON.stringify({type:'create',name:'Alpha'}));const joined=await wait(a,m=>m.type==='joined');
    b.ws.send(JSON.stringify({type:'join',code:joined.room,name:'Beta'}));await wait(b,m=>m.type==='joined');
    await wait(a,m=>m.type==='state'&&m.players.length===2);
    a.ws.send(JSON.stringify({type:'training-mod',key:'invincible',enabled:true}));
    await wait(a,m=>m.type==='error'&&m.message.includes('单人训练'));
    assert.equal(a.state.players.find(p=>p.id===a.id).mods.invincible,false);
    a.ws.send(JSON.stringify({type:'start'}));await wait(a,m=>m.type==='error'&&m.message.includes('准备'));
    b.ws.send(JSON.stringify({type:'ready'}));await wait(a,m=>m.type==='state'&&m.players.some(p=>p.id===b.id&&p.ready));
    a.ws.send(JSON.stringify({type:'start'}));await wait(a,m=>m.type==='state'&&m.state==='countdown');
    await delay(3200);assert.equal(a.state.state,'playing');assert.equal(b.state.state,'playing');
    const initial=a.state.players.find(p=>p.id===a.id);
    a.ws.send(JSON.stringify({type:'input',seq:1,dir:'left'}));await delay(160);
    assert.equal(a.state.players.find(p=>p.id===a.id).x,initial.x,'the adjacent solid wall blocks left movement');
    a.ws.send(JSON.stringify({type:'input',seq:2,dir:'up'}));await delay(160);
    a.ws.send(JSON.stringify({type:'input',seq:3,dir:null,bomb:true}));await delay(100);
    assert(a.state.players.find(p=>p.id===a.id).y<initial.y);
    assert(Math.abs(a.state.players.find(p=>p.id===a.id).x-b.state.players.find(p=>p.id===a.id).x)<.01);
    assert.equal(a.state.bombs.length,1);assert.deepEqual(a.state.bombs,b.state.bombs);
    const c=await connect();c.ws.send(JSON.stringify({type:'join',code:joined.room,name:'Late'}));await wait(c,m=>m.type==='error'&&m.message.includes('对局'));
    a.ws.close();await wait(b,m=>m.type==='state'&&m.host===b.id&&m.state==='finished');
    assert.equal(b.state.winner,1);
  }finally{for(const c of clients)c.ws.close();server.kill();await delay(100)}
});
