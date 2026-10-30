import {test} from 'node:test';
import assert from 'node:assert/strict';
import {awaitWithAbort} from '../src/abortable.ts';

test('abort settles a pending browser operation within its deadline',{timeout:250},async()=>{
 const controller=new AbortController();
 const operation=new Promise<string>(()=>{});
 const pending=awaitWithAbort(operation,controller.signal,()=>Object.assign(new Error('BROWSER_TIMEOUT'),{code:'BROWSER_TIMEOUT'}));
 controller.abort();
 await assert.rejects(pending,{code:'BROWSER_TIMEOUT'});
});

test('a browser context resolving after abort is disposed',{timeout:250},async()=>{
 const controller=new AbortController();let resolve!: (value:{close:()=>Promise<void>})=>void;let closed=0;
 const operation=new Promise<{close:()=>Promise<void>}>(yes=>{resolve=yes;});
 const pending=awaitWithAbort(operation,controller.signal,()=>Object.assign(new Error('BROWSER_TIMEOUT'),{code:'BROWSER_TIMEOUT'}),value=>value.close());
 controller.abort();await assert.rejects(pending,{code:'BROWSER_TIMEOUT'});
 resolve({close:async()=>{closed++;}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(closed,1);
});
