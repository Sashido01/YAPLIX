import { serve } from '@hono/node-server';
import { createApp } from '../src/api.ts';
import { Store } from '../src/store.ts';
import { artifact, html, spec } from './helpers.ts';
const store = new Store(':memory:');
const app = createApp(store);
app.get('/fixture', c => {
  c.header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'");
  return c.html(html);
});
app.get('/host', c => {
  const v = store.save(spec, artifact), session = store.session(v.versionId);
  c.header('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self'; connect-src 'self'");
  return c.html(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="game" style="height:100vh"></div><script type="module">
    import {mountGame} from '/runtime/runtime.js';
    const session=${JSON.stringify(session)};
    window.testSession=session; window.received=[]; window.forwardErrors=[];
    let queue=Promise.resolve();
    window.unmount=mountGame(document.querySelector('#game'),${JSON.stringify(html).replaceAll('<', '\\u003c')},session,event=>{
      window.received.push(event);
      queue=queue.then(async()=>{const response=await fetch('/api/sessions/'+session.sessionId+'/events',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.token},body:JSON.stringify(event)});if(!response.ok)window.forwardErrors.push(await response.text());});
    });
  </script></body></html>`);
});
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 3210 });
process.on('SIGTERM', () => server.close(() => store.close()));
