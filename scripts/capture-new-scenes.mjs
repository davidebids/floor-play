import {chromium} from 'playwright';
import {writeFile,mkdir} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:'artifacts/qa/new-scenes-motion',size:{width:1440,height:1000}}});
const page=await context.newPage(),errors=[],logs=[],reports=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')logs.push(m.text());});
await mkdir('artifacts/qa/new-scenes',{recursive:true});
try{
 await page.goto('http://127.0.0.1:5188/');await page.waitForFunction(()=>window.__PROJECTION__?.diagnostics().assetsLoaded);
 for(const [id,title]of [['forest-floor','Forest floor'],['tide-pool','Tide pool'],['butterfly-meadow','Butterfly meadow'],['sandy-beach','Sandy beach']]){
  await page.getByRole('combobox',{name:'Scene',exact:true}).click();await page.getByRole('option',{name:new RegExp(title)}).click();
  await page.waitForFunction(id=>window.__PROJECTION__?.diagnostics().sceneId===id&&window.__PROJECTION__.diagnostics().assetsLoaded,id,{timeout:30000});
  await page.waitForTimeout(1000);await page.screenshot({path:`artifacts/qa/new-scenes/${id}-idle.png`});
  const before=await page.evaluate(()=>window.__PROJECTION__.diagnostics());
  const stage=page.locator('.scene-stage'),box=await stage.boundingBox();
  for(let i=0;i<9;i++){await page.mouse.move(box.x+box.width*(.25+i*.06),box.y+box.height*(.45+Math.sin(i)*.1),{steps:4});if(i===3||i===7)await page.mouse.down(),await page.mouse.up();await page.waitForTimeout(100);}
  await page.screenshot({path:`artifacts/qa/new-scenes/${id}-active.png`});
  const after=await page.evaluate(()=>({diag:window.__PROJECTION__.diagnostics(),metrics:window.__THREE_GAME_DIAGNOSTICS__}));reports.push({id,before,...after});
 }
}finally{await context.close();await page.video().saveAs('artifacts/qa/new-scenes-tour.webm');await browser.close();await writeFile('artifacts/qa/new-scenes/initial-check.json',JSON.stringify({errors,logs,reports},null,2));}
console.log(JSON.stringify({errors,logs,scenes:reports.map(r=>({id:r.id,assets:r.diag.assetsLoaded,fps:r.metrics.renderFps,drawCalls:r.diag.drawCalls,impulses:r.diag.impulseCount}))}));
if(errors.length||logs.length)process.exitCode=1;
