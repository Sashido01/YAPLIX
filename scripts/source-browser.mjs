// Source Full delivery for Ubuntu. Browser bytes are pinned independently of
// the local Playwright cache and are verified before entering a payload.
import {cpSync,createReadStream,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {join,resolve,relative,sep} from 'node:path';
import {spawnSync} from 'node:child_process';

const version='156.0.8078.4'; // playwright-core 1.64.0, revision 1248
const browserParts=[
 {directory:'chromium-1248',archive:'chrome-linux64.zip',url:`https://cdn.playwright.dev/builds/cft/${version}/linux64/chrome-linux64.zip`,sha256:'43fd31766c7533a02dda2ded5ad50c2f861cd5400be7509c0abad71129f79d79',tree:'0d42499b624580d53678ce86313662b300085144c29f762079d4e7c33c4bb6b3',files:301},
 {directory:'chromium_headless_shell-1248',archive:'chrome-headless-shell-linux64.zip',url:`https://cdn.playwright.dev/builds/cft/${version}/linux64/chrome-headless-shell-linux64.zip`,sha256:'c3e50596aef52c58f8fda3c6b3411c33d34c88b177b3ed1c2243359fd3b8ba20',tree:'85191670ce98465bf98a7eb1eb1b2427fca4767c9f2e778dd17c4d93a3b298c9',files:287}
];
const markers=new Set(['INSTALLATION_COMPLETE','DEPENDENCIES_VALIDATED']);
const digestFile=async path=>{const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest();};
function filesUnder(root,path=root,result=[]){
 if(lstatSync(path).isSymbolicLink())throw Error('Символическая ссылка в кэше браузера.');
 for(const entry of readdirSync(path,{withFileTypes:true})){
  const file=join(path,entry.name);
  if(entry.isDirectory())filesUnder(root,file,result);
  else if(entry.isFile()){
   const name=relative(root,file).split(sep).join('/');
   if(!markers.has(name))result.push({name,file});
  }else throw Error('Неожиданный тип файла в кэше браузера.');
 }
 return result;
}
export async function verifiedBrowserTree(root,part){
 if(!existsSync(root)||!statSync(root).isDirectory())return false;
 try{
  const files=filesUnder(root).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  if(files.length!==part.files)return false;
  const tree=createHash('sha256');
  for(const {name,file} of files)tree.update(name).update('\0').update(await digestFile(file));
  return tree.digest('hex')===part.tree;
 }catch{return false;}
}
function browserCaches(repo){
 return [...new Set([process.env.PLAYWRIGHT_BROWSERS_PATH,join(homedir(),'.cache/ms-playwright'),join(repo,'.local/playwright')].filter(Boolean).map(path=>resolve(path)))];
}
async function validCache(path){return Promise.all(browserParts.map(part=>verifiedBrowserTree(join(path,part.directory),part))).then(rows=>rows.every(Boolean));}
export async function inspectFullSource(repo,archiveHome){
 let rejectedCache=false;
 for(const path of browserCaches(repo)){
  if(!browserParts.some(part=>existsSync(join(path,part.directory))))continue;
  if(await validCache(path))return {kind:'browser-cache',path};
  rejectedCache=true;
 }
 const archives=await Promise.all(browserParts.map(async part=>{const path=join(archiveHome,part.archive);return existsSync(path)?(await digestFile(path)).toString('hex')===part.sha256:null;}));
 if(archives.every(Boolean))return {kind:'archive-cache',path:archiveHome};
 return {kind:'download',rejectedCache:rejectedCache||archives.includes(false)};
}
function download(part,archive,cert){
 const args=['--fail','--location','--silent','--show-error','--proto','=https','--proto-redir','=https','--connect-timeout','15','--max-time','900','--retry','2','--retry-delay','1'];
 if(cert)args.push('--cacert',cert);
 args.push('--output',archive,part.url);
 const result=spawnSync('curl',args,{encoding:'utf8',timeout:930000,windowsHide:true});
 if(result.error||result.status!==0)throw Error('Не удалось загрузить проверенный Chromium через текущий маршрут/proxy. Проверьте DNS, TLS и HTTP_PROXY/HTTPS_PROXY/NO_PROXY либо используйте готовый Full-пакет. '+(result.stderr??'').trim());
}
function extract(archive,destination){
 mkdirSync(destination,{recursive:true,mode:0o700});
 let result=spawnSync('unzip',['-q',archive,'-d',destination],{encoding:'utf8',timeout:180000,windowsHide:true});
 if(result.error?.code==='ENOENT')result=spawnSync('python3',['-m','zipfile','-e',archive,destination],{encoding:'utf8',timeout:180000,windowsHide:true});
 if(result.error||result.status!==0)throw Error('Не удалось распаковать проверенный Chromium; нужны стандартные unzip или Python3. Используйте готовый Full-пакет.');
}
export async function prepareFullBrowser(repo,archiveHome,staging,payload,status=()=>{}){
 if(process.platform!=='linux')throw Error('Автоматический Full из исходников пока поддержан только на Ubuntu; для Windows используйте готовый Full-пакет.');
 const browsers=join(payload,'browsers');mkdirSync(browsers,{recursive:true});
 for(const path of browserCaches(repo)){
  if(!existsSync(path))continue;
  const candidate=mkdtempSync(join(staging,'.browser-cache-'));
  try{
   for(const part of browserParts)cpSync(join(path,part.directory),join(candidate,part.directory),{recursive:true,dereference:false});
   if(await validCache(candidate)){
    for(const part of browserParts)renameSync(join(candidate,part.directory),join(browsers,part.directory));
    status('использован локальный Chromium/headless-shell с проверенными SHA256 всех файлов.');
    return 'browser-cache';
   }
   status('локальный browser cache повреждён или не соответствует закреплённой версии; он сохранён.');
  }catch{status('локальный browser cache неполон; он сохранён.');}
  finally{rmSync(candidate,{recursive:true,force:true});}
 }
 mkdirSync(archiveHome,{recursive:true,mode:0o700});
 if(process.env.YAPLIX_INSTALL_OFFLINE==='1'&&!(await inspectFullSource(repo,archiveHome)).kind.includes('archive'))throw Error('Нет проверенного Chromium в офлайн-кэше. Подключите сеть или используйте готовый Full-пакет YAPLIX.');
 const cert=process.env.NODE_EXTRA_CA_CERTS||undefined;
 for(const part of browserParts){
  let archive=join(archiveHome,part.archive);
  const cached=existsSync(archive)&&(await digestFile(archive)).toString('hex')===part.sha256;
  if(!cached){
   if(process.env.YAPLIX_INSTALL_OFFLINE==='1')throw Error('Офлайн-кэш Chromium повреждён. Используйте готовый Full-пакет или повторите загрузку по сети.');
   const fresh=join(staging,'.download-'+part.archive);
   status('загружаем '+part.archive+' из закреплённого источника через текущий proxy/маршрут…');
   download(part,fresh,cert);
   if((await digestFile(fresh)).toString('hex')!==part.sha256)throw Error('SHA256 архива Chromium не совпал; архив не распакован. Используйте готовый Full-пакет.');
   if(!existsSync(archive))renameSync(fresh,archive);else archive=fresh; // preserve a corrupt prior cache
  }
  const extracted=mkdtempSync(join(staging,'.browser-archive-'));
  try{
   extract(archive,extracted);
   const source=join(extracted,part.archive.slice(0,-4));
   if(!(await verifiedBrowserTree(source,part)))throw Error('SHA256 файлов Chromium не совпал; используйте готовый Full-пакет.');
   renameSync(source,join(browsers,part.directory));
  }finally{rmSync(extracted,{recursive:true,force:true});}
 }
 return 'archive';
}

// Same package-owned library provenance check as package-installer.py. No apt,
// sudo, system-library replacement or user-owned setuid helper is involved.
export function copyInstalledLibraries(payload){
 const chromium=join(payload,'browsers/chromium-1248/chrome-linux64/chrome');
 const shell=join(payload,'browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell');
 const libraries=new Map();
 for(const binary of [chromium,shell]){
  const result=spawnSync('/usr/bin/ldd',[binary],{env:{...process.env,LC_ALL:'C',LD_LIBRARY_PATH:''},encoding:'utf8',timeout:10000});
  if(result.error||result.status!==0||/not found/.test(result.stdout))throw Error('На этом Ubuntu не хватает библиотеки для Chromium; используйте готовый Full-пакет.');
  for(const line of result.stdout.split('\n')){
   const match=line.match(/^\s*(\S+)\s+=>\s+(\/\S+)\s+\(/);
   if(match)libraries.set(match[1],match[2]);
  }
 }
 const provenance=[];mkdirSync(join(payload,'lib'),{recursive:true});
 for(const [name,path] of [...libraries].sort((a,b)=>a[0].localeCompare(b[0]))){
  const source=realpathSync(path);
  if(!source.startsWith('/lib/')&&!source.startsWith('/usr/lib/'))throw Error('Непроверенная системная библиотека Chromium: '+name);
  const variants=[source,source.replace('/usr/lib/','/lib/'),path];
  let owner=null;
  for(const variant of variants){const ownership=spawnSync('dpkg-query',['-S',variant],{encoding:'utf8',timeout:5000});if(ownership.status===0){owner=ownership.stdout.split(': ',1)[0];break;}}
  if(!owner)throw Error('Нет подтверждённого Ubuntu-пакета для '+name+'; используйте готовый Full-пакет.');
  if(owner.split(':')[0]==='libc6')continue; // never bundle glibc or its loader
  const sums=join('/var/lib/dpkg/info',owner+'.md5sums');
  const fallback=join('/var/lib/dpkg/info',owner.split(':')[0]+'.md5sums');
  const manifest=existsSync(sums)?sums:fallback;
  if(!existsSync(manifest))throw Error('Нет контрольной суммы пакета для '+name+'.');
  const checks=new Map(readFileSync(manifest,'utf8').split('\n').filter(Boolean).map(row=>{const [hash,...name]=row.trim().split(/\s+/);return [name.join(' '),hash];}));
  const expected=variants.map(variant=>checks.get(variant.slice(1))).find(Boolean);
  if(!expected||createHash('md5').update(readFileSync(source)).digest('hex')!==expected)throw Error('Библиотека '+name+' не совпадает с установленным Ubuntu-пакетом.');
  const target=join(payload,'lib',name);cpSync(source,target);
  provenance.push({library:name,package:owner,sha256:createHash('sha256').update(readFileSync(target)).digest('hex'),verified:'installed Ubuntu package checksum'});
  const license=join('/usr/share/doc',owner.split(':')[0],'copyright');
  if(existsSync(license)){const licenses=join(payload,'licenses',owner.replace(':','_'));mkdirSync(licenses,{recursive:true});cpSync(license,join(licenses,'copyright'));}
 }
 return provenance;
}
