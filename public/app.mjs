import { Match, RULES, DIR } from './engine.mjs';

const $ = id => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d');
const manifest = await fetch('/assets/manifest.json').then(r => r.json());
const map = await fetch('/assets/map.json').then(r => r.json());
const images = new Map(); let loaded = 0;
await Promise.all(Object.entries(manifest).map(([key, meta]) => new Promise((resolve, reject) => {
  const image = new Image(); image.onload = () => { images.set(key, image); loaded++; $('load-progress').textContent = `${loaded} / ${Object.keys(manifest).length}  原版素材`; resolve(); };
  image.onerror = () => reject(new Error(`无法加载 ${meta.src}`)); image.src = meta.src;
}))).catch(err => { $('load-progress').textContent = err.message; throw err; });
$('loading').hidden = true; $('home-panel').hidden = false;

const demo = new Match(map);
let state = demo.snapshot(), socket, myId = null, roomCode = null, hostId = null;
let sequence = 0, keys = [], seenEvent = 0, localEffects = [], debug = false;
let sound = false, bgm, toastTimer, lastStateAt = performance.now(), previousFrame = performance.now();
let rendered = new Map(), countdownSound = false, lastUI = '', reconnectTimer;
let directory={online:0,rooms:[]};
let chatMessages=[],lastExplosionSound=-1000;
document.querySelector('.meter-window').style.left=`${RULES.phaseStart*100}%`;
document.querySelector('.meter-window').style.width=`${(RULES.phaseEnd-RULES.phaseStart)*100}%`;
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
function send(data) { if (socket?.readyState === WebSocket.OPEN) { if(data.type==='create'||data.type==='join')data.skin=$('bubble-skin').value;socket.send(JSON.stringify(data)); return true; } toast('连接尚未就绪，请稍候'); return false; }
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
      roomCode = msg.room; myId = msg.id; seenEvent = 0; rendered.clear(); lastUI = ''; keys = []; sequence = 0;
      localStorage.setItem('qqt-name', $('nickname').value.trim()); updateMusic(); resetButtons();
    }
    if (msg.type === 'state') {
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
  roomCode=null;state=demo.snapshot();keys=[];rendered.clear();localEffects=[];updateMusic();
  $('home-panel').hidden=false; $('room-panel').hidden=true; $('result-panel').hidden=true;
  $('practice-tools').hidden=true; $('leave-game').hidden=true; $('footer-status').textContent='抢走对方的包子，带回自己的包子铺。'; resetButtons();
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
  if (e.type === 'start') { play('ReadyGo.wav',.5); countdownSound=true; }
  if (e.type === 'bomb'&&e.player===myId) play('place.wav',.28);
  if (e.type === 'explode'&&performance.now()-lastExplosionSound>60){play('bomb.wav',.25);lastExplosionSound=performance.now();}
  if(e.type==='death')play('trapped-pop.wav',.3);
  if (e.type === 'break') localEffects.push({...e,received:performance.now()});
  if(e.type==='death'||e.type==='training-warp')localEffects.push({...e,received:performance.now()});
  if (e.type === 'phase' || e.type === 'wall') {
    localEffects.push({...e,received:performance.now()});
    if (e.player === myId && state.practice) toast(e.technique==='3p'?'3P 转向借泡成功':`${e.type==='wall'?'借泡上墙：获得穿势':'穿泡成功'} · ${e.elapsed.toFixed(3)} 秒`);
  }
  if (e.type === 'timing' && e.player === myId) toast(`${e.elapsed < RULES.phaseStart ? '放泡太早' : '放泡太晚'} · ${e.elapsed.toFixed(3)} 秒，按 R 重试`);
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
  for(let i=0;i<4;i++) {
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
  $('home-panel').hidden=true; $('room-panel').hidden=!lobby; $('result-panel').hidden=!finished;
  $('practice-tools').hidden=!state.practice; $('leave-game').hidden=lobby;
  const self=state.players.find(p=>p.id===myId);
  $('death-screen').hidden=!(self?.status==='dead'&&state.state==='playing');
  if(self?.status==='dead')$('respawn-count').textContent=String(Math.max(0,Math.ceil(self.respawnAt-state.time)));
  let cry=$('death-cry-overlay');
  if(!cry){cry=document.createElement('img');cry.id='death-cry-overlay';cry.src='/assets/death-cry.gif';cry.alt='';$('death-screen').append(cry)}
  cry.hidden=!(self?.status==='dead'&&state.time-self.respawnAt+RULES.respawn<2);
  if(!cry.hidden){cry.style.left=`${(self.x*40-50)/600*100}%`;cry.style.top=`${(22+self.y*40-64)/542*100}%`}
  if(!state.practice&&$('training-dialog').open)$('training-dialog').close();
  for(const checkbox of document.querySelectorAll('[data-mod]'))checkbox.checked=!!self?.mods?.[checkbox.dataset.mod];
  $('connection-label').textContent=state.practice?'单人练习场':`房间 ${roomCode}`;
  $('footer-status').textContent=state.practice?'按 R 重置练习场景':`房间 ${roomCode} · ${state.players.length}/8 人 · 带回敌包 红 ${state.captured?.[0]||0}/3 · 蓝 ${state.captured?.[1]||0}/3`;
  const signature=JSON.stringify([state.state,hostId,state.players.map(p=>[p.id,p.name,p.team,p.ready])]);
  if(signature!==lastUI){
    lastUI=signature;
    if(lobby){
      $('room-number').textContent=roomCode;roster('red-roster',0);roster('blue-roster',1);
      const me=state.players.find(p=>p.id===myId);
      $('ready-button').textContent=myId===hostId?'开始游戏':me?.ready?'取消准备':'准 备';
      $('room-hint').textContent=state.players.length<2?'邀请一位糖友加入，开始红蓝对战':'双方人数相等，所有糖友准备后即可开局';
    }
    if(finished){
      $('result-title').textContent=state.winner===null?'平 局':state.winner===0?'红队获胜！':'蓝队获胜！';
      $('result-reason').textContent=state.reason;$('result-stats').replaceChildren();
      for(const p of state.players){const row=document.createElement('div');row.className='result-stat';const name=document.createElement('span');name.textContent=p.name;const result=document.createElement('span');result.textContent=`抢回 ${p.captures} · 击破 ${p.kills}`;row.append(name,result);$('result-stats').append(row)}
      $('return-room').textContent=state.practice?'再练一次':myId===hostId?'返回房间':'等待房主返回房间';$('return-room').disabled=myId!==hostId;
    }
  }
  if(state.practice){
    const mode=state.drill||'map';
    for(const b of document.querySelectorAll('[data-drill]'))b.classList.toggle('selected',b.dataset.drill===mode);
    $('drill-guide').textContent=mode==='phase'?'已摆好目标糖泡。按住 ↑ 对正糖泡，约 0.6 秒时按空格，继续向上。R 重置。':mode==='wall'?'已摆好左墙右泡和偏位站位。按住 ↑ 激活，约 0.6 秒时按空格，继续向上借泡进入墙格。R 重置。':mode==='wall3'?'按住 → 激活面前的泡，约 0.6 秒时先按空格，再立即按 ↑ 转向上墙。先转向后放泡或转向过晚会失败。R 重置。':'自由移动、放泡和抢包。毛毛初始 2 泡；可以借自己的泡练习，或进入专项场景。';
    if(mode==='house')$('drill-guide').textContent='四角有碰撞并挡火，中间通道能进入但不挡火；进房后模型隐藏，蓝色箭头标记自己的位置。';
    if(mode==='run')$('drill-guide').textContent='按住 ↑ 从远处跑向泡弹，约 0.6 秒节奏按空格，继续向前穿过；无需先贴住泡。速度越快，助跑距离越长。';
    if(mode==='pillar')$('drill-guide').textContent='按住 ↑ 接近柱旁糖泡，约 0.6 秒节奏按空格，保持方向借泡上柱。没有泡弹提供穿势就不能上柱。';
  }
}
function nickname(){return $('nickname').value.trim()||'糖友'}
$('create-room').onclick=()=>{if(send({type:'create',name:nickname()}))$('create-room').disabled=true};
$('join-room').onclick=()=>{const code=$('room-code').value.trim();if(!/^\d{6}$/.test(code)){toast('请输入 6 位房间号');return}if(send({type:'join',code,name:nickname()}))$('join-room').disabled=true};
$('room-code').addEventListener('keydown',e=>{if(e.key==='Enter')$('join-room').click()});
$('practice').onclick=()=>{if(send({type:'create',practice:true,name:nickname()})){$('practice').disabled=true;canvas.focus()}};
$('ready-button').onclick=()=>{send({type:myId===hostId?'start':'ready'});canvas.focus()};
$('switch-team').onclick=()=>send({type:'team'});
for(const id of ['leave-lobby','leave-game'])$(id).onclick=()=>{release();play('uiLeave.wav',.25);send({type:'leave'})};
$('return-room').onclick=()=>send(state.practice?{type:'drill',mode:state.drill||'map'}:{type:'return'});
$('copy-invite').onclick=async()=>{
  try{await navigator.clipboard.writeText(`${location.origin}/?room=${roomCode}`);toast('邀请链接已复制；局域网朋友请使用房主局域网地址')}
  catch{toast(`房间号：${roomCode}`)}
};
for(const b of document.querySelectorAll('[data-drill]'))b.onclick=()=>{release();send({type:'drill',mode:b.dataset.drill});canvas.focus()};
$('reset-drill').onclick=()=>{release();send({type:'drill',mode:state.drill||'map'});canvas.focus()};
$('debug-toggle').onchange=e=>{debug=e.target.checked;canvas.focus()};
$('sound-button').onclick=()=>{sound=!sound;$('sound-button').textContent=`声音：${sound?'开':'关'}`;updateMusic();if(sound)play('uiNormal.wav');canvas.focus()};
$('bubble-skin').value=localStorage.getItem('qqt-bubble')==='fire'?'fire':'classic';
$('bubble-skin').onchange=()=>{localStorage.setItem('qqt-bubble',$('bubble-skin').value);if(roomCode)send({type:'appearance',skin:$('bubble-skin').value});canvas.focus()};
$('fullscreen-button').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else document.querySelector('.game-frame').requestFullscreen().catch(()=>toast('当前浏览器不支持全屏'));canvas.focus()};
$('help-button').onclick=()=>{release();$('help-dialog').showModal()};
$('close-help').onclick=()=>{$('help-dialog').close();canvas.focus()};
$('chat-button').onclick=openChat;
$('chat-form').onsubmit=e=>{e.preventDefault();const message=$('chat-input').value.trim();if(message&&!send({type:'chat',name:nickname(),text:message}))return;$('chat-input').value='';closeChat();};
$('chat-input').addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();closeChat()}});
$('support-button').onclick=()=>{release();closeChat();$('support-dialog').showModal()};
$('close-support').onclick=()=>{$('support-dialog').close();canvas.focus()};
document.addEventListener('click',e=>{const button=e.target.closest('button');if(button&&button.id!=='sound-button')play('uiMain.wav',.12)});
$('close-training').onclick=()=>{$('training-dialog').close();canvas.focus()};
for(const checkbox of document.querySelectorAll('[data-mod]'))checkbox.onchange=()=>send({type:'training-mod',key:checkbox.dataset.mod,enabled:checkbox.checked});
$('training-win').onclick=()=>{send({type:'training-win'});$('training-dialog').close();canvas.focus()};
fetch('/api/info').then(r=>r.json()).then(info=>{$('lan-addresses').textContent=info.addresses.length?`局域网地址：${info.addresses.join(' 或 ')}`:'本机地址：http://localhost:8787'}).catch(()=>{});

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
  if(e.code==='KeyR'&&state.practice&&!e.repeat){e.preventDefault();$('reset-drill').click()}
});
window.addEventListener('keyup',e=>{if(keyMap[e.code]){keys=keys.filter(k=>k!==e.code);input()}});
window.addEventListener('blur',release);document.addEventListener('visibilitychange',()=>{if(document.hidden)release()});
canvas.addEventListener('pointerdown',()=>canvas.focus());

