import type {LanPlan} from './lan-setup.ts';
type Diagnostics={status:string;reason:string;manageable:boolean;removable?:boolean;nodePath:string;ports:number[];adapters:{id:string;name:string;address:string;prefix:number;profile:string}[];managedRules:{name:string}[];listeners:{address:string;port:number;pid:number}[];probes?:{kind:string;state:string;address?:string;port?:number}[]};
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
async function request(path:string,body?:object){
  const response=await fetch('/api/lan-setup'+path,{cache:'no-store',signal:AbortSignal.timeout(body&&path==='/apply'?300000:45000),...(body?{method:'POST',headers:{'Content-Type':'application/json','X-Yaplix-LAN-Setup':'owner'},body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok)throw new Error(data.error??'LAN_UNVERIFIED');return data;
}
export function mountLanSetup(parent:HTMLElement){
  const panel=element('details'),summary=element('summary','Частная сеть · QR и Arena'),status=element('p','UNVERIFIED · Проверяем локальную конфигурацию…');
  panel.dataset.lanSetup='true';panel.className='panel';status.role='status';
  const info=element('p','Для игры на компьютере настройка не нужна. Firewall изменяется только после просмотра плана, вашего согласия и UAC.'),label=element('label','Сеть участников '),network=element('select');network.setAttribute('aria-label','Сеть для настройки LAN');label.append(network);
  const details=element('pre');details.style.whiteSpace='pre-wrap';details.style.overflowWrap='anywhere';
  const actions=element('div');actions.className='actions';
  const refresh=element('button','Проверить без изменений'),configure=element('button','Настроить доступ в частной сети'),remove=element('button','Удалить правила YAPLIX этой копии');
  for(const button of [refresh,configure,remove])button.type='button';actions.append(refresh,configure,remove);
  const review=element('section'),planText=element('pre'),consentLabel=element('label'),consent=element('input'),apply=element('button','Применить с UAC'),cancel=element('button','Отказаться');
  review.hidden=true;planText.style.whiteSpace='pre-wrap';planText.style.overflowWrap='anywhere';consent.type='checkbox';consent.style.width='auto';consentLabel.append(consent,document.createTextNode(' Разрешаю только перечисленные изменения Windows Firewall.'));apply.type=cancel.type='button';apply.disabled=true;
  review.append(element('h3','Точный план изменений'),planText,consentLabel,apply,cancel);
  const help=element('p','После запуска QR откройте ссылку на телефоне в той же доверенной LAN. Bind и GET с этого компьютера не доказывают доступ с телефона. Если связи нет: проверьте гостевую Wi-Fi, client isolation, доступ VPN к LAN, мобильные данные и политику роутера. Защиту отключать не нужно.');
  panel.append(summary,status,info,label,details,actions,review,help);parent.prepend(panel);
  let current:Diagnostics|undefined,plan:LanPlan|undefined,busy=false;
  function discard(){plan=undefined;review.hidden=true;consent.checked=false;apply.disabled=true;}
  function controls(){refresh.disabled=busy;network.disabled=busy;configure.disabled=busy||!current?.manageable;remove.disabled=busy||!(current?.removable??current?.manageable)||!current?.managedRules.length;apply.disabled=busy||!plan||!consent.checked;cancel.disabled=busy;}
  async function run(work:()=>Promise<void>){if(busy)return;busy=true;controls();try{await work();}catch(error){discard();status.textContent='UNVERIFIED · '+(error as Error).message+'; одиночная игра доступна. Повторите диагностику.';}finally{busy=false;controls();}}
  async function load(address=network.value){
    current=await request(address?'?address='+encodeURIComponent(address):'') as Diagnostics;
    const old=address;network.replaceChildren();if(current.adapters.length!==1)network.add(new Option('Выберите сеть',''));
    for(const a of current.adapters)network.add(new Option(`${a.name} · ${a.address}/${a.prefix} · ${a.profile}`,a.address));
    if(current.adapters.some(a=>a.address===old))network.value=old;
    status.textContent=current.status+' · '+current.reason;summary.textContent='Частная сеть · '+current.status;
    details.textContent=`Node.js: ${current.nodePath}\nВходящие TCP: ${current.ports.join(', ')}\nListener/bind: ${current.listeners.length?current.listeners.map(l=>l.address+':'+l.port+' (PID '+l.pid+')').join(', '):'не запущен; появится после запуска QR'}\nHTTP GET с компьютера: ${current.probes?.map(p=>p.kind+': '+p.state).join(', ')||'NOT_VERIFIED'}\nУправляемые правила этой копии: ${current.managedRules.map(r=>r.name).join(', ')||'нет'}`;
  }
  async function prepare(action:'configure'|'remove'){
    discard();plan=await request('/plan',{action,address:network.value}) as LanPlan;
    planText.textContent=`Действие: ${action==='remove'?'удаление':'настройка'}\nАдаптер: ${plan.adapter.name} (${plan.adapter.id})\nТекущий IPv4: ${plan.adapter.address||"не требуется"}/${plan.adapter.prefix}, профиль ${plan.adapter.profile}\nПрограмма: ${plan.nodePath}\nДобавить: ${plan.add.length} правило(а)\n${plan.add.map(r=>`${r.name}\nInbound Allow TCP ${r.ports.join(', ')} · Private\nLocalAddress и RemoteAddress: ${r.subnet}\nInterfaceAlias: ${r.adapter.name}\nProgram: ${r.program}`).join('\n')}\nУдалить ТОЛЬКО следующие собственные правила:\n${plan.remove.map(r=>r.name+' · '+r.program+' · TCP '+r.ports.join(', ')+' · '+r.local.join(', ')+' · '+r.interfaces.join(', ')).join('\n')||'нет'}\nЧужие и ручные правила сохраняются. План действует 5 минут. Смена IP внутри этой подсети допускается правилом; другая подсеть требует нового согласия.`;
    if(!plan.add.length&&!plan.remove.length){planText.textContent+='\nИзменения не нужны; UAC не требуется.';plan=undefined;}
    review.hidden=false;panel.open=true;
  }
  refresh.addEventListener('click',()=>void run(async()=>{discard();await load();}));
  network.addEventListener('change',()=>void run(async()=>{discard();await load();}));
  configure.addEventListener('click',()=>void run(()=>prepare('configure')));remove.addEventListener('click',()=>void run(()=>prepare('remove')));
  consent.addEventListener('change',controls);cancel.addEventListener('click',discard);
  apply.addEventListener('click',()=>void run(async()=>{
    if(!plan||!consent.checked)return;status.textContent='Ожидаем UAC и повторную проверку…';
    const result=await request('/apply',{id:plan.id,consent:true});discard();await load();
    status.textContent=`${result.code} · ${status.textContent}`;
    if(result.code==='failed_rollback_incomplete')status.textContent+=' Часть отката не подтверждена. Просмотрите собственные правила; не расширяйте разрешения.';
  }));
  window.addEventListener('yaplix-lan-address',event=>void run(async()=>{discard();await load((event as CustomEvent<string>).detail);}));
  void run(()=>load());return {refresh:(address?:string)=>run(async()=>{discard();await load(address);})};
}
export function selectLanAddress(address:string){window.dispatchEvent(new CustomEvent('yaplix-lan-address',{detail:address}));}
