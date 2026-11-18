import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const base = process.env.PROJECTION_URL || 'http://127.0.0.1:5188';
const browser = await chromium.launch({channel:'chrome',headless:true});
const errors = [], reports = [];
try {
 for (const [name,viewport,dpr] of [
  ['projector-hd',{width:1920,height:1080},1],
  ['projector-retina',{width:1920,height:1080},2],
 ]) {
  const context=await browser.newContext({viewport,deviceScaleFactor:dpr});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(`${base}/?view=projector`);
  await page.waitForFunction(()=>window.__PROJECTION__?.diagnostics().assetsLoaded);
  await page.getByRole('button',{name:'Fullscreen',exact:true}).click();
  await page.waitForTimeout(2200);
  const snapshot=()=>page.evaluate(()=>{const canvas=document.querySelector('canvas');return {cssWidth:canvas.clientWidth,cssHeight:canvas.clientHeight,dpr:devicePixelRatio,diagnostics:window.__PROJECTION__.diagnostics(),metrics:window.__THREE_GAME_DIAGNOSTICS__};});
  const large=await snapshot();
  await page.screenshot({path:`artifacts/qa/${name}.png`});
  await page.setViewportSize({width:1280,height:720});await page.waitForTimeout(800);
  const smaller=await snapshot();reports.push({name,large,smaller});
  for(const state of [large,smaller]) {
   const d=state.diagnostics;
   if(d.renderWidth!==d.underwaterWidth||d.renderWidth!==d.compositeWidth||d.renderHeight!==d.underwaterHeight||d.renderHeight!==d.compositeHeight)throw new Error('Intermediate layers do not match output resolution');
   if(d.renderWidth*d.renderHeight>8388608||d.renderWidth>4096||d.renderHeight>4096)throw new Error('Resolution exceeded allocation budget');
   if(!d.resolutionCapped&&(d.renderWidth<state.cssWidth*state.dpr*.985||d.renderHeight<state.cssHeight*state.dpr*.985))throw new Error('Output undersamples display density');
   if(d.logicalWidth!==960||d.logicalHeight!==640)throw new Error('Physical display resolution changed scene world size');
   if(d.geometries!==large.diagnostics.geometries||d.textures!==large.diagnostics.textures)throw new Error('Resize leaked renderer resources');
  }
  await context.close();
 }
 if(errors.length)throw new Error(errors.join('\n'));
} finally {
 await writeFile('artifacts/qa/resolution-evidence.json',JSON.stringify({errors,reports},null,2));
 await browser.close();
}
console.log(JSON.stringify({errors,reports:reports.map(r=>({name:r.name,large:[r.large.diagnostics.renderWidth,r.large.diagnostics.renderHeight],smaller:[r.smaller.diagnostics.renderWidth,r.smaller.diagnostics.renderHeight],fps:r.large.metrics.renderFps}))}));
