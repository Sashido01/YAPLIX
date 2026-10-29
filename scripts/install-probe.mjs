import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,rmSync,existsSync,statSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
const root=fileURLToPath(new URL('../',import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH=resolve(root,'browsers');
const channel=JSON.parse(readFileSync(resolve(root,'packaging/delivery.json'),'utf8')).browser==='system-chrome'?'chrome':'chromium';
const {chromium}=await import('playwright-core');
const temp=mkdtempSync(join(tmpdir(),'y2-'));
const env={...process.env,TMPDIR:temp,TMP:temp,TEMP:temp};
delete env.CHROME_DEVEL_SANDBOX;
if(process.platform==='linux'){
 const helper='/opt/google/chrome/chrome-sandbox';
 if(existsSync(helper)){const s=statSync(helper);if(s.uid===0&&(s.mode&0o4000)&&!(s.mode&0o022))env.CHROME_DEVEL_SANDBOX=helper;}
}
let browser;
try{browser=await chromium.launch({channel,headless:true,chromiumSandbox:true,timeout:12000,env});const page=await browser.newPage();await page.setContent('<canvas width="8" height="8"></canvas>');await page.evaluate(()=>document.querySelector('canvas').getContext('2d').fillRect(0,0,8,8));console.log(JSON.stringify({sandboxReady:true}));}
catch{process.exitCode=1;console.log(JSON.stringify({sandboxReady:false}));}
finally{await browser?.close();rmSync(temp,{recursive:true,force:true});}
