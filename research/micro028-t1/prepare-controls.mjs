// Run BEFORE creating the probe. Authored controls, never LLM output.
// Frozen HTML is the input; the checker must not import this file or oracle.json.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
if (existsSync(root + 'heldout/manifest.json')) throw Error('Controls already frozen');
mkdirSync(root + 'heldout', { recursive: true });
const entries = [];
for (let i = 0; i < 6; i++) {
  const family = i < 3 ? 'switch' : 'pressure', equivalent = i % 3 === 1, broken = i % 3 === 2;
  const ids = equivalent ? { start: 'activate', play: 'lever', again: 'renew' } : { start: 'begin', play: 'pulse', again: 'repeat' };
  const title = family === 'switch' ? 'Switch register' : 'Pressure chamber';
  const rules = family === 'switch' ? 'Toggle reverses one lamp and adds one turn. Three toggles finish. Inactivity ends after five seconds.' : 'Vent adds three pressure units. Pressure drops once each half second. Below minus seven ends the run. Restart restores zero.';
  const html = `<!DOCTYPE html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:8px;font:16px system-ui;background:#fafafa}main{max-width:360px;margin:auto}canvas{width:100%;height:180px}button{min-height:44px;min-width:70px} [hidden]{display:none!important}
</style></head><body><main><h1>${title}</h1><p>${rules}</p><section id="intro"><button id="${ids.start}">Begin</button></section><output id="readout"></output><canvas width="320" height="180"></canvas><button hidden id="${ids.play}">${family === 'switch' ? 'Toggle' : 'Vent'}</button><p id="message"></p><button hidden id="${ids.again}">Restart</button></main><script>
const ctx=document.querySelector('canvas').getContext('2d'),intro=document.querySelector('#intro'),control=document.querySelector('#${ids.play}'),again=document.querySelector('#${ids.again}'),msg=document.querySelector('#message');
let active=false,value=0,turns=0,lamp=false,elapsed=0,last=performance.now();
function paint(){ctx.clearRect(0,0,320,180);ctx.fillStyle=lamp?'#f4bb22':'#145278';ctx.fillRect(30,60,40,40);const text='${family === 'switch' ? 'Turns' : 'Pressure'}: '+${family === 'switch' ? 'turns' : 'value'};${equivalent ? "ctx.fillStyle='#111';ctx.fillText(text,10,25);" : "document.querySelector('#readout').textContent=text;"}}
function finish(){active=false;msg.textContent='Game over';again.hidden=false;control.hidden=true;}
function begin(){${broken && family === 'pressure' ? '' : 'value=0;turns=0;lamp=false;'}elapsed=0;active=true;intro.hidden=true;msg.textContent='';again.hidden=true;control.hidden=false;last=performance.now();paint();}
function act(){if(!active)return;${broken && family === 'switch' ? '' : family === 'switch' ? 'lamp=!lamp;turns++;if(turns===3)finish();' : 'value+=3;'}paint();}
function tick(dt){if(active){const before=Math.floor(elapsed/500);elapsed+=dt;${family === 'pressure' ? 'value-=Math.floor(elapsed/500)-before;if(value< -7)finish();' : 'if(elapsed>=5000)finish();'}}paint();}
document.querySelector('#${ids.start}').onclick=begin;again.onclick=begin;control.onclick=act;
${equivalent ? "let held=false;addEventListener('keydown',e=>{if(e.code==='Space'&&!held){held=true;act();}});addEventListener('keyup',()=>held=false);function frame(t){tick(t-last);last=t;requestAnimationFrame(frame);}requestAnimationFrame(frame);" : "addEventListener('keydown',e=>{if(e.code==='Space'&&!e.repeat)act();});setInterval(()=>tick(20),20);"}
paint();</script></body></html>\n`;
  const name = String.fromCharCode(97 + i) + '.html';
  writeFileSync(root + 'heldout/' + name, html);
  entries.push({ file: name, sha256: createHash('sha256').update(html).digest('hex') });
}
writeFileSync(root + 'heldout/manifest.json', JSON.stringify({ authored: true, seeds: [17, 101, 991], entries }, null, 2) + '\n');
writeFileSync(root + 'oracle.json', JSON.stringify({
  independence: 'Same Codex author; frozen before prototype, not independently blind.',
  families: [
    { files: ['a.html', 'b.html', 'c.html'], mechanic: 'binary switch register', equivalence: 'same lamp/turn rules; DOM+interval versus Canvas+RAF and key latch', good: ['a.html', 'b.html'], defective: 'c.html', defect: 'Toggle and Space are disconnected; turns remain zero.', affectedAspect: 'inputNumericDifference', oracleActions: ['Begin', 'Toggle', 'Toggle', 'Toggle', 'Restart', 'Toggle'], expected: 'turns 0,1,2,3; end; restart 0; then 1. c stays 0 until passive timeout.' },
    { files: ['d.html', 'e.html', 'f.html'], mechanic: 'pressure regulation', equivalence: 'Vent +3, loss below -7, drift -1/500ms; DOM+interval versus Canvas+RAF (frame quantization <20ms)', good: ['d.html', 'e.html'], defective: 'f.html', defect: 'Restart leaves terminal pressure -8 instead of restoring zero.', affectedAspect: 'restartObservedReset', oracleActions: ['Begin', 'idle 4100ms', 'Restart', 'Vent'], expected: 'pressure 0,-8; end; restart 0; Vent 3. f restarts at -8 then Vent -5.' },
  ],
  scoring: 'Aspect-level only. Correct partial observations on a defective document are not a whole-game accept. Also report undetected defective games explicitly.',
}, null, 2) + '\n');
console.log('Prepared six held-out controls. Freeze in Git before prototype work.');
