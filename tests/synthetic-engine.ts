import {GenerationEngine} from '../src/live.ts';
import {ProviderFailure} from '../src/transport.ts';
import {html} from './helpers.ts';

export function syntheticEngine(){
  return new GenerationEngine([{route:'primary',provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready',complete:async messages=>{
    if(messages.some(message=>message.content.includes('YAPLIX_TEST_PROVIDER_FAILURE')))throw new ProviderFailure('LLM_NOT_CONFIGURED','gemma4:31b');
    return{code:html,model:'gemma4:31b'};
  }}],{
    check:async()=>({rendering:{contract:'canvas-webgl-strict-v2' as const,contexts:['2d' as const],profiles:[320,390,844]},profiles:[320,390],offline:true as const,errors:0 as const,scope:'startup-input-pause' as const})
  });
}
