import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-gpu']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];let state,firstState;
 page.on('pageerror',e=>errors.push(e.message));page.on('websocket',ws=>ws.on('framereceived',({payload})=>{try{const m=JSON.parse(payload);if(m.type==='state'){state=m;firstState??=m;}}catch{}}));
 await page.goto('http://localhost:8787');await page.locator('#loading').waitFor({state:'hidden'});
 await page.selectOption('#map-select','water11_8');await page.locator('#practice').click();
 await page.waitForTimeout(5500);assert.equal(state?.mode,'water11');assert(state.boss);assert.equal(errors.length,0,errors.join('\n'));
 // 困泡时长只在首帧下发一次，之后省掉
 assert.equal(firstState.trapDuration,10,'water11 must announce the longer pve trap');
 assert.equal(state.trapDuration,undefined,'a constant field must not be resent every frame');
 // boss 十滴血，血条按原版挂在它头上；顶部和底部的旧读数都要消失
 assert.equal(state.boss.hp,10);assert.equal(state.boss.maxHp,10);
 assert.equal((await page.locator('#footer-status').textContent()).trim(),'');
 const hud=await page.evaluate(()=>{const d=document.getElementById('game').getContext('2d').getImageData(175,4,266,19).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]===0x10&&d[i+1]===0x2a&&d[i+2]===0x49)n++;return n;});
 assert(hud<500,`the old top-edge health strip must be gone, found ${hud} filled pixels`);
 const asset=await page.evaluate(async()=>{const r=await fetch('/assets/boss-hp.png');const b=await createImageBitmap(await r.blob());return{status:r.status,w:b.width,h:b.height};});
 assert.equal(asset.status,200);assert.equal(asset.w,390);assert.equal(asset.h,6);
 // 底板色 #303430 是血条独有的：在 boss 头顶采样到它，就证明血条画在了怪身上
 let platePixels=0;
 for(let attempt=0;attempt<20&&platePixels===0;attempt++){
  if(attempt)await page.waitForTimeout(50);
  platePixels=await page.evaluate(({bx,by})=>{
   const ctx=document.getElementById('game').getContext('2d');
   const d=ctx.getImageData(Math.round(8+bx*40-20),Math.round(22+by*40-61)-1,40,9).data;
   let n=0;for(let i=0;i<d.length;i+=4)if(d[i]===0x30&&d[i+1]===0x34&&d[i+2]===0x30)n++;
   return n;
  },{bx:state.boss.x,by:state.boss.y});
 }
 assert(platePixels>50,`the health bar must ride above the sailor's head, found ${platePixels} plate pixels`);
 await page.screenshot({path:'water11-preview.png',fullPage:true});
 // 训练面板新增的「放泡秒炸」要能真的发到服务端（复选框在 F2 弹窗里，不用打开也能派发）
 await page.evaluate(()=>{const c=document.querySelector('[data-mod="instant"]');c.checked=true;c.dispatchEvent(new Event('change'));});
 let instant=false;
 for(let i=0;i<40&&!instant;i++){await page.waitForTimeout(50);instant=!!state.players[0]?.mods?.instant;}
 assert(instant,'the instant training mod must reach the server');
 // 洞口点亮素材：5 帧 40x57 拼成 200x57
 const trig=await page.evaluate(async()=>{const r=await fetch('/assets/water-trigger-5010.png');const b=await createImageBitmap(await r.blob());return{status:r.status,w:b.width,h:b.height};});
 assert.equal(trig.status,200);assert.equal(trig.w,200);assert.equal(trig.h,57);
 // 开穿墙走到洞口 (5,6)，进洞要真的发 cave-lit
 await page.evaluate(()=>{const c=document.querySelector('[data-mod="noclip"]');c.checked=true;c.dispatchEvent(new Event('change'));});
 for(let i=0;i<40&&!state.players[0]?.mods?.noclip;i++)await page.waitForTimeout(50);
 assert(state.players[0]?.mods?.noclip,'noclip must be on before we path through walls');
 await page.locator('#game').focus();
 for(let step=0;step<120&&!state.events?.some(e=>e.type==='cave-lit');step++){
  const p=state.players[0];if(!p)break;
  const cx=Math.floor(p.x),cy=Math.floor(p.y);
  if(cx===5&&cy===6)break;
  const key=cx!==5?(cx<5?'ArrowRight':'ArrowLeft'):(cy<6?'ArrowDown':'ArrowUp');
  await page.keyboard.down(key);await page.waitForTimeout(45);await page.keyboard.up(key);await page.waitForTimeout(15);
 }
 assert(state.events?.some(e=>e.type==='cave-lit'),'walking into the cave must light it up');
 await page.locator('#leave-game').click();await page.locator('#home-panel').waitFor({state:'visible'});
 await page.locator('#create-room').click();await page.locator('#room-panel').waitFor({state:'visible'});assert.equal(state.mode,'water11');
 const code=await page.locator('#room-number').textContent();
 const friend=await browser.newPage();await friend.goto('http://localhost:8787');await friend.locator('#loading').waitFor({state:'hidden'});
 await friend.locator('#room-code').fill(code);await friend.locator('#join-room').click();await friend.locator('#ready-button').click();await page.waitForTimeout(200);
 await page.locator('#ready-button').click();await page.waitForTimeout(3500);assert.equal(state.state,'playing');assert.equal(state.players.length,2);assert(state.players.every(p=>p.team===0));
 assert.equal(errors.length,0,errors.join('\n'));console.log('Water11 browser: assets, head-mounted ten-point health bar, longer pve trap, cave lighting, instant-fuse mod, map selection and two-player cooperative start verified');
}finally{await browser.close();}
