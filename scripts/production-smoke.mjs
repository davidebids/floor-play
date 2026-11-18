import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:5189';const errors=[],requests=[],logs=[];
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({permissions:['camera'],viewport:{width:1440,height:1000}});const page=await context.newPage();
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('INFO:'))logs.push(m.text());});page.on('requestfailed',r=>errors.push(`${r.url()}: ${r.failure()?.errorText}`));page.on('request',r=>requests.push(r.url()));
try{
 await page.goto(base);await page.getByRole('heading',{name:'Koi pond',exact:true}).waitFor();
 await page.getByRole('button',{name:'Connect camera',exact:true}).click();
 await page.getByLabel('Show diagnostics',{exact:true}).check();
 await page.waitForFunction(()=>{const row=[...document.querySelectorAll('.diagnostics dl > div')].find(row=>row.querySelector('dt')?.textContent==='Tracking');return parseFloat(row?.querySelector('dd')?.textContent||'0')>0;},{},{timeout:45000});
 await page.getByRole('button',{name:'Align camera',exact:true}).last().click();
 await page.getByAltText('Click the projected floor corners in this camera preview').waitFor({timeout:45000});
 const area=page.locator('.camera-alignment');const box=await area.boundingBox();
 for(const [x,y]of[[.1,.1],[.9,.1],[.9,.9],[.1,.9]])await area.click({position:{x:box.width*x,y:box.height*y}});
 await page.getByRole('button',{name:'Save alignment'}).click();
 await page.getByText('Camera connected',{exact:true}).waitFor({timeout:45000});
 await page.waitForTimeout(1500);
 const result=await page.evaluate(()=>({debugHookExposed:typeof window.__PROJECTION__!=='undefined',settings:JSON.parse(localStorage.getItem('projection-app.settings.v1')),videoElements:document.querySelectorAll('video').length}));
 const external=requests.filter(url=>!url.startsWith(base)&&!url.startsWith('blob:')&&!url.startsWith('data:'));
 const assets=requests.filter(url=>/\.wasm|\.tflite|\.task/.test(url));
 const report={syntheticCamera:true,actualGoPro:false,errors,consoleErrors:logs,externalRequests:external,modelAndWasmRequests:assets,calibrated:result.settings.settings.calibration.calibrated,debugHookExposed:result.debugHookExposed,videoElements:result.videoElements};
 await writeFile('artifacts/qa/production-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(errors.length||logs.length||external.length||!report.calibrated||result.debugHookExposed)process.exitCode=1;
 await page.getByRole('button',{name:'Mouse',exact:true}).click();
}catch(error){console.error(error);await writeFile('artifacts/qa/production-smoke.json',JSON.stringify({syntheticCamera:true,actualGoPro:false,errors,consoleErrors:logs,error:String(error),caption:await page.locator('.scene-caption').innerText().catch(()=>''),alerts:await page.getByRole('alert').allTextContents()},null,2));process.exitCode=1;}finally{await browser.close();}
