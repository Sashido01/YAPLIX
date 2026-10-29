/** Authored offline fixture. Hitboxes use CSS/backing conversion, no DOM UI. */
export function strictCanvas(kind='2d') {
 return `<!doctype html><html><head><meta name="yaplix-arena" content="goal-required-v1"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block;width:100%;height:100%;touch-action:none}#hud{position:absolute;inset:0;pointer-events:none}
</style></head><body><canvas aria-label="Game"></canvas>${kind==='2d'?'':'<canvas id="hud" aria-label="Game interface"></canvas>'}<script>
const surface=document.querySelector('canvas'),hud=document.querySelector('#hud')||surface,ctx=hud.getContext('2d');
let active=false,step=0,paused=false,muted=false;
${kind==='2d'?'':`const gl=surface.getContext('${kind}',{preserveDrawingBuffer:true});if(!gl)throw Error('WEBGL_CONTEXT_UNAVAILABLE:${kind}');
const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);return s;};
const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'${kind==='webgl2'?'#version 300 es\\n in':'attribute'} vec2 p;uniform float shift;void main(){gl_Position=vec4(p.x+shift,p.y,0.,1.);}'));
gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'${kind==='webgl2'?'#version 300 es\\n precision mediump float;out vec4 color;':'precision mediump float;'}void main(){${kind==='webgl2'?'color':'gl_FragColor'}=vec4(1.,.7,.1,1.);}'));gl.linkProgram(program);gl.useProgram(program);
gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-.7,-.7,.2,-.7,-.2,.7]),gl.STATIC_DRAW);const p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);`}
function draw(){
 const w=hud.width/devicePixelRatio,h=hud.height/devicePixelRatio;ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
 ctx.clearRect(0,0,w,h);${kind==='2d'?"ctx.fillStyle='#142038';ctx.fillRect(0,0,w,h);":"gl.viewport(0,0,surface.width,surface.height);gl.clearColor(.05,.1,.2,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.uniform1f(gl.getUniformLocation(program,'shift'),(step%3)*.2);gl.drawArrays(gl.TRIANGLES,0,3);"}
 ctx.fillStyle='#ffcc40';ctx.fillRect(20+(step%5)*30,h*.6,40,40);
 ctx.fillStyle='#4c8290';ctx.fillRect(w*.75,h*.3,40,70);
 ctx.fillStyle='white';ctx.font='18px sans-serif';ctx.fillText('Score '+step+' Lives 3',15,30);
 ctx.fillText(paused?'Resume':'Pause',15,65);ctx.fillText(muted?'Sound off':'Sound on',w-100,65);
 ctx.fillStyle='#a94';ctx.fillRect(w*.2,h*.4,w*.6,48);ctx.fillStyle='white';ctx.fillText(!active?'Start':step>=4?'Game Over / Restart':'Move',w*.3,h*.4+30);
}

function resize(){for(const c of new Set([surface,hud])){const r=c.getBoundingClientRect();c.width=Math.round(r.width*devicePixelRatio);c.height=Math.round(r.height*devicePixelRatio);}draw();}
function act(){if(!active){active=true;draw();return;}if(step>=4){step=0;paused=false;draw();return;}if(!paused){step++;draw();}}
surface.addEventListener('pointerdown',e=>{const r=surface.getBoundingClientRect(),x=(e.clientX-r.left)*surface.width/r.width,y=(e.clientY-r.top)*surface.height/r.height;
 if(y<90*devicePixelRatio&&y>40*devicePixelRatio){if(x<r.width*devicePixelRatio/2)paused=!paused;else muted=!muted;draw();return;}act();});
addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key===' ')act();});addEventListener('resize',resize);resize();
</script></body></html>`;
}

export function strictAnimated(kind='webgl',ending='draw') {
 return strictCanvas(kind).replace('preserveDrawingBuffer:true','preserveDrawingBuffer:false')
  .replace('let active=false','let ticks=0;let active=false')
  .replace('(step%3)*.2','(step%3)*.2+Math.sin(ticks/10)*.05')
  .replace('resize();\n</script>',`resize();function tick(){ticks++;if(active){${ending==='clear'?'if(step>=2)gl.clear(gl.COLOR_BUFFER_BIT);else draw();':ending==='reset'?'if(step>=2)surface.width=surface.width;else draw();':ending==='stop'||ending==='halt'?'if(step<2)draw();':ending==='redraw'?'gl.clear(gl.COLOR_BUFFER_BIT);draw();':'draw();'}}${ending==='halt'?'if(step<2)':''}requestAnimationFrame(tick);}requestAnimationFrame(tick);\n</script>`);
}
