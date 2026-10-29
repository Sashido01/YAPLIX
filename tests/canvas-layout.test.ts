import test from 'node:test';
import assert from 'node:assert/strict';
import {measureCanvasTextBounds,detectCanvasTextOverlaps} from '../src/canvas-layout.ts';
import {canvasTextLayoutEvidence,requireCanvasTextLayout,canvasDiagnosticFeedback} from '../src/canvas-check.ts';

const base={x:50,y:20,actualBoundingBoxLeft:40,actualBoundingBoxRight:10,actualBoundingBoxAscent:8,actualBoundingBoxDescent:2,transform:{a:1,b:0,c:0,d:1,e:0,f:0},canvas:{width:100,height:60,cssWidth:100,cssHeight:60}};
test('measured text entirely inside canvas is not clipped',()=>{
 const result=measureCanvasTextBounds(base);
 assert.equal(result.status,'VISIBLE');assert.deepEqual(result.edges,[]);
});
test('text beyond the backing surface yields exact transformed clipped bounds',()=>{
 const result=measureCanvasTextBounds({...base,x:4,transform:{a:2,b:0,c:0,d:2,e:0,f:0},canvas:{width:100,height:60,cssWidth:50,cssHeight:30}});
 assert.equal(result.status,'CLIPPED');assert.deepEqual(result.edges,['left']);assert.equal(result.clippedCss.left,36);
});
test('rotation is bounded by transformed glyph corners',()=>{
 const result=measureCanvasTextBounds({...base,x:95,y:5,actualBoundingBoxLeft:0,actualBoundingBoxRight:20,actualBoundingBoxAscent:10,actualBoundingBoxDescent:0,transform:{a:0,b:1,c:-1,d:0,e:0,f:0}});
 assert.equal(result.status,'CLIPPED');assert.ok(result.edges.includes('bottom'));
});
test('unknown shaping, maxWidth and active canvas clipping remain NOT_VERIFIED',()=>{
 for(const extra of [{maxWidth:true},{clipActive:true},{actualBoundingBoxAscent:NaN}]){
  const result=measureCanvasTextBounds({...base,...extra} as any);assert.equal(result.status,'NOT_VERIFIED');
 }
});
test('independent text glyph masks with repeated significant pixel overlap are a confirmed conflict',()=>{
 const result=detectCanvasTextOverlaps([
  {textHash:'hud',drawOrder:1,bounds:{left:0,top:0,right:30,bottom:20},inkPixels:[11,12,13,21,22,23,31,32]},
  {textHash:'button',drawOrder:2,bounds:{left:10,top:0,right:40,bottom:20},inkPixels:[12,13,22,23,32,33,41,42]},
 ]);
 assert.equal(result.status,'VERIFIED');assert.equal(result.conflicts.length,1);
 assert.equal(result.conflicts[0].intersectionPixels,5);assert.ok(result.conflicts[0].overlapRatio>=0.05);
});
test('overlapping text bounding boxes with disjoint glyph pixels do not fail',()=>{
 const result=detectCanvasTextOverlaps([
  {textHash:'first',drawOrder:1,bounds:{left:0,top:0,right:30,bottom:20},inkPixels:[1,2,3,4]},
  {textHash:'second',drawOrder:2,bounds:{left:10,top:0,right:40,bottom:20},inkPixels:[36,37,38,39]},
 ]);
 assert.equal(result.status,'VERIFIED');assert.deepEqual(result.conflicts,[]);
});
test('a lone label over a drawn button or playfield background is not inferred as a conflict',()=>{
 const result=detectCanvasTextOverlaps([{textHash:'button-label',drawOrder:2,bounds:{left:20,top:10,right:80,bottom:30},inkPixels:[101,102,103,104,105,106]}]);
 assert.equal(result.status,'VERIFIED');assert.deepEqual(result.conflicts,[]);
});
test('overlapping same-label redraws are left NOT_VERIFIED because outline versus duplicate UI is ambiguous',()=>{
 const draw={textHash:'same',drawOrder:1,bounds:{left:0,top:0,right:20,bottom:10},inkPixels:[1,2,3,4,5,6,7,8]};
 const result=detectCanvasTextOverlaps([draw,{...draw,drawOrder:2}]);
 assert.equal(result.status,'NOT_VERIFIED');assert.deepEqual(result.conflicts,[]);
});
test('unavailable glyph raster evidence remains NOT_VERIFIED rather than inferring from rectangles',()=>{
 const result=detectCanvasTextOverlaps([
  {textHash:'first',drawOrder:1,bounds:{left:0,top:0,right:30,bottom:20},inkPixels:null},
  {textHash:'second',drawOrder:2,bounds:{left:10,top:0,right:40,bottom:20},inkPixels:[36,37,38,39]},
 ]);
 assert.equal(result.status,'NOT_VERIFIED');assert.deepEqual(result.conflicts,[]);
});
test('only repeated confirmed raster overlap blocks and its feedback omits full label text',()=>{
 const conflict={earlierTextHash:'a1',laterTextHash:'b2',drawOrder:[2,5] as [number,number],earlierBounds:{left:10,top:20,right:80,bottom:48},laterBounds:{left:60,top:20,right:110,bottom:48},intersectionPixels:24,overlapRatio:.12,stableSamples:2,status:'CONFIRMED' as const};
 const sample:any={canvases:[{id:1,context:'2d',draws:30,image:'hash',meaningful:true,fits:true,exposed:true,layoutCoverage:'canvas2d-text-metrics',unverifiedText:0,textOverlapCoverage:'VERIFIED',textOverlaps:[conflict],texts:[]}],dom:0};
 const evidence=canvasTextLayoutEvidence(sample,{width:390,height:700},'canvas-input');assert.equal(evidence.status,'FAIL');assert.equal(evidence.overlapStatus,'FAIL');
 assert.throws(()=>requireCanvasTextLayout([sample],{width:390,height:700},'canvas-input'),(error:any)=>error.code==='BROWSER_CANVAS_UI_OVERLAP'&&JSON.parse(error.feedback).overlaps[0].intersectionPixels===24&&!JSON.stringify(JSON.parse(error.feedback)).includes('Жизни'));
 const uncertain=structuredClone(sample);uncertain.canvases[0].textOverlaps=[{...conflict,status:'OBSERVED',stableSamples:1}];
 assert.equal(canvasTextLayoutEvidence(uncertain,{width:390,height:700},'canvas-input').confirmed,false);
 assert.doesNotThrow(()=>requireCanvasTextLayout([uncertain],{width:390,height:700},'canvas-input'));
});
test('sub-two-pixel Canvas text clipping is not a confirmed layout blocker',()=>{
 const smallClip:any={textHash:'title',length:18,edges:['right'],bounds:{left:1,top:20,right:391.1,bottom:40},clippedCss:{left:0,top:0,right:1.1,bottom:0},stableSamples:2,status:'CLIPPED'};
 const sample:any={canvases:[{id:1,context:'2d',draws:20,image:'hash',meaningful:true,fits:true,exposed:true,layoutCoverage:'canvas2d-text-metrics',unverifiedText:0,textOverlapCoverage:'VERIFIED',textOverlaps:[],texts:[smallClip]}],dom:0};
 const evidence=canvasTextLayoutEvidence(sample,{width:390,height:700},'layout');
 assert.equal(evidence.confirmed,false);assert.equal(evidence.status,'NOT_VERIFIED');
 assert.doesNotThrow(()=>requireCanvasTextLayout([sample],{width:390,height:700},'layout'));
});
test('overlap feedback carries viewport, draw order, shared pixels and screenshot digest without label contents',()=>{
 const overlap={earlierTextHash:'a1',laterTextHash:'b2',drawOrder:[2,5] as [number,number],earlierBounds:{left:10,top:20,right:80,bottom:48},laterBounds:{left:60,top:20,right:110,bottom:48},intersectionPixels:24,overlapRatio:.12,stableSamples:2,status:'CONFIRMED' as const};
 const snapshot:any={canvases:[{id:1,context:'2d',draws:30,image:'hash',meaningful:true,fits:true,exposed:true,layoutCoverage:'canvas2d-text-metrics',unverifiedText:0,textOverlapCoverage:'VERIFIED',textOverlaps:[overlap],texts:[]}],dom:0};
 const feedback=JSON.parse(canvasDiagnosticFeedback('BROWSER_CANVAS_UI_OVERLAP','pause',[snapshot],[],{width:390,height:700},[],{captureId:'shot-390',sha256:'b'.repeat(64)}));
 assert.equal(feedback.viewport.dpr,2);assert.equal(feedback.canvasTextLayout.overlaps[0].drawOrder[1],5);assert.equal(feedback.canvasTextLayout.overlaps[0].intersectionPixels,24);assert.equal(feedback.screenshot.sha256,'b'.repeat(64));assert.doesNotMatch(JSON.stringify(feedback),/Жизни|ПАУЗА/);
});
