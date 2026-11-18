import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(()=>{const Native=window.AudioContext;window.__audioContexts=[];window.AudioContext=class extends Native{constructor(...args){super(...args);window.__audioContexts.push(this);}};});
const page=await context.newPage(),errors=[],consoleErrors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
const diag=()=>page.evaluate(()=>window.__PROJECTION__?.diagnostics());
const sound=()=>page.evaluate(()=>({contexts:window.__audioContexts.map(c=>c.state),enabled:window.__PROJECTION__.settings().sound}));
const scenes=[['koi-pond','Koi pond'],['forest-floor','Forest floor'],['tide-pool','Tide pool'],['butterfly-meadow','Butterfly meadow'],['sandy-beach','Sandy beach']];
const reports=[];
const pixels=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>{const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2'),data=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);const colors=new Set();for(let y=0;y<8;y++)for(let x=0;x<8;x++){const i=(Math.floor(canvas.height*(.08+y*.12))*canvas.width+Math.floor(canvas.width*(.08+x*.12)))*4;colors.add(`${data[i]},${data[i+1]},${data[i+2]}`);}resolve(colors.size);})));
try{
 await page.goto('http://127.0.0.1:5188/');await page.waitForFunction(()=>window.__PROJECTION__?.diagnostics().assetsLoaded);
 await page.getByRole('button',{name:'Enable sound',exact:true}).click();await page.waitForTimeout(500);reports.push({id:'initial',audio:await sound()});
 for(const [id,title] of scenes){
  await page.getByRole('combobox',{name:'Scene',exact:true}).click();await page.getByRole('option',{name:new RegExp('^'+title)}).click();
  await page.waitForFunction(id=>window.__PROJECTION__?.settings().activityId===id&&window.__PROJECTION__?.diagnostics().assetsLoaded,id);
  await page.waitForTimeout(500);const before=await diag(),audioBeforeInput=await sound(),pixelColors=await pixels();
  const canvas=page.getByLabel(`Interactive scene: ${title}`,{exact:true});const box=await canvas.boundingBox();
  await page.mouse.move(box.x+box.width*.4,box.y+box.height*.55);await page.mouse.click(box.x+box.width*.5,box.y+box.height*.55);await page.waitForTimeout(400);
  reports.push({id,before,audioBeforeInput,pixelColors,after:await diag(),audio:await sound()});
  await page.screenshot({path:`artifacts/qa/audit-${id}.png`});
 }
}finally{await writeFile('artifacts/qa/new-scenes-audit.json',JSON.stringify({errors,consoleErrors,reports},null,2));await browser.close();}
console.log(JSON.stringify({errors,consoleErrors,scenes:reports.map(r=>({id:r.id,audio:r.audio,loaded:r.after?.assetsLoaded,pixelColors:r.pixelColors,audioBeforeInput:r.audioBeforeInput,reaction:r.after?.impulseCount??r.after?.splashCount}))}));
