import {Fault} from './contracts.ts';

export const LIVE_RESPONSE_TIMEOUT_MS=30*60_000;
export const LIVE_JOB_TIMEOUT_MS=35*60_000;
export function generationTimeouts(env:NodeJS.ProcessEnv={}){
 // LLM_TIMEOUT_MS is a legacy alias, not an additional engine timer.
 const jobMs=Number(env.LLM_MAX_DURATION_MS??env.LLM_TIMEOUT_MS??LIVE_JOB_TIMEOUT_MS);
 const responseMs=Number(env.LLM_REQUEST_TIMEOUT_MS??Math.min(jobMs,LIVE_RESPONSE_TIMEOUT_MS));
 if(!Number.isSafeInteger(responseMs)||responseMs<1000||responseMs>LIVE_RESPONSE_TIMEOUT_MS||
    !Number.isSafeInteger(jobMs)||jobMs<1000||jobMs>LIVE_JOB_TIMEOUT_MS||responseMs>jobMs)
  throw new Fault('INVALID_LLM_CONFIGURATION');
 return Object.freeze({responseMs,jobMs});
}
