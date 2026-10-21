import {test,expect} from '@playwright/test';
import {strictCanvas} from './strict-canvas-fixtures.ts';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

test('Canvas-only offline file: Start, touch, keyboard, Pause, sound, Game Over, Restart and rotation',async({browser},info)=>{
 const folder=mkdtempSync('.local/strict-offline-'),file=resolve(folder,'game.html');writeFileSync(file,strictCanvas());
 const context=await browser.newContext({offline:true,hasTouch:true,deviceScaleFactor:2,viewport:{width:390,height:700}});
 try{
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(file).href);const canvas=page.locator('canvas'),image=()=>canvas.evaluate(c=>(c as HTMLCanvasElement).toDataURL());
  const start=await image();await canvas.tap();expect(await image()).not.toBe(start);
  const before=await image();await canvas.tap();expect(await image()).not.toBe(before);
  await canvas.tap({position:{x:30,y:60}});const paused=await image();await canvas.tap();expect(await image()).toBe(paused);
  await canvas.tap({position:{x:330,y:60}});expect(await image()).not.toBe(paused);
  await canvas.tap({position:{x:30,y:60}});const resumed=await image();await page.keyboard.press('ArrowRight');expect(await image()).not.toBe(resumed);
  await canvas.tap();await canvas.tap();const terminal=await image();await canvas.tap();expect(await image()).not.toBe(terminal);
  const restarted=await image();await canvas.tap();expect(await image()).not.toBe(restarted);
  for(const size of [{width:320,height:700},{width:844,height:390},{width:390,height:700}]){
   await page.setViewportSize(size);await expect(canvas).toHaveJSProperty('width',size.width*2);
   const prior=await image();await canvas.tap();expect(await image()).not.toBe(prior);
  }
  await page.screenshot({path:info.outputPath('strict-canvas.png')});expect(errors).toEqual([]);
 }finally{await context.close();}
});
