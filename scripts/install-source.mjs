// Source checkout adapter: prepare the same verified Lite payload consumed by
// install-ui/install-engine. Packaged installers bypass this build step.
import {cpSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn,spawnSync,execFileSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const runtime=process.execPath;
const nodeHome=process.platform==='win32'?dirname(runtime):dirname(dirname(runtime));
const npmCli=join(nodeHome,'lib','node_modules','npm','bin','npm-cli.js');
const windowsNpmCli=join(nodeHome,'node_modules','npm','bin','npm-cli.js');
const npm=existsSync(npmCli)?npmCli:windowsNpmCli;
if(!existsSync(npm))throw Error('В изолированном Node отсутствует npm. Архив сохранён; повторите установку с проверенным архивом.');
const parent=resolve(process.env.YAPLIX_BOOTSTRAP_HOME??join(dirname(nodeHome),'source-builds'));
mkdirSync(parent,{recursive:true,mode:0o700});
const npmCache=join(parent,'npm-cache');mkdirSync(npmCache,{recursive:true,mode:0o700});
const temporary=mkdtempSync(join(parent,'.build-'));
const work=join(temporary,'source'),payload=join(temporary,'payload');
const status=message=>console.error('YAPLIX: '+message);
function copy(name,to=work,from=root){
 const source=join(from,name),target=join(to,name);
 if(!existsSync(source))throw Error('В исходниках отсутствует '+name);
 cpSync(source,target,{recursive:true,dereference:false,errorOnExist:true});
}
function run(args,cwd){
 return new Promise((done,fail)=>{
  const bin=process.platform==='win32'?nodeHome:join(nodeHome,'bin');
  const env={...process.env,PATH:bin+(process.platform==='win32'?';':':')+(process.env.PATH??''),LIVE_PROVIDER:'none',TELEGRAM_UPDATES:'off'};
  const child=spawn(runtime,args,{cwd,env,stdio:'inherit',windowsHide:true});
  child.once('error',fail);child.once('close',code=>code===0?done():fail(Error('Команда подготовки завершилась с кодом '+code)));
 });
}
function gather(path,prefix='',entries={}){
 for(const dirent of readdirSync(path,{withFileTypes:true})){
  const rel=prefix?prefix+'/'+dirent.name:dirent.name;
  if(dirent.isSymbolicLink())throw Error('Символическая ссылка в собранном пакете: '+rel);
  if(dirent.isDirectory())gather(join(path,dirent.name),rel,entries);
  else if(dirent.isFile())entries[rel]=createHash('sha256').update(readFileSync(join(path,dirent.name))).digest('hex');
  else throw Error('Неожиданный тип файла в пакете: '+rel);
 }
 return entries;
}
try{
 // Source installation must package a reviewed commit. Dirty tracked work is
 // left in place and never copied into an installed version.
 for(const args of [['diff','--quiet'],['diff','--cached','--quiet']]){
  const result=spawnSync('git',args,{cwd:root,windowsHide:true});
  if(result.status!==0)throw Error('В клоне есть несохранённые изменения отслеживаемых файлов. Установка остановлена; сохраните или отдельно зафиксируйте работу перед установкой.');
 }
 const chrome=process.platform==='linux'?'/opt/google/chrome/chrome':[process.env.LOCALAPPDATA,process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)']].filter(Boolean).map(p=>join(p,'Google/Chrome/Application/chrome.exe')).find(existsSync);
 if(!chrome||!existsSync(chrome))throw Error('Для сборки Lite из исходников нужен установленный Google Chrome. Он не менялся; используйте готовый Full-пакет YAPLIX с отдельным Chromium.');
 status('предварительный план: Lite с проверкой Google Chrome; npm-зависимости в изолированном каталоге; затем общий мастер проверит диск, SQLite, браузер и порты.');
 status(process.env.YAPLIX_INSTALL_OFFLINE==='1'?'офлайн-режим npm: только проверенный локальный кэш.':'npm использует текущий маршрут и переменные HTTP_PROXY/HTTPS_PROXY/NO_PROXY; при недоступности сети повторите установку.');
 mkdirSync(work);mkdirSync(payload);
 // Only clean Git-tracked source enters the build: no local .env, DB, private
 // key, ignored download cache or unreviewed tracked edit enters the version.
 const tracked=execFileSync('git',['ls-files','-z','--','src','scripts','assets','tests','packaging','package.json','package-lock.json','tsconfig.json','playwright.config.ts','INSTALL.md'],{cwd:root}).toString().split('\0').filter(Boolean);
 if(!tracked.includes('package-lock.json')||!tracked.includes('scripts/install-ui.mjs'))throw Error('Нужен полный Git клон YAPLIX с lockfile и установщиком.');
 for(const name of tracked){
  const source=join(root,name);if(!existsSync(source)||lstatSync(source).isSymbolicLink())throw Error('Некорректный отслеживаемый файл: '+name);
  mkdirSync(dirname(join(work,name)),{recursive:true});copy(name);
 }
 const ci=['ci','--no-audit','--no-fund','--cache',npmCache,'--fetch-retries=2','--fetch-timeout=120000',process.env.YAPLIX_INSTALL_OFFLINE==='1'?'--offline':'--prefer-offline'];
 status('проверяем lockfile и устанавливаем зависимости во временный каталог…');
 try{await run([npm,...ci],work);}catch(error){throw Error('npm ci не прошёл: '+error.message+'. Проверьте DNS/TLS/маршрут, HTTP_PROXY/HTTPS_PROXY/NO_PROXY или наполните кэш для YAPLIX_INSTALL_OFFLINE=1.');}
 status('собираем клиент и сервер…');
 await run([npm,'run','build'],work);
 status('готовим только production-зависимости…');
 try{await run([npm,...ci,'--omit=dev'],work);}catch(error){throw Error('npm ci production не прошёл: '+error.message+'. Проверьте сеть или локальный npm кэш.');}
 for(const name of ['src','assets','build/src','build/public','package.json','package-lock.json','INSTALL.md'])copy(name,payload,work);
 const runtimeScripts=['desktop.mjs','app-runtime.ts','install-engine.mjs','install-adapter.mjs','install-ui.mjs','install-probe.mjs','windows-lan-setup.ps1'];
 const runtimePackaging=['dialog.ps1','yaplix.svg','install-shortcuts.ps1','install.html','install-client.js'];
 for(const name of runtimeScripts){mkdirSync(join(payload,'scripts'),{recursive:true});copy('scripts/'+name,payload,work);}
 for(const name of runtimePackaging){mkdirSync(join(payload,'packaging'),{recursive:true});copy('packaging/'+name,payload,work);}
 // npm creates convenience symlinks in .bin. They are unnecessary at runtime.
 cpSync(join(work,'node_modules'),join(payload,'node_modules'),{
  recursive:true,dereference:false,filter:path=>relative(join(work,'node_modules'),path).split(sep)[0]!=='.bin'
 });
 mkdirSync(join(payload,'runtime'));
 cpSync(runtime,join(payload,'runtime',process.platform==='win32'?'node.exe':'node'));
 if(process.platform!=='win32'){
  const nodeLicense=join(nodeHome,'LICENSE');if(existsSync(nodeLicense))cpSync(nodeLicense,join(payload,'runtime','NODE-LICENSE.txt'));
 }
 writeFileSync(join(payload,'packaging','delivery.json'),JSON.stringify({browser:'system-chrome',os:process.platform==='win32'?'windows-10-11':'ubuntu-24.04',arch:'x64'}));
 writeFileSync(join(payload,'integrity.json'),JSON.stringify(gather(payload),null,2)+'\n');
 status('пакет готов; открываем общий мастер установки…');
 await run([join(payload,'scripts','install-ui.mjs'),...process.argv.slice(2)],payload);
}finally{
 // Only this invocation's staging directory is removed; installed versions and
 // data live outside it and are managed by the shared transaction adapter.
 rmSync(temporary,{recursive:true,force:true});
}
