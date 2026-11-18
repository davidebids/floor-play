import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.PROJECTION_URL||'http://127.0.0.1:5188';
await mkdir('artifacts/qa/motion',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];const external=[];const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))external.push(r.url());});
await page.goto(base);await page.waitForFunction(()=>window.__PROJECTION__?.diagnostics().assetsLoaded);await page.waitForTimeout(800);
const layout=async()=>page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,pond:document.querySelector('.scene-frame')?.getBoundingClientRect().toJSON(),transport:document.querySelector('.transport')?.getBoundingClientRect().toJSON()}));
const desktopLayout=await layout();await page.screenshot({path:'artifacts/qa/control-desktop.png'});
await page.setViewportSize({width:1024,height:768});await page.waitForTimeout(300);const compactLayout=await layout();await page.screenshot({path:'artifacts/qa/control-laptop.png'});
await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);const narrowLayout=await layout();await page.screenshot({path:'artifacts/qa/control-narrow.png',fullPage:true});
await context.close();
const motionContext=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:'artifacts/qa/motion',size:{width:1280,height:720}}});
const pond=await motionContext.newPage();pond.on('pageerror',e=>errors.push(String(e)));await pond.goto(`${base}/?view=projector`);await pond.waitForFunction(()=>window.__PROJECTION__?.diagnostics().assetsLoaded);await pond.getByRole('button',{name:'Fullscreen',exact:true}).click();await pond.waitForTimeout(400);
await pond.screenshot({path:'artifacts/qa/projector-idle.png'});const positions=[];
for(let i=0;i<8;i++){
 await pond.mouse.move(340+i*70,300+Math.sin(i)*120,{steps:6});if(i===2||i===5)await pond.mouse.click(340+i*70,300+Math.sin(i)*120);
 await pond.waitForTimeout(450);positions.push(await pond.evaluate(()=>window.__PROJECTION__.diagnostics()));
 if([0,2,4,6].includes(i))await pond.screenshot({path:`artifacts/qa/motion/frame-${i}.png`});
}
await pond.screenshot({path:'artifacts/qa/projector-active.png'});
const final=await pond.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2');const ext=gl.getExtension('WEBGL_debug_renderer_info');return {diagnostics:window.__PROJECTION__.diagnostics(),metrics:window.__THREE_GAME_DIAGNOSTICS__,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};});
const video=pond.video();await motionContext.close();await video.saveAs('artifacts/qa/pond-motion.webm');
await writeFile('artifacts/qa/browser-evidence.json',JSON.stringify({base,errors,externalRequests:[...new Set(external)],desktopLayout,compactLayout,narrowLayout,final,motionPositions:positions},null,2));
await browser.close();console.log(JSON.stringify({errors,externalRequests:external,desktopLayout,compactLayout,diagnostics:final.diagnostics,gpu:final.gpu}));
