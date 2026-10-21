import {createHash, randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdir, writeFile, readFile, unlink} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {PROJECT_ROOT, managedPath} from './store.ts';
import {privateIPv4} from './access.ts';
import {Fault} from './contracts.ts';

export type LanAdapter={id:string;name:string;address:string;prefix:number;profile:string};
export type LanRule={name:string;group:string;description:string;action:string;enabled?:boolean;profiles:string[];program:string;protocol:string;ports:string[];local:string[];remote:string[];interfaces:string[];unconditional:boolean;source:string};
export type LanSnapshot={platform:string;complete:boolean;error?:string;adapters:LanAdapter[];firewall?:{enabled:boolean;allowInbound:boolean;allowLocal:boolean};rules:LanRule[];listeners:{address:string;port:number;pid:number}[]};
type RuleSpec={name:string;group:string;description:string;program:string;ports:number[];subnet:string;adapter:LanAdapter};
export type LanPlan={id:string;expiresAt:number;action:'configure'|'remove';installation:string;nodePath:string;ports:number[];adapter:LanAdapter;subnet:string;add:RuleSpec[];remove:LanRule[]};
type Result={code:string};
export type LanProbe={kind:string;state:'NOT_STARTED'|'SELF_GET_PASS'|'SELF_GET_FAILED';address?:string;port?:number};
type Options={nodePath?:string;ports?:number[];installation?:string;platform?:string;collect?:(signal:AbortSignal)=>Promise<LanSnapshot>;elevate?:(plan:LanPlan)=>Promise<Result>;now?:()=>number;probe?:()=>Promise<LanProbe[]>};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const any=(values:string[])=>values.some(v=>same(v,'Any')||v==='*');
// Listener PIDs/order and unrelated sockets are volatile, not consent scope.
const fingerprint=(s:LanSnapshot)=>hash({platform:s.platform,complete:s.complete,adapters:[...s.adapters].sort((a,b)=>(a.id+a.address).localeCompare(b.id+b.address)),firewall:s.firewall,rules:[...s.rules].sort((a,b)=>a.name.localeCompare(b.name))});
export function subnetOf(adapter:LanAdapter){
  if(!privateIPv4(adapter.address)||!Number.isInteger(adapter.prefix)||adapter.prefix<8||adapter.prefix>30)throw new Fault('LAN_INVALID_SUBNET');
  if(adapter.address.startsWith('192.168.')&&adapter.prefix<16||adapter.address.startsWith('172.')&&adapter.prefix<12)throw new Fault('LAN_INVALID_SUBNET');
  const n=adapter.address.split('.').reduce((n,v)=>(n*256+Number(v))>>>0,0),mask=(0xffffffff<<(32-adapter.prefix))>>>0,base=(n&mask)>>>0;
  return [base>>>24,(base>>>16)&255,(base>>>8)&255,base&255].join('.')+'/'+adapter.prefix;
}
function includesAddress(values:string[],address:string,subnet:string){return any(values)||values.includes(address)||values.includes(subnet);}
function portMatches(values:string[],port:number){return any(values)||values.some(v=>v===String(port)||/^\d+-\d+$/.test(v)&&port>=Number(v.split('-')[0])&&port<=Number(v.split('-')[1]));}
function relevant(rule:LanRule,adapter:LanAdapter,nodePath:string,ports:number[]){
  return rule.enabled!==false&&(any(rule.profiles)||rule.profiles.some(p=>same(p,'Private')))&&
    (same(rule.program,'Any')||same(rule.program,nodePath))&&
    (same(rule.protocol,'Any')||['TCP','6','256'].includes(rule.protocol))&&
    ports.some(p=>portMatches(rule.ports,p))&&(any(rule.interfaces)||rule.interfaces.includes(adapter.name));
}
// Only an entirely understood Allow counts. Unsupported restrictions never earn READY.
function covers(rule:LanRule,adapter:LanAdapter,nodePath:string,port:number){
  const subnet=subnetOf(adapter);
  return relevant(rule,adapter,nodePath,[port])&&rule.action==='Allow'&&rule.unconditional&&
    includesAddress(rule.local,adapter.address,subnet)&&
    (any(rule.remote)||rule.remote.includes(subnet)||rule.remote.includes('LocalSubnet'));
}
export class LanSetup {
  readonly nodePath:string;readonly ports:number[];readonly installation:string;
  private collect:()=>Promise<LanSnapshot>;
  private diagnostics=new AbortController();private elevate:(plan:LanPlan)=>Promise<Result>;private now:()=>number;
  private plans=new Map<string,{plan:LanPlan;fingerprint:string}>();private busy=false;
  private probe:()=>Promise<LanProbe[]>;private collecting?:Promise<LanSnapshot>;
  constructor(options:Options={}){
    this.nodePath=options.nodePath??process.execPath;
    this.ports=[...new Set(options.ports??[configuredPort('YAPLIX_PHONE_PORT',52604),configuredPort('YAPLIX_ARENA_PORT',52605)])];
    if(this.ports.some(p=>!Number.isInteger(p)||p<1||p>65535))throw new Fault('LAN_INVALID_PORT');
    this.installation=options.installation??hash(PROJECT_ROOT.toLowerCase()).slice(0,20);
    this.collect=()=>options.collect?options.collect(this.diagnostics.signal):collectWindows(options.platform??process.platform,this.diagnostics.signal);
    this.elevate=options.elevate??elevateWindows;this.now=options.now??Date.now;
    this.probe=options.probe??(async()=>[]);
  }
  // Cancel only read-only Inspect; an elevated mutation keeps its own outcome handling.
  closeDiagnostics(){this.diagnostics.abort();}
  private owned(rule:LanRule){return rule.group==='YAPLIX LAN '+this.installation&&rule.description==='YAPLIX managed LAN v1 '+this.installation&&new RegExp('^YAPLIX-LAN-'+this.installation+'-[a-f0-9]{20}$').test(rule.name);}
  private async snapshot(){
    if(this.collecting)return this.collecting;
    this.collecting=this.collect().catch(()=>({platform:process.platform,complete:false,error:'LAN_DIAGNOSTICS_UNAVAILABLE',adapters:[],rules:[],listeners:[]} satisfies LanSnapshot));
    try{return await this.collecting;}finally{this.collecting=undefined;}
  }
  private evaluate(snapshot:LanSnapshot,address?:string){
    const adapter=address?snapshot.adapters.find(a=>a.address===address):snapshot.adapters.length===1?snapshot.adapters[0]:undefined;
    let status:'READY'|'ACTION_REQUIRED'|'UNVERIFIED'='UNVERIFIED',reason='Диагностика Windows недоступна; доступ с телефона не проверен.',manageable=false;
    if(snapshot.platform!=='win32')reason='Windows helper недоступен на этой ОС. Используйте ручную настройку Firewall по документации.';
    else if(!snapshot.complete)reason='Не удалось полностью прочитать эффективные правила или политики Windows: '+(snapshot.error??'неизвестная конфигурация');
    else if(!adapter){status='ACTION_REQUIRED';reason='Выберите активный физический адаптер Wi-Fi/Ethernet с частным IPv4.';}
    else if(adapter.profile!=='Private'){status='ACTION_REQUIRED';reason='Профиль сети '+adapter.profile+'. Настройка запрещена: владелец должен самостоятельно проверить доверие к сети и выбрать Private.';}
    else if(!snapshot.firewall?.enabled){status='ACTION_REQUIRED';reason='Windows Firewall выключен или его состояние неизвестно. Автоматическая настройка запрещена.';}
    else if(!snapshot.firewall.allowInbound||!snapshot.firewall.allowLocal){status='ACTION_REQUIRED';reason='unable_to_manage: эффективная политика запрещает входящие исключения или локальные правила (GPO/MDM). Обратитесь к администратору.';}
    else {
      let subnet:string;try{subnet=subnetOf(adapter);}catch{return {status:'UNVERIFIED' as const,reason:'Неподдерживаемая маска сети; автоматическая настройка запрещена.',manageable:false,adapter};}
      const applicable=snapshot.rules.filter(r=>relevant(r,adapter,this.nodePath,this.ports));
      // A potential Block is conservative even when its remote/address restriction is unknown.
      if(applicable.some(r=>r.action==='Block')){status='ACTION_REQUIRED';reason='unable_to_manage: применимые Block: '+applicable.filter(r=>r.action==='Block').map(r=>r.name+' ('+r.source+')').join(', ')+'. Allow их не отменяет; чужие правила не изменяются.';}
      else {const missing=this.ports.filter(p=>!applicable.some(r=>covers(r,adapter,this.nodePath,p)));manageable=true;status=missing.length?'ACTION_REQUIRED':'READY';reason=status==='READY'?'Локальная конфигурация Windows разрешает выбранные порты. Доступ с физических устройств НЕ проверен.':'Нет подтверждённого Allow TCP '+missing.join(', ')+' для '+adapter.name+' / '+adapter.address+' и текущего Node.js.';}
      void subnet;
    }
    return {status,reason,manageable,adapter};
  }
  async diagnose(address?:string){const snapshot=await this.snapshot();return {...this.evaluate(snapshot,address),removable:snapshot.platform==='win32'&&snapshot.complete&&snapshot.rules.some(r=>this.owned(r)),nodePath:this.nodePath,ports:this.ports,adapters:snapshot.adapters,managedRules:snapshot.rules.filter(r=>this.owned(r)),listeners:snapshot.listeners.filter(l=>this.ports.includes(l.port)),probes:await this.probe().catch(()=>[{kind:'LAN',state:'SELF_GET_FAILED' as const}]),physicalDevice:'NOT_VERIFIED'};}
  async beforeQr(address?:string){const result=await this.diagnose(address);if(result.adapter&&result.adapter.profile!=='Private'&&result.adapters.length)throw new Fault('LAN_PRIVATE_REQUIRED',409);return result;}
  async plan(action:'configure'|'remove',address:string){
    if(this.busy)throw new Fault('LAN_BUSY',409);
    const snapshot=await this.snapshot(),state=this.evaluate(snapshot,address),adapter=state.adapter;
    if(action==='remove'){
      if(snapshot.platform!=='win32'||!snapshot.complete)throw new Fault('LAN_UNABLE_TO_MANAGE',409);
      const plan:LanPlan={id:randomUUID(),expiresAt:this.now()+300000,action,installation:this.installation,nodePath:this.nodePath,ports:this.ports,adapter:adapter??{id:'',name:'Не требуется для удаления',address:'',prefix:0,profile:'Не требуется для удаления'},subnet:'',add:[],remove:snapshot.rules.filter(r=>this.owned(r))};
      this.plans.clear();this.plans.set(plan.id,{plan:structuredClone(plan),fingerprint:fingerprint(snapshot)});return plan;
    }
    if(!state.manageable||!adapter)throw new Fault('LAN_UNABLE_TO_MANAGE',409);
    const subnet=subnetOf(adapter),group='YAPLIX LAN '+this.installation,description='YAPLIX managed LAN v1 '+this.installation;
    const needed=this.ports.filter(p=>!snapshot.rules.some(r=>!this.owned(r)&&covers(r,adapter,this.nodePath,p)));
    const spec={program:this.nodePath,ports:needed,subnet,adapter};
    const name='YAPLIX-LAN-'+this.installation+'-'+hash({...spec,adapter:{id:adapter.id,name:adapter.name}}).slice(0,20);
    const existing=snapshot.rules.find(r=>r.name===name);
    if(needed.length&&existing&&!this.owned(existing))throw new Fault('LAN_RULE_COLLISION',409);
    const owned=snapshot.rules.filter(r=>this.owned(r));
    // Never silently remove stale rules. Every removal is in this explicit review plan.
    const remove=owned.filter(r=>!needed.length||r.name!==name);
    const add=needed.length&&!existing?[{name,group,description,...spec}]:[];
    if(needed.length&&existing&&!needed.every(p=>covers(existing,adapter,this.nodePath,p)))throw new Fault('LAN_RULE_CHANGED',409);
    const plan:LanPlan={id:randomUUID(),expiresAt:this.now()+300000,action,installation:this.installation,nodePath:this.nodePath,ports:this.ports,adapter,subnet,add,remove};
    this.plans.clear();this.plans.set(plan.id,{plan:structuredClone(plan),fingerprint:fingerprint(snapshot)});return plan;
  }
  async apply(id:string,consent:boolean){
    if(consent!==true)throw new Fault('LAN_CONSENT_REQUIRED',403);
    if(this.busy)throw new Fault('LAN_BUSY',409);
    const stored=this.plans.get(id);this.plans.delete(id);
    if(!stored||stored.plan.expiresAt<this.now())throw new Fault('LAN_PLAN_EXPIRED',409);
    this.busy=true;
    try{
      const snapshot=await this.snapshot();if(fingerprint(snapshot)!==stored.fingerprint)throw new Fault('LAN_STATE_CHANGED',409);
      const result=stored.plan.add.length||stored.plan.remove.length?await this.elevate(stored.plan):{code:'unchanged'};
      return {...result,diagnostics:await this.diagnose(stored.plan.adapter.address)};
    }finally{this.busy=false;}
  }
}
function configuredPort(name:string,fallback:number){const value=process.env[name];if(value!==undefined&&!/^\d+$/.test(value))throw new Fault('LAN_INVALID_PORT');return value===undefined?fallback:Number(value);}
const powershell=()=>join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const helper=()=>resolve(PROJECT_ROOT,'scripts/windows-lan-setup.ps1');
function execute(args:string[],timeout:number,signal?:AbortSignal):Promise<string>{return new Promise((done,fail)=>{execFile(powershell(),['-NoProfile','-NonInteractive','-File',helper(),...args],{windowsHide:true,timeout,signal,maxBuffer:2_000_000},(error,stdout)=>error?fail(error):done(stdout.replace(/^\uFEFF/,'')));});}
async function collectWindows(platform:string,signal:AbortSignal):Promise<LanSnapshot>{
  if(platform!=='win32')return {platform,complete:false,adapters:[],rules:[],listeners:[]};
  return JSON.parse(await execute(['-Mode','Inspect'],30000,signal)) as LanSnapshot;
}
async function elevateWindows(plan:LanPlan):Promise<Result>{
  if(process.platform!=='win32')throw new Fault('LAN_WINDOWS_ONLY',409);
  const directory=managedPath('.local/lan-setup');await mkdir(directory,{recursive:true});
  const path=join(directory,plan.id+'.json'),result=path+'.result';
  await writeFile(path,JSON.stringify(plan),{flag:'wx',mode:0o600});
  try{await execute(['-Mode','Elevate','-PlanPath',path],180000);return JSON.parse((await readFile(result,'utf8')).replace(/^\uFEFF/,'')) as Result;}
  catch{return {code:'helper_outcome_unverified'};}
  finally{await Promise.allSettled([unlink(path),unlink(result)]);}
}
