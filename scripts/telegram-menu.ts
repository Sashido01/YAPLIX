import { Fault } from '../src/contracts.ts';
import { boundedText } from '../src/transport.ts';
export function telegramMenu(env: NodeJS.ProcessEnv = process.env, request = fetch) {
  const token = env.TELEGRAM_BOT_TOKEN;
  async function call(method: string, body?: object, signal?: AbortSignal) {
    if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new Fault('TELEGRAM_TOKEN_REQUIRED');
    const response = await request('https://api.telegram.org/bot' + token + '/' + method, { method: body ? 'POST' : 'GET', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000), ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const data = JSON.parse(await boundedText(response, 16_000));
    if (!response.ok || data.ok !== true) throw new Fault('TELEGRAM_API_REJECTED');
    return data.result;
  }
  return {
    async update(origin: string, signal?: AbortSignal) {
      const me = await call('getMe', undefined, signal);
      if (me.is_bot !== true || me.username?.toLowerCase() !== (env.TELEGRAM_BOT_USERNAME ?? 'YaplixBot').replace(/^@/, '').toLowerCase()) throw new Fault('TELEGRAM_BOT_MISMATCH');
      const url = origin + '/telegram';
      await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Открыть YAPLIX', web_app: { url } } }, signal);
      if ((await call('getChatMenuButton', undefined, signal)).web_app?.url !== url) throw new Fault('TELEGRAM_MENU_NOT_CONFIRMED');
    },
    async clear(origin: string) {
      // Do not clobber a menu changed by the owner or another session.
      if ((await call('getChatMenuButton')).web_app?.url === origin + '/telegram') {
        await call('setChatMenuButton', { menu_button: { type: 'commands' } });
        if ((await call('getChatMenuButton')).web_app?.url === origin + '/telegram') throw new Fault('TELEGRAM_MENU_NOT_CLEARED');
      }
    },
  };
}
