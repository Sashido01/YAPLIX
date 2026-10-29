import test from 'node:test';
import assert from 'node:assert/strict';
import {requireCanvas,canvasDiagnosticFeedback,type CanvasSnapshot} from '../src/canvas-check.ts';

function frame(id=1,image='drawn',meaningful=true,context='webgl',draws=3):CanvasSnapshot{
 return {dom:0,canvases:[{id,image,meaningful,context,draws,fits:true,exposed:true}]};
}
test('final blank frame cannot borrow old image evidence or cumulative draw calls',()=>{
 for(const draws of [0,30])assert.throws(()=>requireCanvas([frame(1,'first'),frame(),frame(1,'clear',false,'webgl',draws)]),/BROWSER_CANVAS_RENDER_UNVERIFIED/);
});
test('final canvas requires its own activity history with matching identity and context',()=>{
 assert.throws(()=>requireCanvas([frame(1,'old'),frame(2)]),/BROWSER_CANVAS_ACTIVITY_UNVERIFIED/);
 assert.throws(()=>requireCanvas([frame(1,'old',true,'2d'),frame()]),/BROWSER_CANVAS_ACTIVITY_UNVERIFIED/);
 assert.throws(()=>requireCanvas([frame(1,'first'),frame(),frame(2)]),/BROWSER_CANVAS_ACTIVITY_UNVERIFIED/);
 assert.deepEqual(requireCanvas([frame(1,'first'),frame()]),['webgl']);
});
test('contexts reflect only currently visible meaningful canvases',()=>{
 assert.deepEqual(requireCanvas([frame(2,'old',true,'2d'),frame(1,'first'),frame()]),['webgl']);
 const covered=frame();covered.canvases[0].exposed=false;
 assert.throws(()=>requireCanvas([frame(1,'first'),frame(),covered]),/BROWSER_CANVAS_RENDER_UNVERIFIED/);
});
test('terminal labels cannot exempt blank final frames in strict rendering',()=>{
 const terminal=frame(1,'clear',false);terminal.terminal=true;
 assert.throws(()=>requireCanvas([frame(1,'first'),frame(),terminal]),/BROWSER_CANVAS_RENDER_UNVERIFIED/);
 for(const prior of [[frame()],[frame(),frame()],[frame(1,'clear',false),frame()],[frame(2,'first'),frame(2)]])
  assert.throws(()=>requireCanvas([...prior,terminal]),/BROWSER_CANVAS_RENDER_UNVERIFIED/);
 const fake=frame();fake.terminal=true;
 assert.throws(()=>requireCanvas([fake,terminal]),/BROWSER_CANVAS_RENDER_UNVERIFIED/);
});
test('Canvas rejection diagnostics distinguish sampled rendering from failed interaction probes',()=>{
 const sample=frame(4,'hash-a');
 const rendering=JSON.parse(canvasDiagnosticFeedback('BROWSER_CANVAS_RENDER_UNVERIFIED','canvas-input',[sample]));
 assert.equal(rendering.code,'BROWSER_CANVAS_RENDER_UNVERIFIED');assert.equal(rendering.observations[0].canvases[0].hash,'hash-a');
 const activity=JSON.parse(canvasDiagnosticFeedback('BROWSER_CANVAS_ACTIVITY_UNVERIFIED','canvas-input',[sample],[{point:[.5,.5],canvasId:4,hashChanged:false,drawDelta:8}]));
 assert.match(activity.diagnosis,/static gameplay or an interaction point that missed/);assert.equal(activity.probes[0].drawDelta,8);assert.equal(activity.probes[0].hashChanged,false);
 const many=Array.from({length:20},(_,n)=>frame(n+1,'hash-'+n));
 const probes=Array.from({length:20},(_,n)=>({point:[n/20,.5] as [number,number],canvasId:n+1,hashChanged:false,drawDelta:0}));
 const bounded=canvasDiagnosticFeedback('BROWSER_CANVAS_ACTIVITY_UNVERIFIED','canvas-input',many,probes);
 assert.ok(Buffer.byteLength(bounded)<=2000);assert.ok(bounded.includes('"point":[0.95,0.5]'),'the last attempted target remains diagnosable');
});
