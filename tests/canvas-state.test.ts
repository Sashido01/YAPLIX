import test from 'node:test';
import assert from 'node:assert/strict';
import {requireCanvas,type CanvasSnapshot} from '../src/canvas-check.ts';

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
