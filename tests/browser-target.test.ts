import test from 'node:test';
import assert from 'node:assert/strict';
import {checkerChannel,checkerLaunchTarget} from '../src/browser-target.ts';
test('delivery uses only explicit supported Chrome channels and keeps the original default',()=>{
 const original=process.env.YAPLIX_BROWSER_CHANNEL;
 try{delete process.env.YAPLIX_BROWSER_CHANNEL;assert.equal(checkerChannel(),'chromium');process.env.YAPLIX_BROWSER_CHANNEL='chrome';assert.equal(checkerChannel(),'chrome');process.env.YAPLIX_BROWSER_CHANNEL='firefox';assert.throws(()=>checkerChannel(),{code:'BROWSER_INSTALL_REQUIRED'});}
 finally{if(original===undefined)delete process.env.YAPLIX_BROWSER_CHANNEL;else process.env.YAPLIX_BROWSER_CHANNEL=original;}
});
test('Full selects its packaged headless shell',()=>{
 const original=process.env.YAPLIX_BROWSER_CHANNEL;
 try{
  process.env.YAPLIX_BROWSER_CHANNEL='chromium';
  const target=checkerLaunchTarget('/opt/yaplix/browsers');
  assert.match(target.executablePath!.replaceAll('\\','/'),/chromium_headless_shell-1248\/chrome-headless-shell-(linux64\/chrome-headless-shell|win64\/chrome-headless-shell\.exe)$/);
  assert.equal('channel' in target,false);
 }finally{if(original===undefined)delete process.env.YAPLIX_BROWSER_CHANNEL;else process.env.YAPLIX_BROWSER_CHANNEL=original;}
});
