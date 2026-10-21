import {providerConfiguration} from '../src/provider-configuration.ts';
import {generationTimeouts} from '../src/generation-timeouts.ts';
try{
 console.log(JSON.stringify({source:'effective-process-environment',providers:providerConfiguration(),timeouts:generationTimeouts(process.env),externalRequests:0,note:'An inherited variable, including an empty value, takes precedence over .env. Empty or whitespace-only keys do not configure a route. No connection, quota or inference was verified.'},null,2));
}catch{console.error('INVALID_LLM_CONFIGURATION');process.exitCode=1;}
