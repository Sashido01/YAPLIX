import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyPaths, planForEvent } from './ci-policy.mjs';

const base = 'a'.repeat(40), head = 'b'.repeat(40);
const event = { pull_request: { base: { sha: base } } };
test('docs only retains FAST; unit test changes require Windows full units', () => {
  assert.deepEqual(classifyPaths(['README.md', 'docs/setup.md']),
    { windowsFull: false, browsers: false, reason: 'docs-only' });
  assert.deepEqual(classifyPaths(['README.md', 'tests/engine.test.ts', 'scripts/tests/test_check_repo.py']),
    { windowsFull: true, browsers: false, reason: 'unit-tests' });
});
test('runtime, Canvas, generation, backend, browsers, dependencies and CI fail closed to FULL', () => {
  for (const path of ['src/ui.ts', 'src/runtime.ts', 'src/jobs.ts', 'src/live.ts', 'src/api.ts',
    'src/access.ts', 'src/store.ts', 'tests/jobs.spec.ts', 'tests/helpers.ts', 'tests/browser-server.ts',
    'scripts/build.mjs', 'scripts/ci-policy.mjs', 'scripts/ci-policy.test.mjs',
    'playwright.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json',
    '.github/workflows/repository-checks.yml', 'unknown/new-file', 'docs/executable.js']) {
    assert.equal(classifyPaths(['README.md', path]).browsers, true, path);
    assert.equal(classifyPaths([path]).windowsFull, true, path);
  }
});
test('empty, malformed, mixed and large diffs cannot silently omit risky files', () => {
  for (const paths of [[], null, [''], [null], ['docs/x.md\nsrc/api.ts'], ['docs\\x.md'],
    [...Array(1000).fill('docs/guide.md'), 'src/generation.ts']]) {
    assert.equal(classifyPaths(paths).browsers, true);
  }
});
test('manual, release, merge_group and unsupported events cannot request FAST', () => {
  for (const name of ['workflow_dispatch', 'release', 'merge_group', 'push', undefined]) {
    assert.equal(planForEvent(name, event, head, () => { throw Error('must not diff'); }).browsers, true);
  }
});
test('PR compares exact base and checked-out merge SHA; API labels cannot disable FULL', () => {
  assert.equal(planForEvent('pull_request', event, head, args => {
    assert.deepEqual(args, ['diff', '--no-renames', '--name-only', '-z', base, head, '--']);
    return 'docs/guide.md\0';
  }).browsers, false);
  assert.equal(planForEvent('pull_request', { ...event, inputs: { full: false } }, head,
    () => 'src/api.ts\0').browsers, true);
});
test('unavailable base, git failure and incomplete diff cannot bypass FULL', () => {
  for (const value of [undefined, {}, { pull_request: { base: { sha: '--help' } } }]) {
    assert.equal(planForEvent('pull_request', value, head).browsers, true);
  }
  assert.equal(planForEvent('pull_request', event, 'invalid').browsers, true);
  for (const git of [() => { throw Error('missing commit'); }, () => '', () => 'README.md']) {
    assert.equal(planForEvent('pull_request', event, head, git).browsers, true);
  }
});
test('actual Git diff selects docs-only FAST but includes deleted and renamed runtime paths', t => {
  mkdirSync('.local/tmp', { recursive: true });
  const dir = mkdtempSync('.local/tmp/ci-policy-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'core.autocrlf', 'false']);
  mkdirSync(`${dir}/src`); mkdirSync(`${dir}/docs`);
  writeFileSync(`${dir}/src/game.md`, 'runtime fixture\n');
  git(['add', 'src/game.md']);
  git(['-c', 'user.name=CI Test', '-c', 'user.email=ci@example.test', 'commit', '-qm', 'base']);
  const sha = git(['rev-parse', 'HEAD']).trim();
  writeFileSync(`${dir}/docs/guide.md`, 'documentation fixture\n');
  git(['add', 'docs/guide.md']);
  git(['-c', 'user.name=CI Test', '-c', 'user.email=ci@example.test', 'commit', '-qm', 'docs']);
  assert.equal(planForEvent('pull_request', { pull_request: { base: { sha } } },
    git(['rev-parse', 'HEAD']).trim(), git).browsers, false);
  git(['mv', 'src/game.md', 'docs/game.md']);
  git(['-c', 'user.name=CI Test', '-c', 'user.email=ci@example.test', 'commit', '-qm', 'move']);
  const renamed = git(['rev-parse', 'HEAD']).trim();
  assert.equal(planForEvent('pull_request', { pull_request: { base: { sha } } }, renamed, git).browsers, true);
  git(['rm', 'docs/game.md']);
  git(['-c', 'user.name=CI Test', '-c', 'user.email=ci@example.test', 'commit', '-qm', 'delete']);
  assert.equal(planForEvent('pull_request', { pull_request: { base: { sha } } },
    git(['rev-parse', 'HEAD']).trim(), git).browsers, true);
});
test('CLI emits explicit FULL outputs when event data is unavailable', t => {
  mkdirSync('.local/tmp', { recursive: true });
  const dir = mkdtempSync('.local/tmp/ci-output-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const output = `${dir}/output`, summary = `${dir}/summary`;
  const stdout = execFileSync(process.execPath, [fileURLToPath(new URL('./ci-policy.mjs', import.meta.url))], {
    encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: `${dir}/missing`, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
  });
  assert.equal(JSON.parse(stdout).browsers, true);
  assert.equal(readFileSync(output, 'utf8'), 'windows-full=true\nbrowsers=true\n');
  assert.match(readFileSync(summary, 'utf8'), /unknown-base/);
});
