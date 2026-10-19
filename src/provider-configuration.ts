// No requests, file reads, credential values, or inference readiness claims.
export function providerConfiguration(env:NodeJS.ProcessEnv=process.env){
 return ([['ollama-cloud','OLLAMA_CLOUD_API_KEY'],['openrouter','CLOUD_API_KEY']] as const).map(([mode,key])=>{
  const configuration=env[key]===undefined?'absent':env[key]!.trim()?'present':'empty';
  return{mode,key,configuration,configured:configuration==='present',state:configuration==='present'?'needs_verification':'not_configured'};
 });
}
