import { appendFileSync, readFileSync } from 'node:fs';
import { secretScanRouteForEvent } from './ci-policy.mjs';

let event = {};
try { event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')); } catch { /* CLI route fails closed */ }
const route = secretScanRouteForEvent(process.env.GITHUB_EVENT_NAME, event?.inputs?.scan_release_tag ?? '');
console.log(`Secret scan route: ${route}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `route=${route}\n`);
