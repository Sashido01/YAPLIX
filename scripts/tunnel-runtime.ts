import { fork, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { Fault } from '../src/contracts.ts';
import { checkPort, persistentLanKey } from '../src/network.ts';
import { managedPath, PROJECT_ROOT } from '../src/store.ts';
import { proof, RUNTIME_PROTOCOL, runtimeKey } from '../src/runtime-control.ts';
import { boundedText } from '../src/transport.ts';

export class TunnelFailure extends Fault {
  readonly stage: string;
  readonly detail: string;
  constructor(code: string, stage: string, detail: string) { super(code); this.stage = stage; this.detail = detail; }
}
export function redact(value: string, env: NodeJS.ProcessEnv = process.env) {
  let result = value;
  for (const [name, secret] of Object.entries(env)) if (/TOKEN|KEY|SECRET|PASSWORD|INIT.?DATA|AUTHORIZATION/i.test(name) && secret) result = result.split(secret).join('[REDACTED]');
  // Output may itself be JSON or an escaped JSON string inside a process report.
  result = result.replace(/((?:\\?"|')?(?:authorization|initData|access[_-]?key|api[_-]?key|token|secret|password)(?:\\?"|')?\s*[:=]\s*)(\\?"[^"\r\n]*(?:\\?")|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]');
  return result.replace(/\b\d{5,}:[A-Za-z0-9_-]{10,}\b/g, '[REDACTED]')
    .replace(/(https?:\/\/)[^/\s@]+@/gi, '$1[REDACTED]@')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/(authorization\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|[a-f0-9]{64}|[A-Za-z0-9_-]{32,128})\b/g, '[REDACTED]')
    .replace(/((?:authorization|initData|access[_-]?key|api[_-]?key|token|secret|password)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
    ;
}
export function journal(stage: string, detail: string, env = process.env) {
  const path = managedPath('.local/logs/tunnel.log');
  // One bounded, script-owned journal. Never persist raw upstream output.
  const old = existsSync(path) ? readFileSync(path, 'utf8').slice(-48_000) : '';
  const line = JSON.stringify({ time: new Date().toISOString(), stage, detail: redact(detail, env).slice(-12_000) }) + '\n';
  writeFileSync(path, old + line, { mode: 0o600 });
  return path;
}
export function explain(error: unknown, env = process.env) {
  const code = error instanceof Fault ? error.code : 'TUNNEL_FAILED';
  const stage = error instanceof TunnelFailure ? error.stage : 'configuration';
  const detail = redact(error instanceof TunnelFailure ? error.detail : code, env);
  const tips: Record<string, string> = {
    PORT_IN_USE: 'Порт занят другим или несовместимым сервером. Он не остановлен. Проверьте Get-NetTCPConnection -LocalPort PORT и Get-Process -Id PID; выберите другой PORT или самостоятельно перезапустите свой устаревший YAPLIX.',
    TUNNEL_CLOSED: 'cloudflared завершился. Проверьте stderr/exit code ниже, DNS, VPN/proxy и исходящие HTTPS 443 / QUIC UDP 7844 или HTTP/2 TCP 7844.',
    SPAWN_ERROR: 'Не удалось запустить cloudflared. Выполните npm run tunnel:install; проверьте карантин антивируса и права запуска.',
    PUBLIC_URL_TIMEOUT: 'cloudflared не выдал URL за отведённое время. Проверьте DNS/VPN и журнал. Можно повторить с --protocol http2 или --protocol quic.',
    PUBLIC_HEALTH_FAILED: 'URL получен, но внешний YAPLIX не подтверждён. Меню не настроено. Проверьте DNS/VPN/proxy и транспорт; повторите запуск.',
    TELEGRAM_SINGLE_OWNER_REQUIRED: 'Публичный режим требует ровно один положительный TELEGRAM_ALLOWED_USER_IDS и TELEGRAM_BOT_TOKEN: текущая библиотека общая, многопользовательская изоляция ещё не реализована.',
    TUNNEL_INSTALL_REQUIRED: 'Выполните npm run tunnel:install: нужен локальный cloudflared с проверенным SHA-256.',
    RUNTIME_BUILD_REQUIRED: 'Выполните npm run build.',
    TELEGRAM_NOT_CONFIGURED: 'Настройте TELEGRAM_BOT_TOKEN и TELEGRAM_ALLOWED_USER_IDS в локальном .env.',
    BACKEND_NOT_READY: 'Backend не подтвердил идентичность и HTTP readiness. Выполните npm run doctor; проверьте порт и перезапустите свой backend после обновления.',
    TUNNEL_ALREADY_ATTACHED: 'Backend уже занят другой сессией туннеля. Закройте её; после аварийного завершения перезапустите свой backend.',
  };
  const log = journal(stage, code + ': ' + detail, env);
  const summary = detail.length > 2400 ? detail.slice(0, 400) + '\n… полный вывод в журнале …\n' + detail.slice(-1800) : detail;
  return `${code}: ${tips[code] ?? 'Операция не выполнена. Проверьте конфигурацию и диагностический журнал.'}\nЭтап: ${stage}. Проверено: ${summary}\nЖурнал: ${log}`;
}
function observed(child: ChildProcess) {
  let output = '', spawnError = '';
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', bytes => { output = (output + bytes.toString()).slice(-20_000); });
  child.on('error', (e: NodeJS.ErrnoException) => { spawnError = e.code ?? 'SPAWN_ERROR'; });
  const closed = new Promise<{code: number | null; signal: string | null}>(done => child.once('close', (code, signal) => done({ code, signal })));
  return { child, closed, tail: () => output, error: () => spawnError };
}
type Observed = ReturnType<typeof observed>;
async function stopChild(p?: Observed, graceful = false) {
  if (!p) return;
  if (p.child.exitCode === null && p.child.signalCode === null) {
    if (graceful && p.child.connected) p.child.send('shutdown', () => {}); else p.child.kill();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>(done => { timer = setTimeout(() => done('timeout'), 6000); });
    try {
      if (await Promise.race([p.closed, timeout]) === 'timeout') {
        p.child.kill('SIGKILL');
        const forced = new Promise<'timeout'>(done => { timer = setTimeout(() => done('timeout'), 2000); });
        if (await Promise.race([p.closed, forced]) === 'timeout') throw new TunnelFailure('CHILD_STOP_TIMEOUT', 'cleanup', 'Own child did not confirm close; public lease remains fail-closed.');
      }
    } finally { clearTimeout(timer); }
  } else await p.closed;
}
export type TunnelOptions = {
  port: number; binary: string; connectorEnv: NodeJS.ProcessEnv; env?: NodeJS.ProcessEnv;
  protocol?: 'auto' | 'http2' | 'quic'; menu?: boolean; check?: boolean; signal: AbortSignal;
  startupMs?: number; publicMs?: number;
  connector?: (protocol: string, port: number) => ChildProcess;
  publicProbe?: (origin: string, instance: string, signal: AbortSignal) => Promise<void>;
  menuUpdate?: (origin: string, signal?: AbortSignal) => Promise<void>;
  menuClear?: (origin: string) => Promise<void>;
  announce?: (message: string) => void;
};
export async function publicHealth(origin: string, instance: string, signal: AbortSignal) {
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin)) throw new Fault('PUBLIC_URL_INVALID');
  const response = await fetch(origin + '/healthz', { redirect: 'error', signal });
  if (!response.ok) { await response.body?.cancel(); throw new Fault('PUBLIC_HEALTH_HTTP_' + response.status); }
  const health = JSON.parse(await boundedText(response, 2048));
  if (!response.ok || health.app !== 'YAPLIX' || health.protocol !== RUNTIME_PROTOCOL || health.instance !== instance || health.ready !== true) throw new Fault('PUBLIC_HEALTH_FAILED');
}
export async function runTunnel(options: TunnelOptions) {
  const env = options.env ?? process.env, base = 'http://127.0.0.1:' + options.port;
  const announce = options.announce ?? console.log;
  const startupMs = options.startupMs ?? 60_000, publicMs = options.publicMs ?? 45_000;
  const secrets = { ...env }, controlKey = runtimeKey(); secrets.RUNTIME_CONTROL_KEY = controlKey;
  let backend: Observed | undefined, connector: Observed | undefined, lease = '', origin = '', heartbeat: NodeJS.Timeout | undefined;
  let stage = 'backend', heartbeatBusy = false;
  let onCancel = () => {};
  const cancelled = new Promise<'cancelled'>(done => { onCancel = () => done('cancelled'); if (options.signal.aborted) onCancel(); else options.signal.addEventListener('abort', onCancel, { once: true }); });
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(base + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(2000) });
    const body = JSON.parse(await boundedText(response, 4096));
    if (!response.ok) throw new Fault(body.error ?? 'BACKEND_NOT_READY'); return body;
  };
  const identity = async () => {
    const nonce = randomBytes(32).toString('hex');
    const data = await request('/api/runtime/tunnel?nonce=' + nonce);
    if (data.app !== 'YAPLIX' || data.protocol !== RUNTIME_PROTOCOL || typeof data.instance !== 'string' || data.proof !== proof(controlKey, nonce, data.instance)) throw new Fault('BACKEND_NOT_READY');
    const health = await request('/healthz');
    if (health.instance !== data.instance || health.ready !== true) throw new Fault('BACKEND_NOT_READY');
    return data.instance as string;
  };
  const update = (action: string, extra: object = {}) => request('/api/runtime/tunnel', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Yaplix-Control': controlKey }, body: JSON.stringify({ action, ...(lease ? { lease } : {}), ...extra }) });
  try {
    let free = false;
    try { await checkPort({ mode: 'local', host: '127.0.0.1', port: options.port }); free = true; }
    catch (e) { if (!(e instanceof Fault) || e.code !== 'PORT_IN_USE') throw e; }
    let instance = '';
    if (!free) {
      try { instance = await identity(); } catch { throw new TunnelFailure('PORT_IN_USE', stage, `127.0.0.1:${options.port}; HTTP readiness/HMAC экземпляра из этого клона не подтверждены; чужой процесс сохранён.`); }
      announce('Подтверждён совместимый YAPLIX на порту ' + options.port + '; используется существующий backend.');
    } else if (!options.check) {
      backend = observed(fork('src/server.ts', [], { cwd: PROJECT_ROOT, env: { ...env, PORT: String(options.port), YAPLIX_MODE: 'local', YAPLIX_HOST: '127.0.0.1', PUBLIC_URL: '', YAPLIX_ACCESS_KEY: '' }, stdio: ['ignore','pipe','pipe','ipc'], windowsHide: true }));
      const deadline = Date.now() + Math.min(startupMs, 15_000);
      while (Date.now() < deadline && !options.signal.aborted) {
        try { instance = await identity(); break; } catch {}
        if (backend.child.exitCode !== null || backend.child.signalCode !== null || backend.error()) break;
        await delay(100);
      }
      if (!instance) throw new TunnelFailure('BACKEND_NOT_READY', stage, backend.tail() + '; spawn=' + backend.error() + '; exit=' + backend.child.exitCode);
      announce('Backend запущен; идентичность и HTTP readiness подтверждены.');
    }
    if (options.check) { announce('Конфигурация/порт проверены; туннель и menu button не созданы.'); return; }
    options.signal.throwIfAborted();
    const key = persistentLanKey(env); secrets.YAPLIX_ACCESS_KEY = key;
    lease = (await update('prepare', { key })).lease; secrets.RUNTIME_LEASE_KEY = lease;
    stage = 'connector';
    const protocol = options.protocol ?? 'auto';
    connector = observed(options.connector ? options.connector(protocol, options.port) : spawn(options.binary, ['tunnel','--no-autoupdate','--protocol',protocol,'--url',base], { cwd: PROJECT_ROOT, env: options.connectorEnv, stdio: ['ignore','pipe','pipe'], windowsHide: true }));
    const deadline = Date.now() + startupMs;
    while (Date.now() < deadline && !options.signal.aborted) {
      const match = connector.tail().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);
      if (match) { origin = match[0]; break; }
      if (connector.error() || connector.child.exitCode !== null || connector.child.signalCode !== null) {
        const status = await connector.closed;
        throw new TunnelFailure(connector.error() ? 'SPAWN_ERROR' : 'TUNNEL_CLOSED', stage, JSON.stringify({ ...status, spawn: connector.error(), output: connector.tail() }));
      }
      await delay(50);
    }
    options.signal.throwIfAborted();
    if (!origin) throw new TunnelFailure('PUBLIC_URL_TIMEOUT', stage, `timeout=${startupMs}ms; protocol=${protocol}; ` + connector.tail());
    await update('activate', { origin });
    const heartbeatAbort = new AbortController();
    heartbeat = setInterval(() => {
      if (heartbeatBusy) return; heartbeatBusy = true;
      update('heartbeat').catch(() => heartbeatAbort.abort()).finally(() => { heartbeatBusy = false; });
    }, 5000);
    const signal = AbortSignal.any([options.signal, heartbeatAbort.signal]);
    stage = 'public-health';
    let verified = false, last = '';
    const publicDeadline = Date.now() + publicMs;
    while (Date.now() < publicDeadline && !signal.aborted) {
      if (connector.child.exitCode !== null || connector.child.signalCode !== null) {
        const status = await connector.closed; throw new TunnelFailure('TUNNEL_CLOSED', stage, JSON.stringify({ ...status, output: connector.tail() }));
      }
      try { await (options.publicProbe ?? publicHealth)(origin, instance, AbortSignal.any([signal, AbortSignal.timeout(Math.min(5000, Math.max(1, publicDeadline - Date.now())))])); verified = true; break; }
      catch (e) {
        const cause = e instanceof Error ? e.cause as NodeJS.ErrnoException | undefined : undefined;
        last = e instanceof Error ? e.message + (cause?.code ? '; network=' + cause.code : '') : 'HTTP probe failed';
      }
      await delay(200, undefined, { signal }).catch(() => {});
    }
    signal.throwIfAborted();
    if (!verified) throw new TunnelFailure('PUBLIC_HEALTH_FAILED', stage, `timeout=${publicMs}ms; ${last}; ` + connector.tail());
    if (connector.child.exitCode !== null || connector.child.signalCode !== null) { const status = await connector.closed; throw new TunnelFailure('TUNNEL_CLOSED', stage, JSON.stringify({ ...status, output: connector.tail() })); }
    stage = 'telegram-menu';
    if (options.menu) {
      try { await options.menuUpdate?.(origin, signal); announce('Telegram menu button подтверждён для ' + origin + '/telegram'); }
      catch (e) { announce(explain(new TunnelFailure('TELEGRAM_MENU_FAILED', stage, e instanceof Fault ? e.code : 'Telegram API/network отказал; backend и туннель продолжают работать, menu не подтверждено.'), secrets)); }
    }
    signal.throwIfAborted();
    if (connector.child.exitCode !== null || connector.child.signalCode !== null) { const status = await connector.closed; throw new TunnelFailure('TUNNEL_CLOSED', stage, JSON.stringify({ ...status, output: connector.tail() })); }
    writeFileSync(managedPath('.local/tunnel-url.txt'), origin + '/telegram\n', { mode: 0o600 });
    announce('Публичный HTTP health подтверждён: ' + origin + '/telegram\nОткройте меню своего бота на Android. Ctrl+C завершает туннель; существующий backend сохранится.');
    journal('connected', 'external health verified; protocol=' + protocol, secrets);
    stage = 'running';
    const ended = await Promise.race([connector.closed.then(status => ({ reason: 'connector', status })), ...(backend ? [backend.closed.then(status => ({ reason: 'backend', status }))] : []), cancelled, new Promise<'heartbeat'>(done => signal.addEventListener('abort', () => done('heartbeat'), { once: true }))]);
    if (typeof ended === 'object') throw new TunnelFailure(ended.reason === 'connector' ? 'TUNNEL_CLOSED' : 'BACKEND_NOT_READY', stage, JSON.stringify({ ...ended.status, output: ended.reason === 'connector' ? connector.tail() : backend?.tail() }));
    if (ended === 'heartbeat' && !options.signal.aborted) throw new TunnelFailure('BACKEND_NOT_READY', stage, 'Lease heartbeat потерян; публичный доступ закрывается.');
  } catch (e) {
    if (!options.signal.aborted) { journal(stage, e instanceof TunnelFailure ? e.code + ': ' + e.detail : e instanceof Fault ? e.code : 'Operation failed', secrets); throw e; }
  } finally {
    options.signal.removeEventListener('abort', onCancel);
    if (heartbeat) clearInterval(heartbeat);
    let connectorClosed = true;
    try { await stopChild(connector); } catch (e) { connectorClosed = false; announce(explain(e, secrets)); }
    if (origin && options.menu) {
      try { await options.menuClear?.(origin); }
      catch { announce('Telegram: сброс menu button не подтверждён. Туннель отключён; старый URL не работает. Проверьте npm run telegram:check.'); journal('menu-clear', 'Telegram reset not confirmed', secrets); }
    }
    if (lease && connectorClosed) { try { await update('release'); } catch { announce('Backend не подтвердил release; публичный режим остаётся закрытым по lease. Перезапустите свой backend.'); } }
    await stopChild(backend, true);
    if (origin) {
      const path = managedPath('.local/tunnel-url.txt');
      if (existsSync(path) && readFileSync(path, 'utf8') === origin + '/telegram\n') unlinkSync(path);
    }
    announce('Туннель отключён. ' + (backend ? 'Собственный backend завершён.' : 'Существующий backend не остановлен.'));
    journal('disconnected', 'Owned children closed; attached backend preserved', secrets);
  }
}
