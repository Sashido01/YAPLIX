import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { networkPolicy } from '../src/access.ts';
import { lanAddresses, checkHost, checkPort, persistentLanKey } from '../src/network.ts';
import { connectionQr } from '../src/qr.ts';
import { liveReadiness } from '../src/diagnostics.ts';
import { spec, html } from './helpers.ts';

test('LAN selection lists all private interfaces, retains supplied key, rejects absent host and reports busy port',async t=>{
  assert.equal(persistentLanKey({YAPLIX_ACCESS_KEY:'supplied-key'}),'supplied-key');
  const retained=persistentLanKey({});assert.match(retained,/^[A-Za-z0-9_-]{32,128}$/);assert.equal(persistentLanKey({}),retained);
  const entries=lanAddresses();assert.ok(entries.every(e=>e.name&&e.address));
  const absent=['10.255.255.254','192.168.255.254'].find(ip=>!entries.some(e=>e.address===ip))!;
  assert.throws(()=>checkHost(networkPolicy({YAPLIX_MODE:'lan',YAPLIX_HOST:absent,YAPLIX_ACCESS_KEY:'x'.repeat(32)})),/HOST_NOT_AVAILABLE/);
  const server=createServer();await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));t.after(()=>server.close());
  const port=(server.address() as any).port;await assert.rejects(checkPort(networkPolicy({PORT:String(port)})),/PORT_IN_USE/);
  const doctor=spawnSync(process.execPath,['scripts/maintenance.ts','doctor'],{encoding:'utf8',env:{...process.env,YAPLIX_MODE:'local',YAPLIX_HOST:'127.0.0.1',PORT:String(port),YAPLIX_DB:':memory:',LIVE_PROVIDER:'none',PUBLIC_URL:''}});
  assert.equal(doctor.status,1);assert.ok(JSON.parse(doctor.stdout).failures.includes('PORT_IN_USE'));
});

test('QR refuses loopback, wildcard, public address, credentials and secrets in query/hash',()=>{
  for(const origin of ['http://127.0.0.1:3000','http://localhost:3000','http://0.0.0.0:3000','http://8.8.8.8','http://key@192.168.1.2','http://192.168.1.2/?key=secret','http://192.168.1.2/#secret'])assert.throws(()=>connectionQr(origin),/LAN_QR_UNAVAILABLE/);
  assert.match(connectionQr('http://192.168.1.2:3000'),/^<svg/);
});
