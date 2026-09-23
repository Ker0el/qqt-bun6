#!/usr/bin/env node
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { Match, RULES } from './public/engine.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const map = JSON.parse(await readFile(path.join(root, 'assets/map.json'), 'utf8'));
const rooms = new Map();
const lobbyChat=[];
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.ico': 'image/x-icon' };
const port = Number(process.env.PORT || 8787);
const publicOrigin=process.env.PUBLIC_ORIGIN?.replace(/\/$/,'')||'';
const addresses = Object.entries(os.networkInterfaces()).flatMap(([name, entries]) => entries.map(x => ({...x,name})))
  .filter(x => x.family === 'IPv4' && !x.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address))
  .sort((a,b) => Number(/virtual|vethernet|docker|wsl/i.test(a.name))-Number(/virtual|vethernet|docker|wsl/i.test(b.name)))
  .map(x => `http://${x.address}:${port}`);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if(url.pathname==='/api/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,version:'0.6.0'}));return;}
    if(url.pathname==='/api/rooms'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(lobbyPacket()));return;}
    if (url.pathname === '/api/info') {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ game: 'qqt-bun6-local', addresses:publicOrigin?[publicOrigin]:addresses, port, version: '0.6.0', map: map.name })); return;
    }
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const filename = path.resolve(root, '.' + relative);
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(filename);
    res.writeHead(200, { 'content-type': mime[path.extname(filename)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
const wss = new WebSocketServer({ server, maxPayload: 4096,verifyClient:({origin})=>!publicOrigin||origin===publicOrigin });
const send = (ws, data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
function lobbyPacket(){
  return{type:'lobby',online:[...wss.clients].filter(c=>c.readyState===WebSocket.OPEN).length,
    rooms:[...rooms.values()].filter(r=>!r.match.practice).map(r=>({
      code:r.code,host:r.match.players.find(p=>p.id===r.host)?.name||'糖友',map:map.name,
      count:r.match.players.length,max:RULES.maxPlayers,red:r.match.players.filter(p=>p.team===0).length,
      blue:r.match.players.filter(p=>p.team===1).length,status:r.match.state,
      joinable:r.match.state==='lobby'&&r.match.players.length<RULES.maxPlayers
    }))};
}
let lastDirectory='';
function publishLobby(force=false){
  const packet=lobbyPacket(),signature=JSON.stringify(packet);if(!force&&signature===lastDirectory)return;
  lastDirectory=signature;for(const ws of wss.clients)send(ws,packet);
}
function publish(room) {
  const packet = { type: 'state', room: room.code, host: room.host, ...room.match.snapshot() };
  for (const ws of room.clients.values()) send(ws, packet);
}
function leave(ws) {
  const room = ws.room; if (!room) return;
  room.clients.delete(ws.pid); room.match.removePlayer(ws.pid); ws.room = null;
  if (!room.clients.size) rooms.delete(room.code);
  else { if (room.host === ws.pid) room.host = room.clients.keys().next().value; publish(room); }
  publishLobby();
}
wss.on('connection', ws => {
  ws.pid = randomBytes(6).toString('hex'); ws.window = Date.now(); ws.messages = 0;
  ws.alive=true;ws.on('pong',()=>ws.alive=true);
  send(ws, { type: 'hello', id: ws.pid });
  send(ws,{type:'chat-history',scope:'lobby',messages:lobbyChat});
  publishLobby(true);
  ws.on('message', raw => {
    if (Date.now() - ws.window > 1000) { ws.window = Date.now(); ws.messages = 0; }
    if (++ws.messages > 180) { ws.close(1008, 'Too many messages'); return; }
    try {
      const msg = JSON.parse(raw.toString());
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ping') { send(ws, { type: 'pong', sent: msg.sent }); return; }
      if(msg.type==='lobby'){send(ws,lobbyPacket());return;}
      if(msg.type==='chat'){
        if(typeof msg.text!=='string')return;
        const message=Array.from(msg.text.replace(/[\u0000-\u001f\u007f]/g,' ').trim()).slice(0,140).join('');if(!message)return;
        if(Date.now()-(ws.lastChat||0)<600){send(ws,{type:'error',message:'发言太快，请稍候'});return;}ws.lastChat=Date.now();
        const room=ws.room,p=room?.match.players.find(p=>p.id===ws.pid);
        const packet={type:'chat',id:randomBytes(6).toString('hex'),scope:room?'room':'lobby',player:ws.pid,name:p?.name||String(msg.name||'糖友').trim().slice(0,12),text:message,time:Date.now()};
        const history=room?(room.chat??=[]):lobbyChat;history.push(packet);if(history.length>30)history.shift();
        for(const client of room?room.clients.values():wss.clients)if(room||!client.room)send(client,packet);
        return;
      }
      if (msg.type === 'leave') { leave(ws); send(ws, { type: 'left' });send(ws,{type:'chat-history',scope:'lobby',messages:lobbyChat});return; }
      if (msg.type === 'create' || msg.type === 'join') {
        let room;
        if (msg.type === 'create') {
          if (rooms.size >= 50) { send(ws, { type: 'error', message: '房间已满，请稍后再试' }); return; }
          let code; do { code = String(100000 + randomBytes(4).readUInt32LE() % 900000); } while (rooms.has(code));
          room = { code, match: new Match(map, msg.practice === true,randomBytes(4).readUInt32LE()), clients: new Map(), host: ws.pid };
        } else {
          room = rooms.get(String(msg.code || '').replace(/\s/g, ''));
          if (!room) { send(ws, { type: 'error', message: '没有找到这个房间，请核对房间号' }); return; }
          if (room.match.practice) { send(ws, { type: 'error', message: '练习场仅供单人使用，请创建联机房间' }); return; }
          if (room.match.state !== 'lobby') { send(ws, { type: 'error', message: '该房间正在对局，请等房主返回房间' }); return; }
          if (room.clients.size >= RULES.maxPlayers) { send(ws, { type: 'error', message: '房间已有 8 人' }); return; }
        }
        leave(ws);
        rooms.set(room.code, room); ws.room = room; room.clients.set(ws.pid, ws);
        const red = room.match.players.filter(p => p.team === 0).length;
        const blue = room.match.players.filter(p => p.team === 1).length;
        const joinedPlayer=room.match.addPlayer(ws.pid, String(msg.name || '糖友').trim().slice(0, 12) || '糖友', red <= blue ? 0 : 1);
        joinedPlayer.skin=msg.skin==='fire'?'fire':'classic';
        send(ws, { type: 'joined', room: room.code, id: ws.pid, practice: room.match.practice });
        send(ws,{type:'chat-history',scope:'room',messages:room.chat||[]});
        if (room.match.practice) room.match.start();
        publish(room);publishLobby(); return;
      }
      const room = ws.room; if (!room) return;
      const p = room.match.players.find(p => p.id === ws.pid); if (!p) return;
      if(msg.type==='use-fork'){if(room.match.useFork(ws.pid))publish(room);return;}
      if(msg.type==='place-banana'){if(room.match.placeBanana(ws.pid))publish(room);return;}
      if(msg.type==='place-smile'){if(room.match.placeTrap(ws.pid,'smile'))publish(room);return;}
      if(msg.type==='emote'){
        if(room.match.state==='playing'&&p.status==='alive'&&typeof msg.key==='string'&&/^[tyuiop]$/.test(msg.key)&&(!p.emoteUntil||p.emoteUntil-room.match.time<2)){
          p.emote=msg.key;p.emoteUntil=room.match.time+3;publish(room);
        }
        return;
      }
      if(msg.type==='training-mod'||msg.type==='training-win'){
        if(!room.match.practice||room.clients.size!==1||room.host!==ws.pid){send(ws,{type:'error',message:'训练修改功能只允许在单人训练中使用'});return;}
        const ok=msg.type==='training-win'?room.match.beginTrainingWin(ws.pid):room.match.setTrainingMod(ws.pid,msg.key,msg.enabled);
        if(!ok)send(ws,{type:'error',message:'无效的训练选项'});else publish(room);
        return;
      }
      if (msg.type === 'appearance') p.skin=msg.skin==='fire'?'fire':'classic';
      if (msg.type === 'input') { room.match.setInput(ws.pid, msg); return; }
      if (msg.type === 'ready' && room.match.state === 'lobby') p.ready = !p.ready;
      if (msg.type === 'team' && room.match.state === 'lobby') {
        const target = 1 - p.team;
        if (room.match.players.filter(p => p.team === target).length >= 4) { send(ws, { type: 'error', message: '这支队伍已满' }); return; }
        p.team = target; p.ready = false; room.match.spawn(p);
      }
      if (msg.type === 'start' && room.host === ws.pid && room.match.state === 'lobby') {
        const red = room.match.players.filter(p => p.team === 0).length, blue = room.match.players.length - red;
        if (!red || red !== blue) { send(ws, { type: 'error', message: '需要红蓝双方人数相等（至少 1 对 1）' }); return; }
        if (room.match.players.some(p => p.id !== room.host && !p.ready)) { send(ws, { type: 'error', message: '请等待其他玩家准备' }); return; }
        room.match.start();
      }
      if (msg.type === 'drill' && room.match.practice && ['map', 'phase', 'run', 'wall', 'wall3', 'pillar', 'house'].includes(msg.mode)) room.match.setupDrill(ws.pid, msg.mode);
      if (msg.type === 'return' && room.host === ws.pid && room.match.state === 'finished') {
        room.match.state = 'lobby'; for (const p of room.match.players) { p.ready = false; room.match.spawn(p); }
      }
      publish(room);publishLobby();
    } catch { send(ws, { type: 'error', message: '消息格式错误' }); }
  });
  ws.on('close', () => {leave(ws);publishLobby(true)}); ws.on('error', () => {});
});
const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue}ws.alive=false;ws.ping()}},30000);
let previous = performance.now(), accumulator = 0, broadcasts = 0;
const timer = setInterval(() => {
  const now = performance.now(); accumulator += Math.min(.25, (now - previous) / 1000); previous = now;
  while (accumulator >= RULES.tick) {
    for (const room of rooms.values()) room.match.tick();
    accumulator -= RULES.tick; broadcasts++;
    if (broadcasts % 2 === 0) for (const room of rooms.values()) publish(room);
    if(broadcasts%120===0)publishLobby();
  }
}, 8);
server.listen(port, '0.0.0.0', async () => {
  if (port === 8787) {
    const runtime=path.join(root,'..','.runtime');await mkdir(runtime,{recursive:true});
    await writeFile(path.join(runtime,'server.pid'),String(process.pid));
  }
  console.log(`QQ堂 · 抢包山 6\nLocal: http://localhost:${port}\n${addresses.map(a => `LAN: ${a}`).join('\n')}`);
});
server.on('error', err => { console.error(err.message); clearInterval(timer); process.exit(1); });
process.on('SIGTERM', () => { clearInterval(timer);clearInterval(heartbeat);for(const ws of wss.clients)ws.close();wss.close();server.close(); });


