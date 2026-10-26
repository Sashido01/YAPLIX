import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
const [major,minor]=process.versions.node.split('.').map(Number);
if(major!==24||minor<18){
  const help=process.platform==='win32'
    ? 'Windows: установите Node.js 24.18+ и снова запустите YAPLIX.cmd.'
    : 'Ubuntu/Linux: установите Node.js 24.18+ (например, через nvm), затем в каталоге YAPLIX выполните nvm install && nvm use, npm ci и npm run app. Инструкция: README.md.';
  console.error(`YAPLIX: обнаружен Node.js ${process.version}; нужен Node.js 24.18+ (24.x).\n${help}`);
  process.exit(1);
}
const npm=process.env.npm_execpath;
if(!npm||!existsSync(npm)){console.error(process.platform==='win32'?'Запустите npm run app либо YAPLIX.cmd: нужен npm из установленного Node.js.':'Запустите npm run app: нужен npm из установленного Node.js.');process.exit(1);}
const run=args=>new Promise((done,fail)=>{const child=spawn(process.execPath,[npm,...args],{cwd:root,stdio:'inherit',windowsHide:true});child.once('error',fail);child.once('exit',code=>code===0?done():fail(Error('APP_SETUP_FAILED')));});
try{
  if(!existsSync(resolve(root,'node_modules/hono/package.json'))){if(existsSync(resolve(root,'node_modules')))throw Error('Зависимости неполны. Проверьте содержимое node_modules и выполните npm ci вручную. Файлы сохранены.');console.log('Первый запуск: установка зависимостей проекта…');await run(['ci']);}
  await run(['run','build']);
  const{runApp}=await import('./app-runtime.ts');const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
  await runApp({port:Number(process.env.PORT??3000),env:process.env,signal:controller.signal,open:!process.argv.includes('--no-open')});
}catch(error){console.error(error.message);process.exitCode=1;}
