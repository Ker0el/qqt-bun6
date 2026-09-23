import{chromium}from'@playwright/test';
import assert from'node:assert/strict';
import path from'node:path';
import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-gpu']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:980}});let state;const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('websocket',ws=>ws.on('framereceived',({payload})=>{try{const m=JSON.parse(payload);if(m.type==='state')state=m}catch{}}));
 const until=async(fn,ms=12000)=>{for(let i=0;i<ms/30;i++){if(fn())return;await page.waitForTimeout(30)}throw Error('Browser training condition timed out')};
 await page.goto('http://localhost:8787');await page.getByRole('button',{name:'进入单人练习场',exact:true}).click();await until(()=>state?.state==='playing');
 await page.locator('#game').focus();await page.keyboard.press('Space');await until(()=>state.players[0].status==='trapped',5000);await page.waitForTimeout(550);
 await page.screenshot({path:path.join(root,'trapped-preview.png'),fullPage:true});
 await until(()=>state.players[0].status==='dead',7000);await page.locator('#death-screen').waitFor({state:'visible'});
 assert.equal(await page.locator('#death-screen').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
 assert(Number(await page.locator('#respawn-count').textContent())>=8);
 await page.screenshot({path:path.join(root,'death-preview.png'),fullPage:true});
 await page.keyboard.press('F2');await page.locator('#training-dialog').waitFor({state:'visible'});
 for(const key of ['invincible','bombs','speed','power','noclip']){await page.locator(`[data-mod="${key}"]`).check();await until(()=>state.players[0].mods[key]===true,3000)}
 await page.screenshot({path:path.join(root,'training-menu-preview.png'),fullPage:true});
 await page.getByRole('button',{name:'关闭训练菜单'}).click();await page.locator('#game').focus();await page.keyboard.down('ArrowRight');await page.waitForTimeout(650);await page.keyboard.up('ArrowRight');
 await until(()=>state.players[0].x>=14.4);assert.equal(state.players[0].status,'alive');assert(await page.locator('#death-screen').isHidden());
 await page.keyboard.press('F2');await page.getByRole('button',{name:'秒赢 · 来回搬包',exact:true}).click();await until(()=>state.state==='finished',4000);
 assert.equal(state.players[0].captures,3);assert.equal(state.captured[0],3);await page.screenshot({path:path.join(root,'training-win-preview.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('Browser training: original trap assets, transparent respawn countdown, all F2 toggles, fast noclip, invincibility and three-trip win verified.');
}finally{await browser.close()}
