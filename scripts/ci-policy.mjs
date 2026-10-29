import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const full = reason => ({ windowsFull: true, browsers: true, reason });
const documentation = path => /^(?:[^/]+\.md|docs\/.+\.md)$/.test(path);
const unitTest = path => /^tests\/[^/]+\.test\.ts$/.test(path)
  || /^scripts\/tests\/test_[^/]+\.py$/.test(path);

export function secretScanRouteForEvent(eventName, releaseTag = '') {
  if (eventName === 'release' || (eventName === 'workflow_dispatch' && releaseTag)) return 'cli';
  if (['pull_request', 'merge_group', 'workflow_dispatch'].includes(eventName)) return 'action';
  return 'cli';
}

// An allowlist of inexpensive changes; new/unknown executable paths need FULL.
export function classifyPaths(paths) {
  if (!Array.isArray(paths) || !paths.length
      || paths.some(path => typeof path !== 'string' || !path || /[\r\n\\]/.test(path))) {
    return full('unknown-diff');
  }
  if (paths.every(documentation)) return { windowsFull: false, browsers: false, reason: 'docs-only' };
  if (paths.every(path => documentation(path) || unitTest(path))) {
    return { windowsFull: true, browsers: false, reason: 'unit-tests' };
  }
  return full('runtime-or-unknown');
}

export function planForEvent(eventName, event, head, git = args =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })) {
  // Manual pre-release requests, releases and merge queues always run FULL.
  if (eventName !== 'pull_request') return full('explicit-or-non-pr');
  const base = event?.pull_request?.base?.sha;
  if (![base, head].every(sha => typeof sha === 'string' && /^[0-9a-f]{40,64}$/.test(sha))) {
    return full('unknown-base');
  }
  try {
    // Compare the event base with the checked-out PR merge commit, without a
    // paginated API or GitHub's 300-file path-filter limit. Include deletions and
    // both sides of renames so moving runtime code into docs cannot select FAST.
    const diff = git(['diff', '--no-renames', '--name-only', '-z', base, head, '--']);
    if (!diff.endsWith('\0')) return full('unknown-diff');
    return classifyPaths(diff.slice(0, -1).split('\0'));
  } catch {
    return full('diff-unavailable');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let event;
  try { event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')); } catch { /* FULL */ }
  const plan = planForEvent(process.env.GITHUB_EVENT_NAME, event, process.env.GITHUB_SHA);
  console.log(JSON.stringify(plan));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    `windows-full=${plan.windowsFull}\nbrowsers=${plan.browsers}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `CI scope: ${plan.reason}; Windows full units: ${plan.windowsFull}; browsers/performance: ${plan.browsers}.\n`);
}
