import { Match, RULES, DIR, hydratePlayers } from './engine.mjs';
import {hiddenInWater,waterElementPosition} from './water-visuals.mjs';

const $ = id => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d');
const manifest = await fetch('/assets/manifest.json').then(r => r.json());
const bunMap = await fetch('/assets/map.json').then(r => r.json());
const waterMap = await fetch('/assets/water11.json').then(r => r.json());
let map=bunMap;
const images = new Map(); let loaded = 0;
await Promise.all(Object.entries(manifest).map(([key, meta]) => new Promise((resolve, reject) => {
  const image = new Image(); image.onload = () => { images.set(key, image); loaded++; $('load-progress').textContent = `正在加载素材中... ${loaded} / ${Object.keys(manifest).length}`; resolve(); };
  image.onerror = () => reject(new Error(`无法加载 ${meta.src}`)); image.src = meta.src;
}))).catch(err => { $('load-progress').textContent = err.message; throw err; });
$('loading').hidden = true; $('home-panel').hidden = false;

const demo = new Match(map);
let state = demo.snapshot(), socket, myId = null, roomCode = null, hostId = null;
let sequence = 0, keys = [], seenEvent = 0, localEffects = [], debug = false;
let sound = true, bgm, toastTimer, lastStateAt = performance.now(), previousFrame = performance.now();
// 本机玩家视觉预测：按住方向键时立即位移，服务器确认后平滑收敛。
// maxLead 限制视觉位置最多超前权威位置多少格（0.75 格≈30px，足以消除往返延迟的粘滞感，
// 又不会在撞墙时滑出去）；reconcile 越大归位越快，过大则收敛会显得突兀。
const PREDICT = { speed: RULES.speed, maxLead: .75, reconcile: 8 };
let predicted = null;
let rendered = new Map(), countdownSound = false, lastUI = '', reconnectTimer;
// 服务器省略空值/默认值字段以压缩快照，这里按引擎给出的同一套默认值补齐，
// 否则 undefined 会让 `carry !== null`、`trappedUntil - RULES.trap` 之类的判断失真。
let blocksCache = null;
// 服务器按需下发 blocks，所以缓存为空时回退到原始地图（demo 快照的 blocks 就是 map.blocks）。
// 绝不能返回 undefined —— 渲染循环用 blocks()[y*15+x] 取值，一旦抛异常整个画面会只剩背景。
const blocks = () => blocksCache || state.blocks || map.blocks;
let directory={online:0,rooms:[]};
let chatMessages=[],lastExplosionSound=-1000;
const urlRoom = new URL(location.href).searchParams.get('room');
if (urlRoom) $('room-code').value = urlRoom.replace(/\D/g,'').slice(0,6);
$('nickname').value = localStorage.getItem('qqt-name') || '糖友';

