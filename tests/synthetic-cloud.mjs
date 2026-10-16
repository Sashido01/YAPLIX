// Test process only: preserve canonical configured cloud routes, redirect their
// HTTP exchange to a controlled loopback fixture. Never loaded by production.
const upstream=process.env.YAPLIX_TEST_UPSTREAM;
if(!upstream||!/^http:\/\/127\.0\.0\.1:\d+$/.test(upstream))throw Error('SYNTHETIC_UPSTREAM_REQUIRED');
const original=globalThis.fetch;
globalThis.fetch=(input,init={})=>{
 const url=new URL(input instanceof Request?input.url:input);
 if(['https://ollama.com/v1/models','https://ollama.com/v1/chat/completions'].includes(url.href))return original(upstream+url.pathname,{...init,dispatcher:undefined});
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('SYNTHETIC_EXTERNAL_REQUEST_FORBIDDEN');
 return original(input,init);
};
