import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const baseUrl=process.env.PROJECTION_VISION_URL??'http://127.0.0.1:5190';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const report={date:new Date().toISOString(),input:'generated blank canvas, not a camera',ready:false,frames:[],errors:[]};
try{
 const page=await browser.newPage();
 page.on('console',message=>{if(message.type()==='error'&&!message.text().startsWith('INFO:'))report.errors.push(message.text().slice(0,600))});
 await page.route(`${baseUrl}/__worker-smoke`,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Worker verification</title>'}));
 await page.goto(`${baseUrl}/__worker-smoke`);
 const result=await page.evaluate(async baseUrl=>{
  const worker=new Worker('/src/projection/vision/worker.ts',{type:'module'});
  try{
   const next=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Worker response timeout')),45000);worker.onmessage=event=>{clearTimeout(timer);if(event.data.type==='error')reject(new Error(event.data.message));else resolve(event.data)};worker.onerror=error=>{clearTimeout(timer);reject(new Error(error.message))}});
   const ready=next();worker.postMessage({type:'init',baseUrl:`${baseUrl}/`});const init=await ready;
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const context=canvas.getContext('2d');const frames=[];
   for(let i=1;i<=3;i++){
    context.fillStyle=`rgb(${30+i*20},${35+i*20},${40+i*20})`;context.fillRect(0,0,640,360);
    const bitmap=await createImageBitmap(canvas);const received=next();worker.postMessage({type:'frame',bitmap,timestamp:i*100,frameId:i,mirrored:false,sensitivity:0.65},[bitmap]);const value=await received;frames.push({type:value.type,inferenceMs:value.inferenceMs,hands:value.hands,presence:value.frame.presence.length,motion:value.frame.motion.length,impulses:value.frame.impulses.length});
   }
   return{ready:init,frames};
  }finally{worker.terminate()}
 },baseUrl);
 report.ready=result.ready;report.frames=result.frames;
}catch(error){report.errors.push(error.message)}finally{await browser.close();await writeFile('artifacts/vision-worker-smoke.json',`${JSON.stringify(report,null,2)}\n`);console.log(JSON.stringify(report,null,2))}
if(!report.ready||report.frames.length!==3)process.exitCode=1;
