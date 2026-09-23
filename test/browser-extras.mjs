import{chromium}from'@playwright/test';import assert from'node:assert/strict';import path from'node:path';import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-gpu']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}});let state;const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('websocket',ws=>ws.on('framereceived',({payload})=>{try{const m=JSON.parse(payload);if(m.type==='state')state=m}catch{}}));
 const until=async f=>{for(let i=0;i<250;i++){if(f())return;await page.waitForTimeout(20)}throw Error('extras timeout')};
 await page.goto('http://localhost:8787');await page.locator('#loading').waitFor({state:'hidden'});await page.getByRole('button',{name:'赞赏',exact:true}).click();await page.locator('#support-dialog').waitFor({state:'visible'});
 await page.locator('#support-dialog img').evaluate(im=>im.decode());assert.equal(await page.locator('#support-dialog img').evaluate(im=>im.naturalWidth),499);
 await page.screenshot({path:path.join(root,'support-preview.png'),fullPage:true});await page.getByRole('button',{name:'关闭赞赏',exact:true}).click();
 assert((await page.locator('.app').evaluate(el=>getComputedStyle(el).cursor)).includes('cursor-fight.png'));
 await page.getByRole('button',{name:'进入单人练习场',exact:true}).click();await until(()=>state?.state==='playing');
 await page.locator('#game').focus();await page.keyboard.press('F2');await page.getByRole('checkbox',{name:'显示墙内道具',exact:true}).check();await until(()=>state.hiddenItems?.length>0);
 await page.getByRole('button',{name:'关闭训练菜单',exact:true}).click();await page.screenshot({path:path.join(root,'hidden-loot-preview.png'),fullPage:true});
 await page.locator('#game').focus();await page.keyboard.press('Enter');await page.locator('#chat-input').waitFor({state:'visible'});
 await page.locator('#chat-input').fill('<img src=x onerror=alert(1)> 测试聊天');await page.locator('#chat-input').press('Enter');
 await page.getByText('<img src=x onerror=alert(1)> 测试聊天',{exact:false}).waitFor();assert.equal(await page.locator('#chat-log img').count(),0);
 assert(await page.locator('#chat-form').isHidden());await page.screenshot({path:path.join(root,'chat-preview.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('Browser extras: support QR, native cursor, buried-item overlay and Enter chat with safe text rendering verified.');
}finally{await browser.close()}
