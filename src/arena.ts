import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { activePhoneAddresses, portError } from './network.ts';
import { Fault, object, uuid } from './contracts.ts';
import type { Store } from './store.ts';
import { ArenaStore, ARENA_TTL } from './arena-store.ts';
import { arenaDeclared } from './arena-contract.ts';
import { staticAssets } from './static.ts';
import { arenaQr } from './qr.ts';
import { boundedText } from './transport.ts';
import { RateLimit } from './rate-limit.ts';

const hash = (s: string) => createHash('sha256').update(s).digest();
const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export function arenaPort(env: NodeJS.ProcessEnv = process.env) {
  if (env.YAPLIX_ARENA_PORT === undefined) return 52605;
  if (!/^[0-9]{1,5}$/.test(env.YAPLIX_ARENA_PORT) || Number(env.YAPLIX_ARENA_PORT)<1 || Number(env.YAPLIX_ARENA_PORT)>65535) throw new Fault('ARENA_PORT_INVALID');
  return Number(env.YAPLIX_ARENA_PORT);
}
export async function arenaJson(request: Request, max=4096) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new Fault('JSON_REQUIRED',415);
  try { return JSON.parse(await boundedText(new Response(request.body,{headers:request.headers}),max)); }
  catch (e) { if (e instanceof Fault) throw e; throw new Fault('INVALID_JSON'); }
}

