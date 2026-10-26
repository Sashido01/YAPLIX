import test from 'node:test';
import assert from 'node:assert/strict';
import {checkerChannel,checkerLaunchTarget} from '../src/browser-target.ts';
test('delivery uses only explicit supported Chrome channels and keeps the original default',()=>{
 const original=process.env.YAPLIX_BROWSER_CHANNEL;
 try{delete process.env.YAPLIX_BROWSER_CHANNEL;assert.equal(checkerChannel(),'chromium');process.env.YAPLIX_BROWSER_CHANNEL='chrome';assert.equal(checkerChannel(),'chrome');process.env.YAPLIX_BROWSER_CHANNEL='firefox';assert.throws(()=>checkerChannel(),{code:'BROWSER_INSTALL_REQUIRED'});}
 finally{if(original===undefined)delete process.env.YAPLIX_BROWSER_CHANNEL;else process.env.YAPLIX_BROWSER_CHANNEL=original;}
});
test('Full selects its packaged Chromium binary, not the headless shell',()=>{
 const original=process.env.YAPLIX_BROWSER_CHANNEL;
 try{
  process.env.YAPLIX_BROWSER_CHANNEL='chromium';
  const target=checkerLaunchTarget('/opt/yaplix/browsers');
  assert.match(target.executablePath!,/chromium-1248\/chrome-(linux64\/chrome|win64\/chrome\.exe)$/);
  assert.equal('channel' in target,false);
 }finally{if(original===undefined)delete process.env.YAPLIX_BROWSER_CHANNEL;else process.env.YAPLIX_BROWSER_CHANNEL=original;}
});
