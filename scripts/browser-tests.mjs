import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = fileURLToPath(new URL('../.local/tmp', import.meta.url));
mkdirSync(temp, { recursive: true });
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url)), ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit', env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp, PLAYWRIGHT_BROWSERS_PATH: fileURLToPath(new URL('../.local/playwright', import.meta.url)) }
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
