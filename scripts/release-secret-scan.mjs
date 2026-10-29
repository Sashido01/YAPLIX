import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tag = process.env.RELEASE_SCAN_TAG ?? '';
const scanner = process.env.GITLEAKS_BIN ?? '';

function git(args, cwd = process.cwd()) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout.trim();
}

function scan(args, cwd = process.cwd()) {
  const result = spawnSync(scanner, args, { cwd, stdio: 'inherit' });
  if (result.error) throw new Error('Gitleaks CLI could not start');
  if (result.status !== 0) throw new Error(`Gitleaks scan failed (${result.status ?? 'signal'})`);
}

let temporaryRoot;
let releaseTree;
let worktreeAdded = false;
try {
  if (!tag || tag.length > 200 || /[\r\n\0]/.test(tag)) throw new Error('release tag is missing or malformed');
  if (!scanner) throw new Error('GITLEAKS_BIN is required');
  git(['check-ref-format', `refs/tags/${tag}`]);
  const commit = git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
  const head = git(['rev-parse', 'HEAD']);
  if (process.env.GITHUB_EVENT_NAME === 'release' && commit !== head) {
    throw new Error('release event checkout does not match the exact release tag');
  }
  const version = spawnSync(scanner, ['version'], { encoding: 'utf8' });
  if (version.error || version.status !== 0 || version.stdout.trim() !== '8.24.3') {
    throw new Error('Gitleaks CLI version is not the pinned 8.24.3');
  }

  console.log(`Scanning release tag ${tag} at ${commit} (tree ${git(['rev-parse', `${commit}^{tree}`])})`);
  scan(['detect', '--source', '.', `--log-opts=${commit}`, '--redact', '--no-banner', '--exit-code', '1']);
  temporaryRoot = mkdtempSync(join(tmpdir(), 'yaplix-release-scan-'));
  releaseTree = join(temporaryRoot, 'tagged-source');
  git(['worktree', 'add', '--detach', releaseTree, commit]);
  worktreeAdded = true;
  scan(['dir', '--redact', '--no-banner', '--exit-code', '1', '.'], releaseTree);
  console.log('Release history and exact tagged source tree passed Gitleaks.');
} catch (error) {
  console.error(`RELEASE_SECRET_SCAN_FAILED: ${error.message}`);
  process.exitCode = 2;
} finally {
  if (worktreeAdded) {
    try { git(['worktree', 'remove', '--force', releaseTree]); } catch { process.exitCode = 2; }
  }
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
}
