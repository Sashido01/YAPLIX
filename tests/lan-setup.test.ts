import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LanSetup, type LanSnapshot} from '../src/lan-setup.ts';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../src/api.ts';
import {Store} from '../src/store.ts';
const snapshot:LanSnapshot={platform:'win32',complete:true,adapters:[{id:'physical-1',name:'Wi-Fi',address:'192.168.10.12',prefix:24,profile:'Private'}],firewall:{enabled:true,allowInbound:true,allowLocal:true},rules:[],listeners:[]};
test('read-only preflight never calls elevation or treats a missing Allow as ready',async()=>{
  let elevations=0;
  const setup=new LanSetup({nodePath:'C:\\Program Files\\nodejs\\node.exe',ports:[52604,52605],installation:'fixture',collect:async()=>structuredClone(snapshot),elevate:async()=>{elevations++;return {code:'applied'};}});
  const status=await setup.diagnose('192.168.10.12');
  assert.equal(status.status,'ACTION_REQUIRED');assert.equal(elevations,0);
  assert.equal(status.nodePath,'C:\\Program Files\\nodejs\\node.exe');
  assert.deepEqual(status.ports,[52604,52605]);
});
function allow(overrides:Partial<import('../src/lan-setup.ts').LanRule>={}){return {name:'manual',group:'',description:'',enabled:true,action:'Allow',profiles:['Private'],program:'C:\\Program Files\\nodejs\\node.exe',protocol:'TCP',ports:['52604','52605'],local:['192.168.10.12'],remote:['LocalSubnet'],interfaces:['Wi-Fi'],unconditional:true,source:'Local',...overrides};}
const make=(current:LanSnapshot,extra:object={})=>new LanSetup({installation:'a'.repeat(20),nodePath:'C:\\Program Files\\nodejs\\node.exe',ports:[52604,52605],collect:async()=>structuredClone(current),...extra});
test('manual Allow is preserved; program-wide Block overrides it; unknown restrictions never earn READY',async()=>{
 const current=structuredClone(snapshot);current.rules=[allow()];const setup=make(current);
 assert.equal((await setup.diagnose()).status,'READY');assert.deepEqual((await setup.plan('configure','192.168.10.12')).add,[]);
 current.rules.push(allow({name:'program block',action:'Block',ports:['Any'],local:['Any'],remote:['Any'],interfaces:['Any']}));
 assert.equal((await setup.diagnose()).status,'ACTION_REQUIRED');await assert.rejects(setup.plan('configure','192.168.10.12'),/LAN_UNABLE_TO_MANAGE/);
 current.rules=[allow({unconditional:false})];assert.notEqual((await setup.diagnose()).status,'READY');
});
test('Public, disabled Firewall, local-merge denial, unreadable policy and non-Windows never invoke elevation',async()=>{
 for(const changed of [{adapters:[{...snapshot.adapters[0],profile:'Public'}]},{firewall:{enabled:false,allowInbound:true,allowLocal:true}},{firewall:{enabled:true,allowInbound:true,allowLocal:false}},{complete:false},{platform:'linux'}]){
  const current={...structuredClone(snapshot),...changed};let elevated=false;const setup=make(current,{elevate:async()=>{elevated=true;return {code:'applied'};}});
  assert.notEqual((await setup.diagnose()).status,'READY');await assert.rejects(setup.plan('configure','192.168.10.12'));assert.equal(elevated,false);
 }
});
test('reviewed plan is narrow, survives DHCP within subnet, and needs fresh consent after race/expiry',async()=>{
 const current=structuredClone(snapshot);let elevations=0,now=1000;const setup=make(current,{now:()=>now,elevate:async()=>{elevations++;return {code:'cancelled_or_unavailable'};}});
 let plan=await setup.plan('configure','192.168.10.12');assert.equal(plan.subnet,'192.168.10.0/24');assert.equal(plan.add[0].adapter.name,'Wi-Fi');assert.deepEqual(plan.add[0].ports,[52604,52605]);
 await assert.rejects(setup.apply(plan.id,false),/LAN_CONSENT_REQUIRED/);assert.equal(elevations,0);
 current.adapters[0].address='192.168.10.99';await assert.rejects(setup.apply(plan.id,true),/LAN_STATE_CHANGED/);assert.equal(elevations,0);
 plan=await setup.plan('configure','192.168.10.99');assert.equal(plan.subnet,'192.168.10.0/24');now+=300001;await assert.rejects(setup.apply(plan.id,true),/LAN_PLAN_EXPIRED/);
 plan=await setup.plan('configure','192.168.10.99');assert.equal((await setup.apply(plan.id,true)).code,'cancelled_or_unavailable');assert.equal(elevations,1);await assert.rejects(setup.apply(plan.id,true),/LAN_PLAN_EXPIRED/);
});
test('stale own rules are explicitly reviewed; manual rules never removed; repeat configure does not duplicate',async()=>{
 const current=structuredClone(snapshot),setup=make(current);const p=await setup.plan('configure','192.168.10.12'),spec=p.add[0];
 current.rules=[allow({name:spec.name,group:spec.group,description:spec.description,local:[spec.subnet],remote:[spec.subnet] }),allow({name:'YAPLIX Arena TCP 52605'})];
 assert.equal((await setup.plan('configure','192.168.10.12')).add.length,0);
 assert.deepEqual((await setup.plan('remove','192.168.10.12')).remove.map(r=>r.name),[spec.name]);
 current.adapters[0].address='192.168.20.3';const update=await setup.plan('configure','192.168.20.3');assert.equal(update.add.length,1);assert.equal(update.remove.length,1);assert.equal(update.subnet,'192.168.20.0/24');
});
test('DHCP within subnet retains own Allow; narrowing ports replaces instead of deleting the only Allow',async()=>{
 const current=structuredClone(snapshot),setup=make(current);const original=await setup.plan('configure','192.168.10.12'),spec=original.add[0];
 current.rules=[allow({name:spec.name,group:spec.group,description:spec.description,local:[spec.subnet],remote:[spec.subnet]})];
 current.adapters[0].address='192.168.10.44';const dhcp=await setup.plan('configure','192.168.10.44');assert.equal(dhcp.add.length,0);assert.equal(dhcp.remove.length,0);
 const narrowed=make(current,{ports:[52604]});const update=await narrowed.plan('configure','192.168.10.44');assert.equal(update.add.length,1);assert.equal(update.remove.length,1);
});
test('Windows helper executes narrow rules and rollback against synthetic cmdlets only',{skip:process.platform!=='win32'},async()=>{
 const current=structuredClone(snapshot);current.adapters[0].name='Беспроводная сеть [owner] $(no-code)';const setup=make(current,{nodePath:process.execPath});
 const plan=await setup.plan('configure','192.168.10.12'),directory=mkdtempSync(join(tmpdir(),'yaplix-lan-'));
 try{const path=join(directory,'plan.json');writeFileSync(path,JSON.stringify(plan));const result=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',resolve('tests/windows-lan-setup.fixture.ps1'),'-Fixture',path],{encoding:'utf8',windowsHide:true,timeout:15000});assert.match(result,/SYNTHETIC_HELPER_PASS/);}finally{rmSync(directory,{recursive:true,force:true});}
});
test('owner API requires loopback, exact Origin, explicit header and consent before helper dispatch',async()=>{
 const store=new Store(':memory:');let elevated=0;
 const lan=make(structuredClone(snapshot),{elevate:async()=>{elevated++;return {code:'unable_to_manage'};}});
 const app=createApp(store,undefined,undefined,{mode:'local',host:'127.0.0.1',port:3000},undefined,undefined,undefined,undefined,undefined,undefined,lan);
 const url='http://127.0.0.1:3000/api/lan-setup',headers={'Content-Type':'application/json',Origin:'http://127.0.0.1:3000','X-Yaplix-LAN-Setup':'owner'},body=JSON.stringify({action:'configure',address:'192.168.10.12'});
 try{
  assert.equal((await app.request(url)).status,200);assert.equal(elevated,0);
  for(const bad of [{'Content-Type':'application/json'},{...headers,Origin:'null'},{...headers,Origin:'https://attacker.invalid'},{...headers,'X-Yaplix-LAN-Setup':''}])assert.equal((await app.request(url+'/plan',{method:'POST',headers:bad,body})).status,403);
  const plan=await(await app.request(url+'/plan',{method:'POST',headers,body})).json();
  assert.equal((await app.request(url+'/apply',{method:'POST',headers,body:JSON.stringify({id:plan.id,consent:false})})).status,403);assert.equal(elevated,0);
  const applied=await(await app.request(url+'/apply',{method:'POST',headers,body:JSON.stringify({id:plan.id,consent:true})})).json();assert.equal(applied.code,'unable_to_manage');assert.equal(applied.diagnostics.status,'ACTION_REQUIRED');assert.equal(elevated,1);
  const remote=createApp(store,undefined,undefined,{mode:'lan',host:'192.168.10.12',port:3000,key:'a'.repeat(32),origin:'http://192.168.10.12:3000'},undefined,undefined,undefined,undefined,undefined,undefined,lan);
  assert.equal((await remote.request(url)).status,403);
 }finally{store.close();}
});
test('unrelated listener churn does not invalidate consent; concurrent apply dispatches helper once',async()=>{
 const current=structuredClone(snapshot);let finish!:()=>void,elevations=0;
 const setup=make(current,{elevate:async()=>{elevations++;await new Promise<void>(resolve=>{finish=resolve;});return {code:'applied'};}});
 const plan=await setup.plan('configure','192.168.10.12');current.listeners=[{address:'127.0.0.1',port:12345,pid:999}];
 const first=setup.apply(plan.id,true);await new Promise(resolve=>setImmediate(resolve));await assert.rejects(setup.apply(plan.id,true),/LAN_BUSY/);assert.equal(elevations,1);finish();await first;
});
test('readiness, self GET and physical-device proof stay independent',async()=>{
 const current=structuredClone(snapshot);current.rules=[allow()];const setup=make(current,{probe:async()=>[{kind:'arena',state:'SELF_GET_FAILED'}]});
 const d=await setup.diagnose();assert.equal(d.status,'READY');assert.equal(d.probes[0].state,'SELF_GET_FAILED');assert.equal(d.physicalDevice,'NOT_VERIFIED');
});
test('cleanup remains explicit and narrow when original adapter is gone or Public; Node/adapter changes need a new plan',async()=>{
 const current=structuredClone(snapshot),original=make(current),first=await original.plan('configure','192.168.10.12'),spec=first.add[0];
 current.rules=[allow({name:spec.name,group:spec.group,description:spec.description,local:[spec.subnet],remote:[spec.subnet]})];
 for(const changed of [{nodePath:'D:\\Node\\node.exe'},{ports:[52604,52700]}]){const plan=await make(current,changed).plan('configure','192.168.10.12');assert.equal(plan.add.length,1);assert.equal(plan.remove.length,1);}
 current.adapters=[];const cleanup=await original.plan('remove','');assert.equal(cleanup.add.length,0);assert.equal(cleanup.remove.length,1);assert.equal((await original.diagnose()).removable,true);
 current.adapters=[{...snapshot.adapters[0],profile:'Public'}];await assert.rejects(original.beforeQr('192.168.10.12'),/LAN_PRIVATE_REQUIRED/);assert.equal((await original.plan('remove','192.168.10.12')).add.length,0);
});
test('automatic rules never widen a private IP into a subnet containing public addresses',async()=>{
 for(const adapter of [{...snapshot.adapters[0],prefix:8},{...snapshot.adapters[0],address:'172.16.1.2',prefix:8}]){
  const current={...structuredClone(snapshot),adapters:[adapter]},setup=make(current);assert.equal((await setup.diagnose(adapter.address)).status,'UNVERIFIED');await assert.rejects(setup.plan('configure',adapter.address),/LAN_UNABLE_TO_MANAGE/);
 }
});
test('an existing correct manual phone Allow is not duplicated when only Arena needs access',async()=>{
 const current=structuredClone(snapshot);current.rules=[allow({ports:['52604']})];const plan=await make(current).plan('configure','192.168.10.12');assert.deepEqual(plan.add[0].ports,[52605]);assert.equal(plan.remove.length,0);
});