function sprite(name, x, y, frame = 0, scale = 1, alpha = 1) {
  const meta = manifest[name], img = images.get(name); if (!meta || !img) return;
  frame = ((Math.floor(frame) % meta.frames) + meta.frames) % meta.frames;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.drawImage(img, frame * meta.w, 0, meta.w, meta.h, Math.round(x), Math.round(y), meta.w * scale, meta.h * scale);
  ctx.restore();
}
function text(value, x, y, size = 12, color = '#fff', align = 'center', outline = true) {
  ctx.save(); ctx.font = `bold ${size}px "QQTangSong","Microsoft YaHei",sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  if (outline) { ctx.lineWidth = 3; ctx.strokeStyle = '#165c80'; ctx.strokeText(value, x, y); }
  ctx.fillStyle = color; ctx.fillText(value, x, y); ctx.restore();
}
function carriedBun(x, y, s = 1) {
  const m=manifest['bun-original'];if(!m)return;
  const scale=s*20/m.w;
  sprite('bun-original',x-m.w*scale/2,y-m.h*scale/2,performance.now()/m.duration,scale);
}
function bun(x,y,s=1,owner=0){
  ctx.save();ctx.translate(x,y);ctx.scale(s,s);
  ctx.fillStyle=owner===1?'#ffb7d0':'#ffdf91';ctx.strokeStyle=owner===1?'#cc7297':'#d58d42';ctx.lineWidth=1;
  ctx.beginPath();ctx.ellipse(0,1,7,5.5,0,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.fillStyle=owner===1?'#ffedf5':'#fff4c3';ctx.beginPath();ctx.ellipse(-1,-1,6,4,0,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#d6a15b';for(let i=-1;i<=1;i++){ctx.beginPath();ctx.moveTo(i*2,-4);ctx.quadraticCurveTo(i*3,-1,i*3,1);ctx.stroke()}ctx.restore();
}
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3500); }
function send(data) { if (socket?.readyState === WebSocket.OPEN) { if(data.type==='create'||data.type==='join')data.skin='classic';socket.send(JSON.stringify(data)); return true; } toast('连接尚未就绪，请稍候'); return false; }
function play(name, volume = .35) {
  if (!sound) return;
  const a = new Audio(`/assets/${name}`); a.volume = volume; a.play().catch(() => {});
}
function updateMusic() {
  if (!bgm) { bgm = new Audio('/assets/match.ogg'); bgm.loop = true; bgm.volume = .18; }
  if (sound && roomCode) bgm.play().catch(() => {}); else bgm.pause();
}
function connect() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`);
  socket.addEventListener('open', () => { $('connection-dot').classList.add('online'); $('connection-label').textContent = '本地服务已连接'; });
  socket.addEventListener('message', ({data}) => {
    const msg = JSON.parse(data);
    if (msg.type === 'hello') myId = msg.id;
    if(msg.type==='chat'){chatMessages.push(msg);chatMessages=chatMessages.slice(-8);renderChat();}
    if(msg.type==='chat-history'){chatMessages=msg.messages.slice(-8);renderChat();}
    if(msg.type==='lobby'){directory=msg;renderLobby();}
    if (msg.type === 'pong') $('latency').textContent = `${Math.round(performance.now()-msg.sent)} ms`;
    if (msg.type === 'error') { toast(msg.message); resetButtons(); }
    if (msg.type === 'joined') {
      roomCode = msg.room; myId = msg.id; seenEvent = 0; rendered.clear(); lastUI = ''; keys = []; sequence = 0; predicted = null;
      localStorage.setItem('qqt-name', $('nickname').value.trim()); updateMusic(); resetButtons();
    }
    if (msg.type === 'state') {
      const nextMap=msg.mapId==='water11_8'?waterMap:bunMap;
      if(map!==nextMap){map=nextMap;blocksCache=null;predicted=null;rendered.clear();}
      if (msg.blocks) blocksCache = msg.blocks;
      hydratePlayers(msg.players);
      state = msg; hostId = msg.host; lastStateAt = performance.now();
      for (const event of msg.events) if (event.id > seenEvent) { handleEvent(event); seenEvent = event.id; }
      updateUI();
    }
    if (msg.type === 'left') resetHome();
  });
  socket.addEventListener('close', () => {
    $('connection-dot').classList.remove('online'); $('connection-label').textContent = '连接断开 · 正在重连'; $('latency').textContent='— ms';
    if (roomCode) { resetHome(); toast('与本地服务断开连接，请重新加入房间'); }
    clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 1600);
  });
}
connect();
setInterval(() => { if (socket?.readyState === 1) socket.send(JSON.stringify({ type: 'ping', sent: performance.now() })); }, 2000);
function resetButtons() { for (const id of ['create-room','join-room','practice']) $(id).disabled=false; }
function renderLobby(){
  $('lobby-count').textContent=`在线 ${directory.online} 人 · ${directory.rooms.length} 个房间`;
  const list=$('public-rooms');list.replaceChildren();
  if(!directory.rooms.length){const empty=document.createElement('p');empty.className='empty-lobby';empty.textContent='暂时没有房间，来创建第一间吧。';list.append(empty);return;}
  for(const room of directory.rooms){
    const row=document.createElement('div');row.className='public-room';
    const info=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('span');
    name.textContent=`${room.host}的房间`;detail.textContent=`${room.code} · ${room.count}/${room.max} 人 · 红 ${room.red} / 蓝 ${room.blue}`;info.append(name,detail);
    const join=document.createElement('button');join.className='blue-button small';join.disabled=!room.joinable;
    join.textContent=room.joinable?'加入':room.status==='lobby'?'已满':room.status==='finished'?'结算中':'对战中';
    join.setAttribute('aria-label',`加入房间 ${room.code}`);join.onclick=()=>send({type:'join',code:room.code,name:nickname()});row.append(info,join);list.append(row);
  }
}
function resetHome() {
  map=bunMap;
  roomCode=null;state=demo.snapshot();keys=[];rendered.clear();localEffects=[];predicted=null;blocksCache=null;updateMusic();
  $('home-panel').hidden=false; $('room-panel').hidden=true; $('result-panel').hidden=true; $('leave-game').hidden=true; $('footer-status').textContent='抢走对方全部包子并运回自己的包房，即可获胜。'; resetButtons();
  $('death-screen').hidden=true;if($('training-dialog').open)$('training-dialog').close();
  closeChat();chatMessages=[];renderChat();
}
function renderChat(){
  const log=$('chat-log');log.replaceChildren();
  for(const message of chatMessages){const line=document.createElement('div');line.className='chat-message';const author=document.createElement('strong');author.textContent=`${message.name}：`;line.append(author,document.createTextNode(message.text));log.append(line)}
  log.scrollTop=log.scrollHeight;
}
function openChat(){release();$('chat-form').hidden=false;$('chat-panel').classList.add('typing');$('chat-scope').textContent=roomCode?'房间':'大厅';$('chat-input').focus();}
function closeChat(){$('chat-form').hidden=true;$('chat-panel').classList.remove('typing');canvas.focus();}
function handleEvent(e) {
  if(e.type==='boss-loot'&&e.player===myId)toast('获得'+({rose:'玫瑰花',chest:'宝箱',luckybag:'福袋',kubi:'酷比'}[e.kind]));
  if (e.type === 'start') { play('ReadyGo.wav',.5); countdownSound=true; }
  if (e.type === 'bomb'&&e.player===myId) play('place.wav',.28);
  if (e.type === 'explode'&&performance.now()-lastExplosionSound>60){play('bomb.wav',.25);lastExplosionSound=performance.now();}
  if(e.type==='death')play('trapped-pop.wav',.3);
  if (e.type === 'break') localEffects.push({...e,received:performance.now()});
  if(e.type==='death'||e.type==='training-warp'||e.type==='cave-lit')localEffects.push({...e,received:performance.now()});
  // 穿泡/借泡只留地面光环，不再弹「穿泡成功 · x 秒」这类文字提示。
  if (e.type === 'phase' || e.type === 'wall') localEffects.push({...e,received:performance.now()});
  // 「放泡太早/太晚」的提示同理已去掉。
  if (e.type === 'steal') toast(`${state.players.find(p=>p.id===e.player)?.name || '糖友'} 抢到包子了！`);
  if (e.type === 'capture') { toast(`${e.team===0?'红队':'蓝队'} 带回一个包子！`); play('uiMain.wav'); }
  if (e.type === 'recover' && e.player===myId) toast(e.own?'捡回己方包子，带回自己的包子铺！':'捡到包子，带回自己的包子铺！');
  if (e.type === 'return-bun') toast(`${e.team===0?'红队':'蓝队'} 护送包子回家了！`);
  if (e.type === 'enter-house' && e.player===myId) toast('已进入包子房 · 蓝色箭头标记你的位置');
  if (e.type === 'finish') { const me=state.players.find(p=>p.id===myId);play(me?.team===e.winner?'PlayerWin.ogg':'PlayerLoss.ogg',.35); }
}
function roster(target, team) {
  const list=$(target); list.replaceChildren();
  const players=state.players.filter(p=>p.team===team);
  for(let i=0;i<(state.mode==='water11'&&team===0?5:4);i++) {
    const row=document.createElement('div');row.className='roster-row';const p=players[i];
    if(p){
      const image=document.createElement('img');image.src=`/assets/prince-${team===0?'red':'blue'}-stand-3.png`;image.alt='';
      const name=document.createElement('span');name.className='name';name.textContent=p.name+(p.id===myId?'（你）':'');
      const ready=document.createElement('em');ready.textContent=p.id===hostId?'房主':p.ready?'已准备':'等待';
      row.append(image,name,ready);
    }else{row.textContent='等待加入';row.classList.add('roster-empty')}
    list.append(row);
  }
}
function updateUI() {
  const lobby=state.state==='lobby', finished=state.state==='finished';
  $('home-panel').hidden=true; $('room-panel').hidden=!lobby; $('result-panel').hidden=!finished; $('leave-game').hidden=lobby;
  const self=state.players.find(p=>p.id===myId);
  const water=state.mode==='water11';
  $('switch-team').hidden=water;
  $('blue-roster').parentElement.hidden=water;
  document.querySelector('.red-heading').textContent=water?'合作队伍':'红队';
  document.querySelector('#room-panel .window-title span').textContent=water?'水面 11 · 等待开局':'抢包山 6 · 等待开局';
  $('death-screen').hidden=!(self?.status==='dead'&&state.state==='playing');
  if(self?.status==='dead')$('respawn-count').textContent=water?'观战':String(Math.max(0,Math.ceil(self.respawnAt-state.time)));
  $('death-screen').querySelector('small').textContent=water?'等待队友击败水手':'等待复活';
  let cry=$('death-cry-overlay');
  if(!cry){cry=document.createElement('img');cry.id='death-cry-overlay';cry.src='/assets/death-cry.gif';cry.alt='';$('death-screen').append(cry)}
  cry.hidden=!(self?.status==='dead'&&state.time-self.respawnAt+RULES.respawn<2);
  if(!cry.hidden){cry.style.left=`${(self.x*40-50)/600*100}%`;cry.style.top=`${(22+self.y*40-64)/542*100}%`}
  if(!state.practice&&$('training-dialog').open)$('training-dialog').close();
  for(const checkbox of document.querySelectorAll('[data-mod]'))checkbox.checked=!!self?.mods?.[checkbox.dataset.mod];
  $('connection-label').textContent=state.practice?'单人练习场':`房间 ${roomCode}`;
  // 水面11 不在这条状态栏里报血量：血条按原版挂在 boss 头上，这一行整行留空。
  // 用清空而不是 hidden —— footer 是 space-between，藏掉左侧会把它右对齐的落款挤到左边。
  $('footer-status').textContent=water?'':`房间 ${roomCode} · ${state.players.length}/8 人 · 带回敌包 红 ${state.captured?.[0]||0}/3 · 蓝 ${state.captured?.[1]||0}/3`;
  const signature=JSON.stringify([state.state,hostId,state.players.map(p=>[p.id,p.name,p.team,p.ready])]);
  if(signature!==lastUI){
    lastUI=signature;
    if(lobby){
      $('room-number').textContent=roomCode;roster('red-roster',0);roster('blue-roster',1);
      const me=state.players.find(p=>p.id===myId);
      $('ready-button').textContent=myId===hostId?'开始游戏':me?.ready?'取消准备':'准 备';
      $('room-hint').textContent=state.players.length<2?'邀请一位糖友加入，开始红蓝对战':'双方人数相等，所有糖友准备后即可开局';
      if(water)$('room-hint').textContent='水面11 · 1–5人合作挑战海盗水手，全员准备后开局';
    }
    if(finished){
      $('result-title').textContent=state.winner===null?'平 局':state.winner===0?'红队获胜！':'蓝队获胜！';
      if(water)$('result-title').textContent=state.winner===0?'挑战成功！':'挑战失败';
      $('result-reason').textContent=state.reason;$('result-stats').replaceChildren();
      for(const p of state.players){const row=document.createElement('div');row.className='result-stat';const name=document.createElement('span');name.textContent=p.name;const result=document.createElement('span');result.textContent=`抢回 ${p.captures} · 击破 ${p.kills}`;row.append(name,result);$('result-stats').append(row)}
      $('return-room').textContent=state.practice?'再练一次':myId===hostId?'返回房间':'等待房主返回房间';$('return-room').disabled=myId!==hostId;
    }
  }
  if(state.practice){
    }
}
function nickname(){return $('nickname').value.trim()||'糖友'}
$('create-room').onclick=()=>{if(send({type:'create',mapId:$('map-select').value,name:nickname()}))$('create-room').disabled=true};
$('join-room').onclick=()=>{const code=$('room-code').value.trim();if(!/^\d{6}$/.test(code)){toast('请输入 6 位房间号');return}if(send({type:'join',code,name:nickname()}))$('join-room').disabled=true};
$('room-code').addEventListener('keydown',e=>{if(e.key==='Enter')$('join-room').click()});
$('practice').onclick=()=>{if(send({type:'create',practice:true,mapId:$('map-select').value,name:nickname()})){$('practice').disabled=true;canvas.focus()}};
$('ready-button').onclick=()=>{send({type:myId===hostId?'start':'ready'});canvas.focus()};
$('switch-team').onclick=()=>send({type:'team'});
for(const id of ['leave-lobby','leave-game'])$(id).onclick=()=>{release();play('uiLeave.wav',.25);send({type:'leave'})};
$('return-room').onclick=()=>send(state.practice?{type:'drill',mode:state.drill||'map'}:{type:'return'});
$('copy-invite').onclick=async()=>{
  try{await navigator.clipboard.writeText(`${location.origin}/?room=${roomCode}`);toast('邀请链接已复制；局域网朋友请使用房主局域网地址')}
  catch{toast(`房间号：${roomCode}`)}
};
$('sound-button').onclick=()=>{sound=!sound;$('sound-button').textContent=`声音：${sound?'开':'关'}`;updateMusic();if(sound)play('uiNormal.wav');canvas.focus()};
$('fullscreen-button').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else document.querySelector('.game-frame').requestFullscreen().catch(()=>toast('当前浏览器不支持全屏'));canvas.focus()};
$('help-button').onclick=()=>{release();$('help-dialog').showModal()};
$('close-help').onclick=()=>{$('help-dialog').close();canvas.focus()};
$('chat-form').onsubmit=e=>{e.preventDefault();const message=$('chat-input').value.trim();if(message&&!send({type:'chat',name:nickname(),text:message}))return;$('chat-input').value='';closeChat();};
$('chat-input').addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();closeChat()}});
$('support-button').onclick=()=>{release();closeChat();$('support-dialog').showModal()};
$('close-support').onclick=()=>{$('support-dialog').close();canvas.focus()};
document.addEventListener('click',e=>{const button=e.target.closest('button');if(button&&button.id!=='sound-button')play('uiMain.wav',.12)});
$('close-training').onclick=()=>{$('training-dialog').close();canvas.focus()};
for(const checkbox of document.querySelectorAll('[data-mod]'))checkbox.onchange=()=>send({type:'training-mod',key:checkbox.dataset.mod,enabled:checkbox.checked});
$('training-win').onclick=()=>{send({type:'training-win'});$('training-dialog').close();canvas.focus()};


