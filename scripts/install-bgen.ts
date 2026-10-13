import { existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { BGEN_ROOT, BGEN_REVISION, checkBGen } from '../src/live.ts';
import { PROJECT_ROOT, managedPath } from '../src/store.ts';

try {
  managedPath('.local/BGen', false);
  if (!existsSync(BGEN_ROOT)) {
    mkdirSync(resolve(PROJECT_ROOT, '.local'), { recursive: true });
    execFileSync('git', ['clone', '--no-checkout', 'https://github.com/SKZHPRVT/BGen.git', BGEN_ROOT], { stdio: 'inherit' });
    execFileSync('git', ['checkout', '--detach', BGEN_REVISION], { cwd: BGEN_ROOT, stdio: 'inherit' });
  }
  checkBGen();
  console.log(`BGen prompt library ready: ${BGEN_REVISION} (MIT, SKZHPRVT)`);
} catch { console.error('BGEN_INSTALL_FAILED: existing checkout is preserved; inspect the documented install steps'); process.exitCode = 1; }
