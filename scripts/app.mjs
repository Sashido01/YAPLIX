import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { OperationTrace, operationId } from './operation-trace.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
process.env.YAPLIX_OPERATION_ID = operationId();
const operation = new OperationTrace({ dataRoot: process.env.YAPLIX_DATA_HOME ?? resolve(root,'.local'), operationId: process.env.YAPLIX_OPERATION_ID });
const bootstrap = operation.begin('bootstrap','bootstrap.started',{nodeVersion:process.version,platform:process.platform,architecture:process.arch});
const isWindows = process.platform === 'win32';
const boot = await import('./node-bootstrap.mjs');
let rt;
if (isWindows) {
  if (!boot.satisfiesRequirement(process.versions.node)) {
    console.error('Нужен Node.js ' + boot.requirementText() + '. Установите его и снова откройте YAPLIX.cmd.');
    process.exit(1);
  }
  rt = { version: process.versions.node, dir: null, nodeBin: process.execPath, npmCli: process.env.npm_execpath || null };
} else {
  try {
    rt = await boot.ensureNodeRuntime();
  } catch (error) {
    bootstrap('FAIL','NODE_RUNTIME_UNAVAILABLE'); operation.record('bootstrap','bootstrap.failed','FAIL',{errorCode:'NODE_RUNTIME_UNAVAILABLE'});
    console.error('Не удалось подготовить Node.js ' + boot.requirementText() + ': ' + (error && error.message ? error.message : error));
    console.error('Проверьте подключение к https://nodejs.org и повторите: npm run app');
    process.exit(1);
  }
  if (!process.env.YAPLIX_RUNTIME_REEXEC && rt.dir && process.execPath !== rt.nodeBin) {
    console.log('Использую ' + boot.describeRuntime(rt) + '.');
    const code = await new Promise(function (done) {
      const args = [resolve(root, 'scripts/app.mjs')].concat(process.argv.slice(2));
      const child = spawn(rt.nodeBin, args, { cwd: root, stdio: 'inherit', env: Object.assign({}, process.env, { YAPLIX_RUNTIME_REEXEC: '1' }) });
      child.on('error', function () { done(1); });
      child.on('exit', function (c) { done(c === null ? 1 : c); });
    });
    process.exit(code);
  }
}
if (!boot.satisfiesRequirement(process.versions.node)) {
  bootstrap('FAIL','NODE_VERSION_UNSUPPORTED'); operation.record('bootstrap','bootstrap.failed','FAIL',{errorCode:'NODE_VERSION_UNSUPPORTED'});
  if (isWindows) {
    console.error('Нужен Node.js ' + boot.requirementText() + '. Установите его и снова откройте YAPLIX.cmd.');
  } else {
    console.error('Нужен Node.js ' + boot.requirementText() + '. Запустите ./yaplix.sh или npm run app: подходящий Node.js настроится локально в .local/yaplix-runtime.');
  }
  process.exit(1);
}
operation.record('bootstrap','bootstrap.node_ready','PASS',{details:{nodeVersion:process.version,platform:process.platform,architecture:process.arch}});
let npmCli = rt.npmCli;
if ((!npmCli || !existsSync(npmCli)) && process.env.npm_execpath && existsSync(process.env.npm_execpath)) {
  npmCli = process.env.npm_execpath;
}
if (!npmCli || !existsSync(npmCli)) {
  if (isWindows) {
    console.error('Запустите npm run app либо YAPLIX.cmd: нужен npm из установленного Node.js.');
  } else {
    console.error('Не найден npm для ' + boot.describeRuntime(rt) + '. Повторите запуск через ./yaplix.sh или npm run app.');
  }
  process.exit(1);
}
const run = function (args) {
  return new Promise(function (done, fail) {
    const child = spawn(process.execPath, [npmCli].concat(args), { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', fail);
    child.once('exit', function (code) { if (code === 0) done(); else fail(Error('APP_SETUP_FAILED')); });
  });
};
try {
  if (!existsSync(resolve(root, 'node_modules/hono/package.json'))) {
    console.log('Первый запуск: установка зависимостей проекта...');
    await run(['ci']);
  }
  operation.record('bootstrap','bootstrap.dependencies_ready','PASS');
  await run(['run', 'build']);
  operation.record('bootstrap','bootstrap.build_ready','PASS');
  const appRt = await import('./app-runtime.ts');
  const controller = new AbortController();
  process.once('SIGINT', function () { controller.abort(); });
  process.once('SIGTERM', function () { controller.abort(); });
  const explicitPort = process.env.PORT !== undefined && process.env.PORT !== '';
  const basePort = Number(explicitPort ? process.env.PORT : 3000);
  if (!Number.isSafeInteger(basePort) || basePort < 1 || basePort > 65535) {
    console.error('ОШИБКА: неверный PORT="' + process.env.PORT + '". Укажите число от 1 до 65535.');
    process.exit(1);
  }
  await appRt.runApp({ port: basePort, explicitPort: explicitPort, env: process.env, signal: controller.signal, open: process.argv.indexOf('--no-open') === -1, announce: message => { console.log(message); if (message.startsWith('YAPLIX готов:')) { bootstrap('PASS'); operation.record('bootstrap','bootstrap.app_started','PASS'); } } });
} catch (error) {
  bootstrap('FAIL','APP_SETUP_FAILED'); operation.record('bootstrap','bootstrap.failed','FAIL',{errorCode:'APP_SETUP_FAILED'});
  console.error(error.message);
  process.exitCode = 1;
}
