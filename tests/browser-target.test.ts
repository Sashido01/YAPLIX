import test from 'node:test';
import assert from 'node:assert/strict';
import {checkerChannel,resolveBrowserTarget} from '../src/browser-target.ts';
import {configureBrowserTempRoot} from '../src/browser-temp.ts';
import {existsSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
test('delivery uses only explicit supported Chrome channels and keeps the original default',()=>{
 const original=process.env.YAPLIX_BROWSER_CHANNEL;
 try{delete process.env.YAPLIX_BROWSER_CHANNEL;assert.equal(checkerChannel(),'chromium');process.env.YAPLIX_BROWSER_CHANNEL='chrome';assert.equal(checkerChannel(),'chrome');process.env.YAPLIX_BROWSER_CHANNEL='firefox';assert.throws(()=>checkerChannel(),{code:'BROWSER_INSTALL_REQUIRED'});}
 finally{if(original===undefined)delete process.env.YAPLIX_BROWSER_CHANNEL;else process.env.YAPLIX_BROWSER_CHANNEL=original;}
});
test('Chrome readiness and diagnostics resolve the executable that Playwright will launch',()=>{
 const chrome=resolveBrowserTarget('/cache/playwright/chromium/chrome','linux',{YAPLIX_BROWSER_CHANNEL:'chrome'});
 assert.equal(chrome.channel,'chrome');assert.equal(chrome.executablePath,'/opt/google/chrome/chrome');
 const bundled=resolveBrowserTarget('/cache/playwright/chromium/chrome','linux',{YAPLIX_BROWSER_CHANNEL:'chromium'});
 assert.equal(bundled.channel,'chromium');assert.equal(bundled.executablePath,'/cache/playwright/chromium/chrome');
});
test('Chromium temp profiles use a short private process directory independent of project data paths',()=>{
 const root=configureBrowserTempRoot(),info=statSync(root);
 if(process.platform==='linux'){assert.ok(root.length<=32,`unexpected long profile root: ${root.length}`);assert.match(root,/^\/tmp\/yx-/);}
 assert.equal(info.isDirectory(),true);
 if(process.platform!=='win32')assert.equal(info.mode&0o077,0);
 for(const key of ['TEMP','TMP','TMPDIR'])assert.equal(process.env[key],root);
});
test('Chromium temp profile directory is removed when its owning process exits',()=>{
 const child=spawnSync(process.execPath,['--input-type=module','-e',"const m=await import('./src/browser-temp.ts');process.stdout.write(m.configureBrowserTempRoot())"],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);
 assert.ok(child.stdout.trim());
 assert.equal(existsSync(child.stdout.trim()),false);
});