const keyMap={ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down',ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right'};
function input(bomb=false){if(roomCode&&socket?.readyState===1)socket.send(JSON.stringify({type:'input',seq:++sequence,dir:keys.length?keyMap[keys.at(-1)]:null,bomb}))}
function release(){keys=[];input()}
window.addEventListener('keydown',e=>{
  if(e.code==='Enter'&&!['INPUT','TEXTAREA','BUTTON','SELECT'].includes(document.activeElement?.tagName)&&!$('help-dialog').open&&!$('training-dialog').open&&!$('support-dialog').open){e.preventDefault();openChat();return;}
  if(e.code==='F2'){e.preventDefault();if(!state.practice||!roomCode){toast('F2 菜单仅在单人训练中可用');return}release();if($('training-dialog').open)$('training-dialog').close();else $('training-dialog').showModal();return;}
  if(['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)||$('help-dialog').open||$('training-dialog').open||$('support-dialog').open||!roomCode||!['playing','countdown'].includes(state.state))return;
  if(keyMap[e.code]){e.preventDefault();if(!keys.includes(e.code)){keys.push(e.code);input()}}
  if(e.code==='Space'){e.preventDefault();if(!e.repeat||(state.practice&&state.players.find(p=>p.id===myId)?.mods?.bombs))input(true)}
  if((e.code==='Digit1'||e.code==='Numpad1')&&!e.repeat){e.preventDefault();socket?.send(JSON.stringify({type:'use-fork'}))}
  if((e.code==='Digit2'||e.code==='Numpad2')&&!e.repeat){e.preventDefault();socket?.send(JSON.stringify({type:'place-banana'}))}
  if((e.code==='Digit3'||e.code==='Numpad3')&&!e.repeat){e.preventDefault();socket?.send(JSON.stringify({type:'place-smile'}))}
  if(/^Key[TYUIOP]$/.test(e.code)&&!e.repeat){e.preventDefault();socket?.send(JSON.stringify({type:'emote',key:e.code.at(-1).toLowerCase()}))}
});
window.addEventListener('keyup',e=>{if(keyMap[e.code]){keys=keys.filter(k=>k!==e.code);input()}});
window.addEventListener('blur',release);document.addEventListener('visibilitychange',()=>{if(document.hidden)release()});
canvas.addEventListener('pointerdown',()=>canvas.focus());

const OX=8, OY=22, T=40;
// 困泡时长由服务端决定（PVE 水面11 是 RULES.trapPve），快照里只下发一次。
// 破泡动画的播放进度要靠它反推：写成函数是为了每次读当前 state，而不是建场时的那份。
const trapDuration=()=>state.trapDuration??RULES.trap;
function standingLift(p){if(p.renderLayer!=='wall'||!p.renderWallCell)return 0;const[x,y]=p.renderWallCell.split(',').map(Number);return Math.max(0,(manifest[`tile${blocks()[y*15+x]-8000}`]?.h||40)-40)}
function playerSprite(p, x, y, time, alpha=1){
  if(hiddenInWater(map,p))return;
  const team=p.team===0?'red':'blue',action=p.moving?'walk':'stand',dir=DIR[p.dir]?.[2]??3;
  const lift=standingLift(p);
  ctx.save();
  ctx.fillStyle='#2a46144d';ctx.beginPath();ctx.ellipse(x,y+17,13,5,0,0,Math.PI*2);ctx.fill();
  if(p.status==='trapped'){
    const age=Math.max(0,state.time-(p.trappedUntil-trapDuration())),key=age<.4?'trap-bubble':'trap-shell',m=manifest[key];
    sprite(key,x-m.w/2,y+19-m.h-lift,age<.4?age*12:time/100,1,.85);
    sprite(`prince-${team}-trigger`,x-50,y-64-lift,time/100,1,alpha);
    sprite(key,x-m.w/2,y+19-m.h-lift,age<.4?age*12:time/100,1,.28);
  }else sprite(`prince-${team}-${action}-${dir}`,x-50,y-64-lift,p.moving?time/80:0,1,alpha);
  ctx.restore();
}
function selfMarker(p){
  const pos=rendered.get(p.id)||p,rawY=OY+pos.y*T-(p.carry===null?48:72)-standingLift(p);
  const x=OX+pos.x*T+(p.carry!==null&&rawY<16?(pos.x>13.5?-24:24):0),y=Math.max(16,rawY);
  ctx.save();ctx.translate(x,y);ctx.strokeStyle='#eaffff';ctx.fillStyle='#44b7ff';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(-4,-10);ctx.lineTo(4,-10);ctx.lineTo(4,-3);ctx.lineTo(9,-3);ctx.lineTo(0,6);ctx.lineTo(-9,-3);ctx.lineTo(-4,-3);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
}
function render(now){
  const dt=Math.min(.05,(now-previousFrame)/1000);previousFrame=now;
  ctx.clearRect(0,0,800,600);ctx.fillStyle='#2594cb';ctx.fillRect(0,0,800,600);
  ctx.save();ctx.beginPath();ctx.rect(8,0,600,542);ctx.clip();
  for(let y=0;y<13;y++)for(let x=0;x<15;x++)sprite(map.mode==='water11'?`water-${map.ground[y*15+x]}`:'tile11',OX+x*T,OY+y*T);
  if(map.mode!=='water11')for(let y=0;y<13;y++)for(let x=0;x<15;x++){const tile=map.ground[y*15+x];if(tile>0&&tile!==8011)sprite(`tile${tile-8000}`,OX+x*T,OY+y*T)}
  for(const item of state.items||[]){if(item.availableAt>state.time)continue;const key={capacity:'item1',power:'item2',speed:'item3',fork:'item24',banana:'item23','banana-trap':'item42',smile:'item25','smile-trap':'item25',rose:'item301',chest:'item213',luckybag:'item202',kubi:'item98'}[item.kind];const m=manifest[key];if(m)sprite(key,OX+(item.x+.5)*T-m.w/2,OY+(item.y+.5)*T-m.h/2,now/130)}
  for(let y=0;y<13;y++)for(let x=0;x<15;x++){const tile=map.ground[y*15+x];if(tile>0&&tile!==8011)sprite(`tile${tile-8000}`,OX+x*T,OY+y*T)}
  for(const item of state.items||[]){if(item.availableAt>state.time)continue;const key={capacity:'item1',power:'item2',speed:'item3',fork:'item24',banana:'item23','banana-trap':'item42',smile:'item25','smile-trap':'item25'}[item.kind];const m=manifest[key];if(m)sprite(key,OX+(item.x+.5)*T-m.w/2,OY+(item.y+.5)*T-m.h/2,now/130)}
  for(const b of state.buns||[])bun(OX+(b.x+.5)*T,OY+(b.y+.5)*T,1.5,b.owner);
  for(const f of state.flames||[]){
    if(map.bases.some(b=>f.x>=b.x&&f.x<b.x+b.w&&f.y>=b.y&&f.y<b.y+b.h))continue;
    const x=OX+(f.x+.5)*T,y=OY+(f.y+.5)*T;
    const parts={right:[2,6],up:[3,7],left:[4,8],down:[5,9]};
    const key=f.arm==='center'?'flame1':`flame${parts[f.arm][f.end?1:0]}`;
    const m=manifest[key];sprite(key,x-m.w/2,y-m.h/2,Math.min(m.frames-1,(state.time-f.born)/RULES.flame*m.frames));
  }
  const drawables=[];
  if(map.mode==='water11'){
    for(const o of map.objects)if(!o.breakable||blocks()[o.y*15+o.x])drawables.push({...o,z:o.y+o.h-.2,type:'water'});
    if(state.boss)drawables.push({z:state.boss.y,type:'boss',p:state.boss});
  }
  if(map.mode!=='water11')for(let y=0;y<13;y++)for(let x=0;x<15;x++){
    const tile=blocks()[y*15+x];if(tile>0)drawables.push({z:y+.8,type:'tile',tile:tile-8000,x,y});
    const building=map.structures[y*15+x];if(building>0)drawables.push({z:y+2.7,type:'building',tile:building-8000,x,y});
  }
  for(const b of state.bombs||[]){
    // 洞口里的糖泡跟人和水手一样藏起来；爆炸不藏，火焰照常画。
    if(hiddenInWater(map,{x:b.x+.5,y:b.y+.5}))continue;
    const occupants=(state.players||[]).filter(p=>Math.floor(p.x)===b.x&&Math.floor(p.y)===b.y);
    drawables.push({z:Math.min(b.y+.35,...occupants.map(p=>p.y-.01)),type:'bomb',b});
  }
  for(const p of state.players||[])if(p.status!=='dead'&&p.inHouse===null&&p.renderLayer!=='wall')drawables.push({z:p.y,type:'player',p});
  drawables.sort((a,b)=>a.z-b.z);
  for(const d of drawables){
    if(d.type==='water'){
      const anchor=waterElementPosition(d,T);sprite(`water-${d.id}`,OX+anchor.x,OY+anchor.y,now/100);
      // 玩家踏进洞口时铺上原版 trigger 的 5 帧点亮动画。和洞口同一层画，站在洞口
      // 前面的角色才不会被它盖住。
      if(d.id===5010){
        const lit=localEffects.find(e=>e.type==='cave-lit'&&e.x===d.x&&e.y===d.y),m=manifest['water-trigger-5010'];
        if(lit&&m){const age=(now-lit.received)/1000;
          sprite('water-trigger-5010',OX+anchor.x,OY+anchor.y,Math.min(m.frames-1,age*12),1,Math.max(0,1-age/.6));}
      }
    }else if(d.type==='boss'){
      if(hiddenInWater(map,d.p)||(d.p.hp<=0&&state.time>d.p.phaseUntil))continue;
      const b=d.p,action=b.hp<=0?'die':b.phase==='birth'?'birth':b.moving?`walk-${DIR[b.dir][2]}`:`stand-${DIR[b.dir][2]}`,key=`sailor-${action}`,m=manifest[key];
      if(m){const frame=b.hp<=0?Math.min(m.frames-1,(state.time-b.phaseUntil+.9)*10):b.phase==='birth'?Math.min(m.frames-1,state.time*10):now/100;
        sprite(key,OX+b.x*T-m.w/2,OY+b.y*T-64,frame,1,state.time<b.hurtUntil&&Math.floor(now/90)%2?.5:1);}
    }else if(d.type==='tile'||d.type==='building'){
      const m=manifest[`tile${d.tile}`];if(m)sprite(`tile${d.tile}`,OX+d.x*T,OY+(d.y+(d.type==='building'?3:1))*T-m.h);
    }else if(d.type==='bomb'){
      const b=d.b,key=b.skin==='fire'?'bomb-fire':'bomb1',m=manifest[key];
      sprite(key,OX+(b.x+.5)*T-m.w/2,OY+(b.y+.5)*T-m.h/2-(b.skin==='fire'?5:0),(now/(b.skin==='fire'?200:170)));
    }else{
      const p=d.p;let pos=rendered.get(p.id);
      if(!pos||Math.hypot(pos.x-p.x,pos.y-p.y)>1.5)pos={x:p.x,y:p.y};
      else{const blend=1-Math.exp(-dt*65);pos.x+=(p.x-pos.x)*blend;pos.y+=(p.y-pos.y)*blend}
      rendered.set(p.id,pos);
      // 本机玩家：立刻按当前按键位移，消除输入往返延迟带来的粘滞感。
      // 服务器确认后偏移自然收敛，且总量被限制在 maxLead 内 ——
      // 即使顶着墙走也不会滑出去，最多超前一点再平滑归位。
      let rx=pos.x, ry=pos.y;
      if(p.id===myId&&roomCode){
        if(!predicted)predicted={x:0,y:0};
        if(p.status==='alive'&&keys.length){
          const dir=keyMap[keys.at(-1)];
          if(dir){const[dx,dy]=DIR[dir];predicted.x+=dx*PREDICT.speed*dt;predicted.y+=dy*PREDICT.speed*dt;}
        }
        const decay=1-Math.exp(-dt*PREDICT.reconcile);
        predicted.x*=decay;predicted.y*=decay;
        const m=Math.hypot(predicted.x,predicted.y);
        if(m>PREDICT.maxLead){predicted.x*=PREDICT.maxLead/m;predicted.y*=PREDICT.maxLead/m;}
        rx+=predicted.x;ry+=predicted.y;
      }
      playerSprite(p,OX+rx*T,OY+ry*T,now);
    }
  }
  for(const base of map.bases){
    const colors=state.stored?[...Array(state.stored[base.team][0]).fill(0),...Array(state.stored[base.team][1]).fill(1)]:Array(state.stock[base.team]).fill(base.team);
    for(let i=0;i<Math.min(colors.length,6);i++)bun(OX+base.x*T+45+(i%3)*12,OY+base.y*T-1+Math.floor(i/3)*9,.68,colors[i]);
  }
  localEffects=localEffects.filter(e=>now-e.received<600);
  for(const e of localEffects){
    const age=(now-e.received)/1000;
    if(e.type==='break'){const o=map.mode==='water11'?map.objects.find(o=>o.x===e.x&&o.y===e.y):null,key=o?`water-break-${o.id}`:`break${e.tile}`,m=manifest[key];if(m)sprite(key,OX+e.x*T-(o?.offset[0]||0),o?OY+e.y*T-o.offset[1]:OY+(e.y+1)*T-m.h,Math.min(m.frames-1,age*16),1,Math.max(0,1-age/.6))}
    else if(e.type==='death'){const m=manifest['trap-pop'];sprite('trap-pop',OX+e.x*T-m.w/2,OY+e.y*T+19-m.h,Math.min(1,age*10),1,Math.max(0,1-age/.3))}
    else if(e.type==='training-warp'){ctx.strokeStyle=`rgba(255,238,125,${Math.max(0,1-age/.3)})`;ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(OX+e.fromX*T,OY+e.fromY*T);ctx.lineTo(OX+e.x*T,OY+e.y*T);ctx.stroke()}
    else if(e.type==='cave-lit'){/* 画在洞口自己那一层，见上面 water drawable */}
    else{ctx.strokeStyle=`rgba(205,255,255,${Math.max(0,1-age/.6)})`;ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(OX+e.x*T,OY+e.y*T,15+age*35,7+age*18,0,0,Math.PI*2);ctx.stroke()}
  }
  // Elevated actors are a separate foreground pass; scenery cannot cover them.
  if(state.practice)for(const item of state.hiddenItems||[]){
    const key={capacity:'item1',power:'item2',speed:'item3',fork:'item24',banana:'item23','banana-trap':'item42',smile:'item25','smile-trap':'item25',rose:'item301',chest:'item213',luckybag:'item202',kubi:'item98'}[item.kind],m=manifest[key],x=OX+(item.x+.5)*T,y=OY+(item.y+.5)*T;
    ctx.save();ctx.fillStyle='#e9fbff66';ctx.fillRect(x-17,y-17,34,34);ctx.strokeStyle='#8be8ff';ctx.setLineDash([3,3]);ctx.strokeRect(x-18,y-18,36,36);ctx.restore();
    sprite(key,x-m.w/2,y-m.h/2,now/130,1,.9);
  }
  for(const p of state.players)if(p.status!=='dead'&&(p.renderLayer==='wall'||(state.practice&&p.warpUntil>state.time))){
    rendered.set(p.id,{x:p.x,y:p.y});playerSprite(p,OX+p.x*T,OY+p.y*T,now);
  }
  // Carry icons and labels are always above scenery and actor sprites.
  for(const item of state.items||[]){
    if(!item.flight||item.availableAt<=state.time)continue;
    const f=item.flight,t=Math.max(0,Math.min(1,(state.time-f.born)/f.duration));
    const key={capacity:'item1',power:'item2',speed:'item3','smile-trap':'item25',rose:'item301',chest:'item213',luckybag:'item202',kubi:'item98'}[item.kind],m=manifest[key];if(!m)continue;
    const x=OX+(f.x+(item.x+.5-f.x)*t)*T;
    const y=OY+(f.y+(item.y+.5-f.y)*t)*T-(48+Math.min(40,Math.hypot(item.x+.5-f.x,item.y+.5-f.y)*4))*4*t*(1-t);
    sprite(key,x-m.w/2,y-m.h/2,now/130);
  }
  // 原版怪物血条：贴在 boss 头上，不占顶部 HUD。画在所有 actor 之后，墙和火焰盖不住它。
  if(state.mode==='water11'&&state.boss&&state.boss.hp>0&&!hiddenInWater(map,state.boss)){
    const b=state.boss,plate=manifest['boss-hp-plate'],bar=manifest['boss-hp'],x=OX+b.x*T;
    // 帧号 = 血量 - 1（10 滴血对 10 帧）。锚定格子而不是动画帧，走动时不会上下抖。
    // 分两帧画：misc196 是 41x8 的深色底板，比 39x6 的血条各边大 1 像素。
    const top=Math.max(2,OY+b.y*T-61);
    if(plate)sprite('boss-hp-plate',x-plate.w/2,top);
    if(bar)sprite('boss-hp',x-bar.w/2,top+1,b.hp-1);
  }
  // Shield follows the same server timer as invulnerability, above terrain.
  for(const p of state.players){
    if(hiddenInWater(map,p)||p.status!=='alive'||state.state!=='playing'||!(state.time<p.shieldUntil||(state.practice&&p.mods?.invincible)))continue;
    const m=manifest['spawn-halo'],pos=rendered.get(p.id)||p;
    const age=p.shieldUntil<1e8?Math.max(0,state.time-(p.shieldUntil-RULES.shield)):state.time;
    if(m)sprite('spawn-halo',OX+pos.x*T-m.w/2,OY+pos.y*T-20-m.h/2-standingLift(p),age*10,1,.8);
  }
  for(const p of state.players){
    const age=state.time-(p.diedAt??(p.respawnAt-RULES.respawn));
    if(p.status==='dead'&&age>=0&&age<2)sprite(p.team===0?'death-cry':'death-cry-blue',OX+p.x*T-50,OY+p.y*T-64,age*2);
    if(p.status!=='dead'&&p.emoteUntil>state.time){
      const key=`emote-${p.emote}`,m=manifest[key],pos=rendered.get(p.id)||p;
      if(m)sprite(key,OX+pos.x*T-m.w/2,Math.max(0,OY+pos.y*T-80-standingLift(p)),0);
    }
  }
  for(const p of state.players){
    if(p.status==='dead')continue;const pos=p.inHouse!==null?p:(rendered.get(p.id)||p),lift=standingLift(p);
    if(p.carry!==null)carriedBun(OX+pos.x*T,Math.max(12,OY+pos.y*T-49-lift),1.55);
    if(roomCode&&p.id!==myId&&p.inHouse===null&&p.name)text(p.name,OX+pos.x*T,Math.max(10,OY+pos.y*T-(p.carry===null?49:72)-lift),9,p.team===0?'#ffdddd':'#d6f1ff');
  }
  const markerPlayer=state.players.find(p=>p.id===myId&&p.status!=='dead');
  if(markerPlayer){if(markerPlayer.inHouse!==null)rendered.set(markerPlayer.id,{x:markerPlayer.x,y:markerPlayer.y});selfMarker(markerPlayer)}
  if(debug&&state.practice){
    ctx.strokeStyle='#ffffff55';ctx.lineWidth=.5;
    for(let x=0;x<=15;x++){ctx.beginPath();ctx.moveTo(OX+x*T,OY);ctx.lineTo(OX+x*T,OY+13*T);ctx.stroke()}
    for(let y=0;y<=13;y++){ctx.beginPath();ctx.moveTo(OX,OY+y*T);ctx.lineTo(OX+15*T,OY+y*T);ctx.stroke()}
    for(const p of state.players){ctx.strokeStyle='#ff355c';ctx.strokeRect(OX+(p.x-RULES.radius)*T,OY+(p.y-RULES.radius)*T,RULES.radius*T*2,RULES.radius*T*2)}
  }
  if(state.state==='countdown'){
    const elapsed=3-state.countdown;
    // Original ready.eff: two sweeps behind the text, at 0s and 1s.
    for(const start of [0,1]){
      const age=elapsed-start,m=manifest['ready-streak'];
      if(age<0||age>=.8||!m)continue;
      const offset=age<.3?-600+600*age/.3:600*(age-.3)/.5;
      const alpha=age<.3?1:(.8-age)/.5;
      sprite('ready-streak',308+m.offsetX+offset,260+m.offsetY,0,1,alpha);
    }
    for(const [name,start]of [['ready-original',0],['go-original',1]]){
      const age=elapsed-start,m=manifest[name];if(age<0||age>2||!m)continue;
      const offset=age<.3?-600+650*age/.3:age<.4?50*(.4-age)/.1:0;
      const alpha=age<.8?1:Math.max(0,(2-age)/1.2);
      sprite(name,308+m.offsetX+offset,260+m.offsetY,0,1,alpha);
    }
  }
  ctx.restore();
  // Original 800x600 client frame and player list.
  sprite('dlg_playerList',609,0);sprite('dlg_statusBar',0,541);
  const time=Math.ceil(state.remaining), clock=state.practice&&state.mode!=='water11'?'练习':`${String(Math.floor(time/60)).padStart(2,'0')}:${String(time%60).padStart(2,'0')}`;
  if(state.practice&&state.mode!=='water11')text(clock,713,71,30,'#ffe12e');
  if(state.practice)text(clock,713,71,30,'#ffe12e');
  else for(let i=0;i<clock.length;i++)sprite('timer-digits',713-clock.length*27/2+i*27,53,'0123456789/:-+.'.indexOf(clock[i]));
  if(state.mode==='water11')text('水面11',750,24,12,'#e8f8ff');
  else{bun(699,23,.85);text('抢包子06',750,24,12,'#e8f8ff');}
  const red=state.players.filter(p=>p.team===0),blue=state.players.filter(p=>p.team===1);
  for(let slot=0;slot<8;slot++){
    const p=state.mode==='water11'?state.players[slot]:slot<4?red[slot]:blue[slot-4],y=105+slot*51;
    const rowGradient=ctx.createLinearGradient(649,y,794,y);rowGradient.addColorStop(0,'#202630');rowGradient.addColorStop(1,'#3a4655');ctx.fillStyle=rowGradient;ctx.fillRect(649,y+2,145,46);
    ctx.fillStyle=slot<4?'#fb6871':'#73bcff';ctx.fillRect(650,y+4,2,41);
    if(p){
      sprite(`prince-${p.team===0?'red':'blue'}-stand-3`,636,y-18,0,.8,p.status==='dead'?.35:1);
      text(p.name||'毛毛',700,y+16,10,'#fff','left');
      const status=p.status==='dead'?(state.mode==='water11'?'阵亡 · 观战':`${Math.max(0,Math.ceil(p.respawnAt-state.time))} 秒复活`):p.status==='trapped'?'等待营救':p.carry!==null?'正在背包':p.ready?'已准备':'毛毛';
      text(status,700,y+34,8,p.carry!==null?'#ffdd6c':'#98c9e0','left',false);
      text(String(slot+1),633,y+24,15,'#e5faff');
    }else{text('等待加入',718,y+26,10,'#8fbad1','center',false)}
  }
  const me=state.players.find(p=>p.id===myId);
  if(me){
    text(String(me.capacity-RULES.capacity),53,590,10,'#ffe066');
    for(const [i,[key,count]] of [['item24',me.forks],['item23',me.bananas],['item25',me.smiles]].entries()){
      if(!count)continue;const m=manifest[key],cx=204+i*54,scale=Math.min(1,30/m.w,30/m.h);
      sprite(key,cx-m.w*scale/2,565-m.h*scale/2,now/130,scale);
      text(String(count),cx,587,12,'#fff');
    }
    text(String(me.power-RULES.power),103,590,10,'#ffe066');
    text(String(me.speed-RULES.speed),156,590,10,'#ffe066');
  }
  if(roomCode&&performance.now()-lastStateAt>2500)text('等待服务器响应…',307,30,12,'#ffe99d');
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