const OX=8, OY=22, T=40;
function standingLift(p){if(p.renderLayer!=='wall'||!p.renderWallCell)return 0;const[x,y]=p.renderWallCell.split(',').map(Number);return Math.max(0,(manifest[`tile${state.blocks[y*15+x]-8000}`]?.h||40)-40)}
function playerSprite(p, x, y, time, alpha=1){
  const team=p.team===0?'red':'blue',action=p.moving?'walk':'stand',dir=DIR[p.dir]?.[2]??3;
  const lift=standingLift(p);
  ctx.save();
  ctx.fillStyle='#2a46144d';ctx.beginPath();ctx.ellipse(x,y+17,13,5,0,0,Math.PI*2);ctx.fill();
  if(p.status==='trapped'){
    const age=Math.max(0,state.time-(p.trappedUntil-RULES.trap)),key=age<.4?'trap-bubble':'trap-shell',m=manifest[key];
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
  for(let y=0;y<13;y++)for(let x=0;x<15;x++)sprite('tile11',OX+x*T,OY+y*T);
  for(let y=0;y<13;y++)for(let x=0;x<15;x++){const tile=map.ground[y*15+x];if(tile>0&&tile!==8011)sprite(`tile${tile-8000}`,OX+x*T,OY+y*T)}
  for(const item of state.items){if(item.availableAt>state.time)continue;const key={capacity:'item1',power:'item2',speed:'item3',fork:'item24',banana:'item23','banana-trap':'item42',smile:'item25','smile-trap':'item25'}[item.kind];const m=manifest[key];if(m)sprite(key,OX+(item.x+.5)*T-m.w/2,OY+(item.y+.5)*T-m.h/2,now/130)}
  for(const b of state.buns)bun(OX+(b.x+.5)*T,OY+(b.y+.5)*T,1.5,b.owner);
  for(const f of state.flames){
    if(map.bases.some(b=>f.x>=b.x&&f.x<b.x+b.w&&f.y>=b.y&&f.y<b.y+b.h))continue;
    const x=OX+(f.x+.5)*T,y=OY+(f.y+.5)*T;
    const parts={right:[2,6],up:[3,7],left:[4,8],down:[5,9]};
    const key=f.arm==='center'?'flame1':`flame${parts[f.arm][f.end?1:0]}`;
    const m=manifest[key];sprite(key,x-m.w/2,y-m.h/2,Math.min(m.frames-1,(state.time-f.born)/RULES.flame*m.frames));
  }
  const drawables=[];
  for(let y=0;y<13;y++)for(let x=0;x<15;x++){
    const tile=state.blocks[y*15+x];if(tile>0)drawables.push({z:y+.8,type:'tile',tile:tile-8000,x,y});
    const building=map.structures[y*15+x];if(building>0)drawables.push({z:y+2.7,type:'building',tile:building-8000,x,y});
  }
  for(const b of state.bombs){
    const occupants=state.players.filter(p=>Math.floor(p.x)===b.x&&Math.floor(p.y)===b.y);
    drawables.push({z:Math.min(b.y+.35,...occupants.map(p=>p.y-.01)),type:'bomb',b});
  }
  for(const p of state.players)if(p.status!=='dead'&&p.inHouse===null&&p.renderLayer!=='wall')drawables.push({z:p.y,type:'player',p});
  drawables.sort((a,b)=>a.z-b.z);
  for(const d of drawables){
    if(d.type==='tile'||d.type==='building'){
      const m=manifest[`tile${d.tile}`];if(m)sprite(`tile${d.tile}`,OX+d.x*T,OY+(d.y+(d.type==='building'?3:1))*T-m.h);
    }else if(d.type==='bomb'){
      const b=d.b,key=b.skin==='fire'?'bomb-fire':'bomb1',m=manifest[key];
      sprite(key,OX+(b.x+.5)*T-m.w/2,OY+(b.y+.5)*T-m.h/2-(b.skin==='fire'?5:0),(now/(b.skin==='fire'?200:170)));
    }else{
      const p=d.p;let pos=rendered.get(p.id);
      if(!pos||Math.hypot(pos.x-p.x,pos.y-p.y)>1.5)pos={x:p.x,y:p.y};
      else{const blend=1-Math.exp(-dt*65);pos.x+=(p.x-pos.x)*blend;pos.y+=(p.y-pos.y)*blend}
      rendered.set(p.id,pos);playerSprite(p,OX+pos.x*T,OY+pos.y*T,now);
    }
  }
  for(const base of map.bases){
    const colors=state.stored?[...Array(state.stored[base.team][0]).fill(0),...Array(state.stored[base.team][1]).fill(1)]:Array(state.stock[base.team]).fill(base.team);
    for(let i=0;i<Math.min(colors.length,6);i++)bun(OX+base.x*T+45+(i%3)*12,OY+base.y*T-1+Math.floor(i/3)*9,.68,colors[i]);
  }
  localEffects=localEffects.filter(e=>now-e.received<600);
  for(const e of localEffects){
    const age=(now-e.received)/1000;
    if(e.type==='break'){const m=manifest[`break${e.tile}`];if(m)sprite(`break${e.tile}`,OX+e.x*T,OY+(e.y+1)*T-m.h,Math.min(m.frames-1,age*16),1,Math.max(0,1-age/.6))}
    else if(e.type==='death'){const m=manifest['trap-pop'];sprite('trap-pop',OX+e.x*T-m.w/2,OY+e.y*T+19-m.h,Math.min(1,age*10),1,Math.max(0,1-age/.3))}
    else if(e.type==='training-warp'){ctx.strokeStyle=`rgba(255,238,125,${Math.max(0,1-age/.3)})`;ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(OX+e.fromX*T,OY+e.fromY*T);ctx.lineTo(OX+e.x*T,OY+e.y*T);ctx.stroke()}
    else{ctx.strokeStyle=`rgba(205,255,255,${Math.max(0,1-age/.6)})`;ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(OX+e.x*T,OY+e.y*T,15+age*35,7+age*18,0,0,Math.PI*2);ctx.stroke()}
  }
  // Elevated actors are a separate foreground pass; scenery cannot cover them.
  if(state.practice)for(const item of state.hiddenItems||[]){
    const key={capacity:'item1',power:'item2',speed:'item3',fork:'item24',banana:'item23','banana-trap':'item42',smile:'item25','smile-trap':'item25'}[item.kind],m=manifest[key],x=OX+(item.x+.5)*T,y=OY+(item.y+.5)*T;
    ctx.save();ctx.fillStyle='#e9fbff66';ctx.fillRect(x-17,y-17,34,34);ctx.strokeStyle='#8be8ff';ctx.setLineDash([3,3]);ctx.strokeRect(x-18,y-18,36,36);ctx.restore();
    sprite(key,x-m.w/2,y-m.h/2,now/130,1,.9);
  }
  for(const p of state.players)if(p.status!=='dead'&&(p.renderLayer==='wall'||(state.practice&&p.warpUntil>state.time))){
    rendered.set(p.id,{x:p.x,y:p.y});playerSprite(p,OX+p.x*T,OY+p.y*T,now);
  }
  // Carry icons and labels are always above scenery and actor sprites.
  for(const item of state.items){
    if(!item.flight||item.availableAt<=state.time)continue;
    const f=item.flight,t=Math.max(0,Math.min(1,(state.time-f.born)/f.duration));
    const key={capacity:'item1',power:'item2',speed:'item3'}[item.kind],m=manifest[key];if(!m)continue;
    const x=OX+(f.x+(item.x+.5-f.x)*t)*T;
    const y=OY+(f.y+(item.y+.5-f.y)*t)*T-(48+Math.min(40,Math.hypot(item.x+.5-f.x,item.y+.5-f.y)*4))*4*t*(1-t);
    sprite(key,x-m.w/2,y-m.h/2,now/130);
  }
  // Shield follows the same server timer as invulnerability, above terrain.
  for(const p of state.players){
    if(p.status!=='alive'||state.state!=='playing'||!(state.time<p.shieldUntil||(state.practice&&p.mods?.invincible)))continue;
    const m=manifest['spawn-halo'],pos=rendered.get(p.id)||p;
    const age=p.shieldUntil<1e8?Math.max(0,state.time-(p.shieldUntil-RULES.shield)):state.time;
    if(m)sprite('spawn-halo',OX+pos.x*T-m.w/2,OY+pos.y*T-20-m.h/2-standingLift(p),age*10,1,.8);
  }
  for(const p of state.players){
    const age=state.time-(p.respawnAt-RULES.respawn);
    if(p.status==='dead'&&age>=0&&age<2){sprite('death-cry',OX+p.x*T-50,OY+p.y*T-64,age*2)}
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
  const time=Math.ceil(state.remaining), clock=state.practice?'练习':`${String(Math.floor(time/60)).padStart(2,'0')}:${String(time%60).padStart(2,'0')}`;
  if(state.practice)text(clock,713,71,30,'#ffe12e');
  else for(let i=0;i<clock.length;i++)sprite('timer-digits',713-clock.length*27/2+i*27,53,'0123456789/:-+.'.indexOf(clock[i]));
  bun(699,23,.85);text('抢包子06',750,24,12,'#e8f8ff');
  const red=state.players.filter(p=>p.team===0),blue=state.players.filter(p=>p.team===1);
  for(let slot=0;slot<8;slot++){
    const p=slot<4?red[slot]:blue[slot-4],y=105+slot*51;
    const rowGradient=ctx.createLinearGradient(649,y,794,y);rowGradient.addColorStop(0,'#202630');rowGradient.addColorStop(1,'#3a4655');ctx.fillStyle=rowGradient;ctx.fillRect(649,y+2,145,46);
    ctx.fillStyle=slot<4?'#fb6871':'#73bcff';ctx.fillRect(650,y+4,2,41);
    if(p){
      sprite(`prince-${p.team===0?'red':'blue'}-stand-3`,636,y-18,0,.8,p.status==='dead'?.35:1);
      text(p.name||'毛毛',700,y+16,10,'#fff','left');
      const status=p.status==='dead'?`${Math.max(0,Math.ceil(p.respawnAt-state.time))} 秒复活`:p.status==='trapped'?'等待营救':p.carry!==null?'正在背包':p.ready?'已准备':'毛毛';
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
    if(state.practice){
      const elapsed=me.activation?state.time-me.activation.since:0;
      $('phase-label').textContent=me.onWall?'墙上':me.phaseUntil>state.time?'穿势生效':me.activation?(elapsed>RULES.phaseEnd?'已错过窗口':'已激活'):'等待激活';
      $('phase-time').textContent=`${elapsed.toFixed(2)} s`;$('meter-cursor').style.left=`${Math.min(100,elapsed*100)}%`;
    }
  }
  if(roomCode&&performance.now()-lastStateAt>2500)text('等待服务器响应…',307,30,12,'#ffe99d');
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

