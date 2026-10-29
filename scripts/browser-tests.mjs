import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configureBrowserTempRoot } from '../src/browser-temp.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = configureBrowserTempRoot();
const args = process.argv[2] === 'performance' ? [fileURLToPath(new URL('./performance-smoke.mjs', import.meta.url)), ...process.argv.slice(3)] : [fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url)), ...process.argv.slice(2)];
const result = spawnSync(process.execPath, args, {
  cwd: root, stdio: 'inherit', env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp, PLAYWRIGHT_BROWSERS_PATH: fileURLToPath(new URL('../.local/playwright', import.meta.url)) }
});
if (result.error) console.error(result.error.message);
process.exitCode = result.error ? 1 : result.status ?? 1;
