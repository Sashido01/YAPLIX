import {test,expect} from '@playwright/test';
import {browserCheck} from '../src/browser-check.ts';
import {checkFullHtml} from '../src/full-html-check.ts';
import {calibrationDocuments} from './calibration-fixtures.ts';
import type {Browser} from 'playwright-core';
test.beforeEach(({},info)=>test.skip(info.project.name!=='chromium-desktop','Server checker has its own mobile contexts.'));
test('MICRO-028 full HTML retains the first runtime exception detail',async()=>{
 await expect(browserCheck(calibrationDocuments[4]!,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'JAVASCRIPT_EXCEPTION',feedback:'JavaScript error in generated code: Cannot select cell',validationPhase:'action-controls',profileWidth:320});
});
test('MICRO-028 unsupported start overlay is inconclusive with actionable phase; never a game failure',async()=>{
 const source='<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;height:100vh}canvas{width:100%;height:100%}#cover{position:fixed;inset:0;background:white}button{min-height:48px}</style></head><body><canvas></canvas><div id="cover"><button onclick="document.querySelector(\'#cover\').remove()">Begin adventure</button></div></body></html>';
 await expect(browserCheck(source,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_CHECK_INCONCLUSIVE',validationPhase:'touch-input',profileWidth:320,feedback:expect.stringContaining('action timed out')});
});
test('MICRO-028 unexpected checker IO error is not classified as a game defect or inconclusive gameplay',async()=>{
 const context={newPage:async()=>{throw Error('synthetic internal IO');},close:async()=>{}};
 const browser={newContext:async()=>context} as unknown as Browser;
 await expect(checkFullHtml(browser,calibrationDocuments[0]!,AbortSignal.timeout(1000))).rejects.toMatchObject({code:'BROWSER_CHECKER_ERROR',validationPhase:'load',profileWidth:320});
});
