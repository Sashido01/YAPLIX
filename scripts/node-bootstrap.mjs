// Автономный bootstrap Node.js для запуска YAPLIX на Linux.
// Работает на любом Node.js 18+ (включая системный 22.x). Только встроенные модули.
// Рантайм ставится в .local/yaplix-runtime (исключён из Git). Система не затрагивается.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, renameSync, writeFileSync } from 'node:fs';
import { arch as osArch, platform as osPlatform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RUNTIME_DIR = join(PROJECT_ROOT, '.local', 'yaplix-runtime');
export const PINNED_NODE_VERSION = '24.22.1';
const DIST_BASE = 'https://nodejs.org/dist';
const INDEX_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 300000;
export function parseVersion(text) {
  const src = text === null || text === undefined ? '' : String(text);
  const m = src.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}
export function requiredRange() {
  try {
    const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
    const nodeEngines = pkg.engines && pkg.engines.node ? String(pkg.engines.node) : '';
    const min = nodeEngines.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
    if (min) return { major: Number(min[1]), minor: Number(min[2]), patch: Number(min[3]) };
  } catch (e) { /* ниже запасные значения */ }
  return { major: 24, minor: 18, patch: 0 };
}
export function requirementText() {
  const r = requiredRange();
  return r.major + '.' + r.minor + '+ (ветка ' + r.major + '.x)';
}
export function satisfiesRequirement(versionText) {
  const v = parseVersion(versionText);
  const r = requiredRange();
  if (!v || v.major !== r.major) return false;
  if (v.minor < r.minor) return false;
  if (v.minor === r.minor && v.patch < r.patch) return false;
  return true;
}
function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}
function linuxArch() {
  const a = osArch();
  if (a === 'x64') return 'x64';
  if (a === 'arm64') return 'arm64';
  return null;
}
function runCapture(bin, args) {
  return new Promise(function (done) {
    let out = '';
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', function (c) { out += String(c); });
    child.on('error', function () { done(null); });
    child.on('exit', function (code) { done(code === 0 ? out.trim() : null); });
  });
}
function runtimeRecord(dirName, version) {
  const dir = join(RUNTIME_DIR, dirName);
  const nodeBin = join(dir, 'bin', 'node');
  const npmCli = join(dir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return { version: version, dir: dir, nodeBin: nodeBin, npmCli: existsSync(npmCli) ? npmCli : null };
}
export function describeRuntime(rt) {
  if (rt.dir) return 'локальный Node.js v' + rt.version + ' (' + rt.dir + ')';
  return 'системный Node.js v' + rt.version;
}
export async function findLocalRuntime() {
  if (!existsSync(RUNTIME_DIR)) return null;
  let entries = [];
  try {
    entries = readdirSync(RUNTIME_DIR, { withFileTypes: true })
      .filter(function (d) { return d.isDirectory() && d.name.charAt(0) !== '.'; })
      .map(function (d) { return d.name; })
      .sort().reverse();
  } catch (e) { return null; }
  try {
    const current = readFileSync(join(RUNTIME_DIR, 'current'), 'utf8').trim();
    entries = [current].concat(entries.filter(function (e) { return e !== current; }));
  } catch (e) { /* маркера нет: перебираем каталоги */ }
  for (const name of entries) {
    const bin = join(RUNTIME_DIR, name, 'bin', 'node');
    if (!existsSync(bin)) continue;
    const v = await runCapture(bin, ['--version']);
    if (v && satisfiesRequirement(v)) return runtimeRecord(name, v.replace(/^v/, ''));
  }
  return null;
}
async function latestSuitableVersion() {
  try {
    const res = await fetch(DIST_BASE + '/index.json', { signal: AbortSignal.timeout(INDEX_TIMEOUT_MS) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const list = await res.json();
    let best = null;
    for (const item of list) {
      const v = parseVersion(item && item.version);
      if (!v || !satisfiesRequirement(item.version)) continue;
      if (!best || compareVersions(v, best) > 0) best = v;
    }
    if (best) return best.major + '.' + best.minor + '.' + best.patch;
  } catch (e) { /* ниже запасная версия */ }
  return PINNED_NODE_VERSION;
}
async function downloadToFile(url, dest) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (error) {
    const code = error && error.cause && error.cause.code ? error.cause.code : (error && error.name ? error.name : 'сеть');
    throw new Error('нет доступа к ' + url + ' (' + code + ')');
  }
  if (!res.ok || !res.body) throw new Error('сервер вернул HTTP ' + res.status + ' для ' + url);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}
function sha256File(path) {
  return new Promise(function (done, fail) {
    const hash = createHash('sha256');
    const rs = createReadStream(path);
    rs.on('data', function (c) { hash.update(c); });
    rs.on('error', fail);
    rs.on('end', function () { done(hash.digest('hex')); });
  });
}
function runTar(args, cwd) {
  return new Promise(function (done, fail) {
    const child = spawn('tar', args, { cwd: cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', function (c) { err += String(c); });
    child.on('error', function () { fail(new Error('не найдена системная утилита tar')); });
    child.on('exit', function (code) {
      if (code === 0) done();
      else fail(new Error('распаковка tar завершилась с кодом ' + code + ': ' + err.trim()));
    });
  });
}
export async function installLocalRuntime() {
  if (osPlatform() !== 'linux') throw new Error('автоустановка Node.js поддерживается только на Linux');
  const archName = linuxArch();
  if (!archName) throw new Error('архитектура ' + osArch() + ' не покрывается официальными сборками Node.js');
  const version = await latestSuitableVersion();
  if (!satisfiesRequirement(version)) throw new Error('версия ' + version + ' не подходит: нужен Node.js ' + requirementText());
  const name = 'node-v' + version + '-linux-' + archName;
  const tarball = name + '.tar.xz';
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const tmpTar = join(RUNTIME_DIR, '.download-' + process.pid + '.tar.xz');
  const tmpSums = join(RUNTIME_DIR, '.download-' + process.pid + '.SHASUMS');
  const tmpDir = join(RUNTIME_DIR, '.extract-' + process.pid);
  const finalDir = join(RUNTIME_DIR, name);
  const cleanup = function () {
    rmSync(tmpTar, { force: true });
    rmSync(tmpSums, { force: true });
    rmSync(tmpDir, { recursive: true, force: true });
  };
  try {
    console.log('Ставлю локальный Node.js ' + version + ' только для YAPLIX, систему не трогаю...');
    await downloadToFile(DIST_BASE + '/v' + version + '/' + tarball, tmpTar);
    await downloadToFile(DIST_BASE + '/v' + version + '/SHASUMS256.txt', tmpSums);
    const sums = readFileSync(tmpSums, 'utf8');
    const marker = '  ' + tarball;
    const line = sums.split('\n').find(function (l) { return l.trim().endsWith(marker); });
    if (!line) throw new Error('в официальном файле SHASUMS256.txt нет записи для этого архива');
    const expected = line.split(/\s+/)[0].toLowerCase();
    const actual = (await sha256File(tmpTar)).toLowerCase();
    if (expected !== actual) throw new Error('контрольная сумма SHA-256 не совпала: архив повреждён или подменён');
    console.log('Контрольная сумма SHA-256 совпала. Распаковываю...');
    mkdirSync(tmpDir, { recursive: true });
    await runTar(['-xf', tmpTar, '-C', tmpDir], RUNTIME_DIR);
    if (!existsSync(join(tmpDir, name, 'bin', 'node'))) throw new Error('в архиве нет ожидаемого bin/node');
    rmSync(finalDir, { recursive: true, force: true });
    renameSync(join(tmpDir, name), finalDir);
    writeFileSync(join(RUNTIME_DIR, 'current'), name + '\n');
    const v = await runCapture(join(finalDir, 'bin', 'node'), ['--version']);
    if (!v || !satisfiesRequirement(v)) throw new Error('установленный Node.js не прошёл проверку версии');
    console.log('Готово: локальный Node.js ' + v + '.');
    cleanup();
    return runtimeRecord(name, v.replace(/^v/, ''));
  } catch (error) {
    cleanup();
    const reason = error && error.message ? error.message : String(error);
    throw new Error('Не удалось скачать Node.js ' + version + ': ' + reason + '. Проверьте подключение к https://nodejs.org и повторите запуск. Частичная установка удалена.');
  }
}
export async function ensureNodeRuntime() {
  if (satisfiesRequirement(process.versions.node)) {
    const cli = process.env.npm_execpath && existsSync(process.env.npm_execpath) ? process.env.npm_execpath : null;
    return { version: process.versions.node, dir: null, nodeBin: process.execPath, npmCli: cli };
  }
  const local = await findLocalRuntime();
  if (local) return local;
  return installLocalRuntime();
}
const invokedAsScript = typeof process.argv[1] === 'string' && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  ensureNodeRuntime().then(function (rt) {
    console.log('Runtime ready: ' + describeRuntime(rt) + '.');
  }).catch(function (error) {
    console.error('ОШИБКА: ' + (error && error.message ? error.message : error));
    process.exitCode = 1;
  });
}