/** Separate allowlisted LAN listener. Never mounts the owner app or a directory. */
export class ArenaConnection {
  readonly records: ArenaStore;
  private store: Store;
  private addresses: typeof activePhoneAddresses;
  private port: number;
  private server?: Server;
  private timer?: ReturnType<typeof setTimeout>;
  private active?: { roomId: string; origin: string; url: string; invite: Buffer };
  private busy=false;
  private stopped=false;
  constructor(store: Store, addresses=activePhoneAddresses, port=arenaPort()) { this.store=store; this.records=new ArenaStore(store); this.addresses=addresses; this.port=port; }
  networks() { return this.addresses(); }
  status() {
    const a=this.active;
    return a ? { enabled:this.records.board(a.roomId).open, url:a.url, ...this.records.board(a.roomId) } : { enabled:false };
  }
  qr() { const s=this.status(); if (!s.enabled || !this.active) throw new Fault('ARENA_CLOSED',409); return arenaQr(this.active.url); }
  async enable(versionId: string, address?: string, roomId?: string) {
    if (this.stopped) throw new Fault('ARENA_STOPPED',503);
    if (this.busy) throw new Fault('ARENA_BUSY',409);
    this.busy=true;
    let selected: string|undefined;
    try {
      const v=this.store.getVersion(versionId);
      if (!arenaDeclared(v.html)) throw new Fault('ARENA_UNSUPPORTED',409);
      if (roomId && this.records.room(roomId).version_id !== versionId) throw new Fault('ARENA_VERSION_MISMATCH',409);
      const networks=await this.networks();
      if (this.stopped) throw new Fault('ARENA_STOPPED',503);
      if (!networks.length) throw new Fault('PHONE_NO_NETWORK',409);
      if (!address && networks.length>1) throw new Fault('PHONE_CHOOSE_NETWORK',409);
      const host=address??networks[0].address;
      if (!networks.some(n=>n.address===host)) throw new Fault('HOST_NOT_AVAILABLE',409);
      if (this.active && this.active.roomId===roomId && new URL(this.active.origin).hostname===host && this.records.board(roomId!).open) return this.status();
      // Different selected version is an explicit operation; existing room history remains.
      if (this.active) this.records.close(this.active.roomId);
      await this.close();
      const room=roomId ? this.records.resume(roomId,versionId) : this.records.create(versionId);
      selected=room.roomId;
      const app=this.mobileApp();
      this.server=await new Promise<Server>((done,fail)=>{
        const server=serve({fetch:app.fetch,hostname:host,port:this.port},()=>done(server as Server)); server.once('error',fail);
      });
      this.port=(this.server.address() as {port:number}).port;
      this.server.maxConnections=128; this.server.requestTimeout=5000; this.server.headersTimeout=5000; this.server.keepAliveTimeout=1000;
      const origin=`http://${host}:${this.port}`, invite=randomBytes(32).toString('base64url');
      this.active={roomId:room.roomId,origin,url:origin+'/arena/'+room.roomId+'#'+invite,invite:hash(invite)};
      if (this.stopped) throw new Fault('ARENA_STOPPED',503);
      const response=await fetch(origin+'/arena/'+room.roomId,{redirect:'error',signal:AbortSignal.timeout(3000)});
      if (!response.ok || !(await response.text()).includes('arena-ui.js')) throw new Fault('ARENA_UNREACHABLE',503);
      this.timer=setTimeout(()=>{ if(this.active)this.records.close(this.active.roomId); void this.close(); },ARENA_TTL); this.timer.unref();
      return this.status();
    } catch (error) {
      // Preflight errors leave a working room alone. Bind failures close only the new admission.
      if (selected) { this.records.close(selected); await this.close(); }
      if (error instanceof Fault) throw error;
      throw new Fault((error as NodeJS.ErrnoException).code?portError(error as NodeJS.ErrnoException):'ARENA_UNREACHABLE',503);
    } finally { this.busy=false; }
  }
  async disable() {
    if (this.busy) throw new Fault('ARENA_BUSY',409);
    if(this.active)this.records.close(this.active.roomId);
    await this.close(); return this.status();
  }
  async close() {
    clearTimeout(this.timer); this.timer=undefined; this.active=undefined;
    const server=this.server; this.server=undefined;
    if(server){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
  }
  async shutdown() { this.stopped=true; await this.close(); }
  private mobileApp() {
    const app=new Hono(), asset=staticAssets(), limit=new RateLimit();
    app.use('*',async(c,next)=>{
      c.header('Cache-Control','no-store'); c.header('Referrer-Policy','no-referrer'); c.header('X-Content-Type-Options','nosniff'); c.header('Content-Security-Policy',CSP);
      const a=this.active, url=new URL(c.req.url);
      if(!a || !this.records.board(a.roomId).open) throw new Fault('ARENA_CLOSED',409);
      if(url.origin!==a.origin || c.req.header('Host')!==url.host || c.req.header('X-Forwarded-For') || c.req.header('X-Forwarded-Proto')) throw new Fault('HOST_FORBIDDEN',403);
      const base='/arena/'+a.roomId, navigation=c.req.method==='GET'&&c.req.path===base;
      if(c.req.header('Origin') && c.req.header('Origin')!==a.origin || c.req.header('Sec-Fetch-Site')==='cross-site'&&!navigation || c.req.method==='POST'&&c.req.header('Origin')!==a.origin) throw new Fault('ORIGIN_FORBIDDEN',403);
      limit.take('requests',12_000);
      if(c.req.method==='GET' && [base,'/arena/style.css','/arena/arena-ui.js'].includes(c.req.path)){await next();return;}
      if(c.req.method==='POST'&&c.req.path===base+'/join'){
        limit.take('joins',120);
        const body=object(await arenaJson(c.req.raw,512),['invite','nickname']);
        if(typeof body.invite!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.invite)||!timingSafeEqual(hash(body.invite),a.invite))throw new Fault('ARENA_INVITE_REQUIRED',401);
        const p=this.records.join(a.roomId,body.nickname);
        c.header('Set-Cookie',`yaplix_arena=${p.token}; Path=${base}; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0,Math.floor((this.records.room(a.roomId).expires_at-Date.now())/1000))}`);
        return c.json({playerId:p.playerId,nickname:p.nickname},201);
      }
      const cookie=c.req.header('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('yaplix_arena='))?.slice('yaplix_arena='.length);
      if(!cookie || !/^[A-Za-z0-9_-]{43}$/.test(cookie))throw new Fault('ARENA_ACCESS_REQUIRED',401);
      const p=this.records.player(a.roomId,cookie);
      const read=c.req.method==='GET'&&['/me','/version','/results'].some(path=>c.req.path===base+path);
      const write=c.req.method==='POST'&&['/attempts','/events'].some(path=>c.req.path===base+path);
      if(!read&&!write)throw new Fault('ARENA_SCOPE_FORBIDDEN',403);
      if(c.req.path===base+'/me')return c.json({playerId:p.player_id,nickname:p.nickname,roomId:a.roomId});
      if(c.req.path===base+'/version'){
        const r=this.records.room(a.roomId), v=this.store.getVersion(r.version_id);
        return c.json({html:v.html,versionId:r.version_id,sha256:r.sha256,title:v.spec.prompt,expiresAt:r.expires_at});
      }
      if(c.req.path===base+'/results')return c.json(this.records.board(a.roomId));
      if(c.req.path===base+'/attempts'){
        limit.take('attempt-'+p.player_id,20);
        object(await arenaJson(c.req.raw,32),[]); return c.json(this.records.start(a.roomId,cookie),201);
      }
      limit.take('events-'+p.player_id,240,10_000);
      const token=c.req.header('Authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
      if(!token)throw new Fault('SESSION_UNAUTHORIZED',401);
      return c.json(this.records.event(a.roomId,cookie,token,await arenaJson(c.req.raw)));
    });
    app.get('/arena/style.css',c=>asset(c,'assets/arena.css','text/css; charset=utf-8',false));
    app.get('/arena/arena-ui.js',c=>asset(c,'build/public/arena-ui.js','text/javascript; charset=utf-8',false));
    app.get('/arena/:roomId',c=>{uuid(c.req.param('roomId'));return asset(c,'assets/arena.html','text/html; charset=utf-8',false);});
    app.onError((error,c)=>c.json({error:error instanceof Fault?error.code:'ARENA_UNAVAILABLE'},error instanceof Fault?error.status as 400:500));
    return app;
  }
}
