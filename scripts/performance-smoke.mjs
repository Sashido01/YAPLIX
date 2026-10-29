import {chromium,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {fork} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {prepareSyntheticProviderUI} from '../tests/ui-jobs-helper.ts';
mkdirSync('.local/performance',{recursive:true});
const label=process.argv[2]??'current';
if(!/^[a-z][a-z0-9-]{0,32}$/.test(label))throw Error('INVALID_PERFORMANCE_LABEL');
let child, browser;
process.on('exit',()=>child?.kill());
try {
if(!process.env.PERF_URL){child=fork('tests/browser-server.ts',[],{silent:true,env:{...process.env,YAPLIX_PLAY_PORT:'3230',YAPLIX_PLAY_DB:':memory:'}});child.stderr.on('data',data=>process.stderr.write(data));const deadline=Date.now()+10000;while(Date.now()<deadline){if(child.exitCode!==null)throw Error('SYNTHETIC_PERFORMANCE_SERVER_FAILED');try{if((await fetch('http://127.0.0.1:3230/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}if(Date.now()>=deadline)throw Error('SYNTHETIC_PERFORMANCE_SERVER_TIMEOUT');}
const base=process.env.PERF_URL??'http://127.0.0.1:3230';
browser=await chromium.launch();
const runs=[];
const setup=await browser.newPage();await setup.goto(base);await setup.locator('#prompt').fill('Тест производительности: собери три очка');await prepareSyntheticProviderUI(setup);await setup.getByRole('button',{name:'Создать игру',exact:true}).click();await expect(setup.locator('#game iframe')).toBeVisible({timeout:20000});const exported=await setup.request.get(await setup.locator('#export').getAttribute('href'));if(!exported.ok())throw Error('SYNTHETIC_GAME_EXPORT_FAILED');const artifact={html:await exported.text()};await setup.close();
const embedded=tag=>[...artifact.html.matchAll(new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+tag+'>','gi'))].reduce((sum,m)=>sum+Buffer.byteLength(m[1]),0);
const gameSize={htmlBytes:Buffer.byteLength(artifact.html),inlineJsBytes:embedded('script'),inlineCssBytes:embedded('style'),externalReferences:[...artifact.html.matchAll(/(?:src|href)=["'](https?:[^"']*)/gi)].map(m=>m[1])};
const api=[];for(let i=0;i<10;i++){const start=performance.now();const r=await fetch(base+'/api/games');await r.json();api.push(performance.now()-start);}
const assets=[];for(const path of ['/','/ui/style.css','/runtime/ui.js','/runtime/runtime.js','/runtime/contracts.js']){const r=await fetch(base+path);const bytes=Buffer.from(await r.arrayBuffer());if(r.ok)assets.push({path,bytes:bytes.length,gzip:gzipSync(bytes).length});}
try{for(let i=0;i<7;i++){
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}), page=await context.newPage();
  await page.addInitScript(()=>{window.longTasks=[];new PerformanceObserver(l=>window.longTasks.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});});
  const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Performance.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:1600000/8,uploadThroughput:750000/8});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>document.querySelector('#games button'));const initialResources=await page.evaluate(()=>performance.getEntriesByType('resource').map(e=>new URL(e.name).pathname));
  const interactive=await page.evaluate(()=>performance.now());if(await page.getByRole('button',{name:'Игры',exact:true}).count())await page.getByRole('button',{name:'Игры',exact:true}).click();const begin=performance.now();
  await page.locator('#games button').first().tap();const game=page.frameLocator('#game iframe');await expect(game.getByRole('button',{name:'Старт',exact:true})).toBeVisible();const launch=performance.now()-begin;
  await game.getByRole('button',{name:'Start',exact:true}).tap();const frame=page.frames().find(f=>f!==page.mainFrame());
  await frame.evaluate(()=>{window.touchLag=null;let start=0;document.addEventListener('pointerdown',()=>start=performance.now(),{capture:true});new MutationObserver(()=>{if(start)window.touchLag=performance.now()-start;}).observe(document.querySelector('#score'),{childList:true,subtree:true,characterData:true});});
  await game.getByRole('button',{name:'Point',exact:true}).tap();await expect(game.locator('#score')).toHaveText('1');
  const touch=await frame.evaluate(()=>window.touchLag);
  const frameTimes=await frame.evaluate(()=>new Promise(done=>{const periods=[];let before=performance.now();function tick(t){periods.push(t-before);before=t;if(periods.length<61)requestAnimationFrame(tick);else done(periods.slice(1));}requestAnimationFrame(tick);}));
  const metrics=await cdp.send('Performance.getMetrics');expect(errors).toEqual([]);
  runs.push({initialResources,interactiveMs:interactive,gameLaunchMs:launch,touchMs:touch,longTasks:await page.evaluate(()=>window.longTasks),rafIntervalsMs:frameTimes,heapBytes:metrics.metrics.find(m=>m.name==='JSHeapUsedSize')?.value??null});
  await context.close();console.log(JSON.stringify({run:i+1,interactiveMs:Math.round(interactive),gameLaunchMs:Math.round(launch)}));
}}catch(error){await browser.close();throw error;}
const memoryContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}), memoryPage=await memoryContext.newPage(),memoryCDP=await memoryContext.newCDPSession(memoryPage);
await memoryCDP.send('Performance.enable');await memoryPage.goto(base);if(await memoryPage.getByRole('button',{name:'Игры',exact:true}).count())await memoryPage.getByRole('button',{name:'Игры',exact:true}).click();
const heap=async()=>{await memoryCDP.send('HeapProfiler.collectGarbage');return(await memoryCDP.send('Performance.getMetrics')).metrics.find(m=>m.name==='JSHeapUsedSize').value;};
const heapBefore=await heap(),samples=[];
for(let i=0;i<40;i++){await memoryPage.locator('#games button').first().click();await expect(memoryPage.frameLocator('#game iframe').getByRole('button',{name:'Старт',exact:true})).toBeVisible();if(await memoryPage.getByRole('button',{name:'Игры',exact:true}).count())await memoryPage.getByRole('button',{name:'Игры',exact:true}).click();else await memoryPage.evaluate(()=>document.querySelector('#game').replaceChildren());await expect(memoryPage.locator('iframe')).toHaveCount(1);if((i+1)%10===0)samples.push({cycles:i+1,heapBytes:await heap()});}
const memoryCycles={cycles:40,samples,heapBefore,heapAfter:await heap(),remainingIframes:await memoryPage.locator('iframe').count()};await memoryContext.close();await browser.close();
const p75=a=>a.toSorted((a,b)=>a-b)[Math.ceil(a.length*.75)-1];
const output={label,browser:browser.version(),conditions:{viewport:'390x844',DPR:2,cpuThrottle:4,network:'150ms RTT; 1.6Mbps down; 750kbps up',warmup:'server warm; fresh uncached browser context per run',repeats:7},assets,gameSize,memoryCycles,apiMs:api,runs,p75:{interactiveMs:p75(runs.map(x=>x.interactiveMs)),gameLaunchMs:p75(runs.map(x=>x.gameLaunchMs)),touchMs:p75(runs.map(x=>x.touchMs)),apiMs:p75(api)}};
const critical=assets.filter(a=>a.path==='/'||runs[0].initialResources.includes(a.path));const js=critical.filter(a=>a.path.endsWith('.js')).reduce((sum,a)=>sum+a.gzip,0),css=critical.filter(a=>a.path.endsWith('.css')).reduce((sum,a)=>sum+a.gzip,0),total=critical.reduce((sum,a)=>sum+a.gzip,0);output.criticalAssets=critical;output.budgets={jsGzipBytes:js,cssGzipBytes:css,totalGzipBytes:total,limits:{js:150000,css:30000,total:250000,interactiveP75Ms:3000}};expect(js).toBeLessThanOrEqual(150000);expect(css).toBeLessThanOrEqual(30000);expect(total).toBeLessThanOrEqual(250000);if(output.p75.interactiveMs>3000)console.warn('Timing goal exceeded: shared-runner timing is reported, not hidden by increasing budget.');writeFileSync('.local/performance/'+label+'.json',JSON.stringify(output,null,2));console.log(JSON.stringify({p75:output.p75,budgets:output.budgets}));if(child){child.send('shutdown');await new Promise(done=>child.once('exit',done));child=undefined;}

} finally {
  await browser?.close();
  if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise(done=>child.once('exit',done));if(child.connected)child.send('shutdown');const force=setTimeout(()=>child?.kill('SIGKILL'),7000);await exited;clearTimeout(force);child=undefined;}
}
