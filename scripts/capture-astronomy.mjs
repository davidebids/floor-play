import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const passive=process.argv.includes('--passive');
const output=passive?'artifacts/qa/astronomy-passive':'artifacts/qa/astronomy';
const errors=[];await mkdir(output,{recursive:true});
const context=await browser.newContext({viewport:{width:1440,height:1100},recordVideo:{dir:output,size:{width:1440,height:1100}}});
const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await page.goto('http://127.0.0.1:5188');await page.waitForLoadState('networkidle');
 await page.getByRole('combobox',{name:'Scene',exact:true}).click();await page.getByRole('option',{name:/^Starlit cosmos/}).click();
 await page.waitForFunction(()=>window.__PROJECTION__?.diagnostics().activityId==='starlit-cosmos'&&window.__PROJECTION__.diagnostics().assetsLoaded);
 await page.waitForTimeout(500);
 const canvas=page.getByLabel('Interactive scene: Starlit cosmos',{exact:true});
 await canvas.screenshot({path:`${output}/idle.png`});await page.screenshot({path:`${output}/studio.png`});
 if(passive){
  await page.waitForTimeout(3900);await canvas.screenshot({path:`${output}/shooting-star.png`});
  await page.waitForTimeout(10000);await canvas.screenshot({path:`${output}/drift.png`});
 }else{
 const bounds=await canvas.boundingBox();
 await page.mouse.move(bounds.x+bounds.width*.22,bounds.y+bounds.height*.52);
 for(let i=0;i<30;i++){await page.mouse.move(bounds.x+bounds.width*(.22+i*.018),bounds.y+bounds.height*(.52+Math.sin(i*.18)*.07));await page.waitForTimeout(22);}
 await canvas.click({position:{x:bounds.width*.52,y:bounds.height*.62}});await page.waitForTimeout(300);await canvas.screenshot({path:`${output}/tap.png`});
 await page.waitForTimeout(1400);
 }

 const report={syntheticInteraction:!passive,passiveOnly:passive,physicalCamera:false,errors,diagnostics:await page.evaluate(()=>window.__PROJECTION__.diagnostics())};
 await page.setViewportSize({width:656,height:852});await page.waitForTimeout(300);await page.screenshot({path:`${output}/compact.png`,fullPage:true});
 await writeFile(`${output}/inspection.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));if(errors.length)process.exitCode=1;
}finally{await context.close();await browser.close();}
