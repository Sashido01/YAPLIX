/** Independently authored offline games and reductions, never provider output. */
export function terminalCanvas({restart=true,decorative=false,crash=false}={}){
 return canvasGame().replace('<output>',`<section role="dialog" hidden><h2>Game Over</h2><p>Score: 2</p>${restart?'<button id="restart">Restart</button>':''}</section><output>`)
  .replace('step++;draw();',decorative?'step++;':'step++;draw();')
  .replace('document.querySelector("output").textContent="Steps "+step;',`document.querySelector("output").textContent="Steps "+step;if(step>=2){active=false;ctx.clearRect(0,0,surface.width,surface.height);document.querySelector('section').hidden=false;}`)
  .replace("document.querySelector('#move').onclick=act;",`${restart?`document.querySelector('#restart').onclick=()=>{${crash?'throw Error("restart failed");':''}step=0;active=true;document.querySelector('section').hidden=true;draw();};`:''}document.querySelector('#move').onclick=act;`);
}

export function animatedWebgl(kind='webgl',ending='draw'){
 return canvasGame(kind).replace('preserveDrawingBuffer:true','preserveDrawingBuffer:false')
  .replace('Move past the obstacle','Reach the gold target twice per point. Collect three points to win.')
  .replace('<output>','<section role="dialog" hidden><h2>You won</h2><button id="restart">Restart</button></section><output>')
  .replace('vec4(1.,.7,.1,1.)','tint')
  .replace("void main(){gl_FragColor=tint;}","uniform vec4 tint;void main(){gl_FragColor=tint;}")
  .replace("void main(){color=tint;}","uniform vec4 tint;void main(){color=tint;}")
  .replace('ctx.drawArrays(ctx.TRIANGLES,0,3);',"ctx.uniform4f(ctx.getUniformLocation(program,'tint'),.2,.7,1,1);ctx.drawArrays(ctx.TRIANGLES,0,3);ctx.uniform1f(ctx.getUniformLocation(program,'shift'),.65+Math.sin(ticks/10)*.05);ctx.uniform4f(ctx.getUniformLocation(program,'tint'),1,.7,.1,1);ctx.drawArrays(ctx.TRIANGLES,0,3);")
  .replace('function act(){','let ticks=0;function tick(){ticks++;surface.dataset.frame=String(ticks);if(active){'+
   (ending==='stop'||ending==='halt'?'if(step<2)draw();':ending==='clear'?'if(step>=2)ctx.clear(ctx.COLOR_BUFFER_BIT);else draw();':ending==='reset'?'if(step>=2)surface.width=surface.width;else draw();':ending==='redraw'?'ctx.clear(ctx.COLOR_BUFFER_BIT);draw();':'draw();')+
   '}'+(ending==='halt'?'if(step<2)':'')+'requestAnimationFrame(tick);}requestAnimationFrame(tick);function act(){')
  .replace('(step%3)*.2','(step%3)*.2+Math.sin(ticks/10)*.05')
  .replace('let active=false,step=0;','let active=false,step=0,ticks=0,score=0;')
  .replace('let ticks=0;function tick()','function tick()')
  .replace('document.querySelector("output").textContent="Steps "+step;',`if(step%2===0)score++;document.querySelector('output').textContent='Score '+score;if(score===3){active=false;document.querySelector('section').hidden=false;}`)
  .replace("document.querySelector('#move').onclick=act;","document.querySelector('#restart').onclick=()=>{step=0;score=0;active=true;document.querySelector('section').hidden=true;document.querySelector('output').textContent='Score 0';draw();};document.querySelector('#move').onclick=act;");
}
export function canvasGame(kind='arcade'){
 const gl=kind==='webgl'||kind==='webgl2';
 const render=gl?`
 const ctx=surface.getContext('${kind}',{preserveDrawingBuffer:true});if(!ctx)throw Error('WEBGL_UNAVAILABLE');
 const shader=(type,source)=>{const s=ctx.createShader(type);ctx.shaderSource(s,source);ctx.compileShader(s);return s;};
 const program=ctx.createProgram();ctx.attachShader(program,shader(ctx.VERTEX_SHADER,'${kind==='webgl2'?'#version 300 es\\n in':'attribute'} vec2 p;uniform float shift;void main(){gl_Position=vec4(p.x+shift,p.y,0.,1.);}'));
 ctx.attachShader(program,shader(ctx.FRAGMENT_SHADER,'${kind==='webgl2'?'#version 300 es\\n precision mediump float;out vec4 color;':'precision mediump float;'}void main(){${kind==='webgl2'?'color':'gl_FragColor'}=vec4(1.,.7,.1,1.);}'));ctx.linkProgram(program);ctx.useProgram(program);
 const buffer=ctx.createBuffer();ctx.bindBuffer(ctx.ARRAY_BUFFER,buffer);ctx.bufferData(ctx.ARRAY_BUFFER,new Float32Array([-.7,-.7,.2,-.7,-.2,.7]),ctx.STATIC_DRAW);
 const p=ctx.getAttribLocation(program,'p');ctx.enableVertexAttribArray(p);ctx.vertexAttribPointer(p,2,ctx.FLOAT,false,0,0);
 function draw(){ctx.viewport(0,0,surface.width,surface.height);ctx.clearColor(.05,.1,.2,1);ctx.clear(ctx.COLOR_BUFFER_BIT);ctx.uniform1f(ctx.getUniformLocation(program,'shift'),(step%3)*.2);ctx.drawArrays(ctx.TRIANGLES,0,3);}
 `:`
 const ctx=surface.getContext('2d');
 function draw(){
 ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);ctx.fillStyle='#142038';ctx.fillRect(0,0,300,180);
 ${kind==='puzzle'?"for(let i=0;i<9;i++){ctx.fillStyle=i===step%9?'#ffce40':'#456788';ctx.fillRect(10+(i%3)*90,10+Math.floor(i/3)*52,80,44);}":"ctx.fillStyle='#4c8290';ctx.fillRect(220,20,45,120);ctx.fillStyle='#ffcc40';ctx.fillRect(20+(step%5)*30,100,40,40);"}
 }
 `;
 return `<!doctype html><html><head><meta name="yaplix-arena" content="goal-required-v1"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
 body{margin:0;font:16px system-ui;background:#101828;color:white}canvas{display:block;width:min(300px,100vw);height:180px;touch-action:none}button{min-width:60px;min-height:44px}output{display:block}
 </style></head><body><p>${kind==='puzzle'?'Light each tile':'Move past the obstacle'}</p><button id="begin">Start</button><canvas aria-label="Game world"></canvas><button id="move">Move</button><output>Ready</output><script>
 const surface=document.querySelector('canvas');let active=false,step=0;
 surface.width=300*devicePixelRatio;surface.height=180*devicePixelRatio;
 ${render}
 function act(){if(!active)return;${kind==='inert'?'return;':'step++;draw();document.querySelector("output").textContent="Steps "+step;'}}
 document.querySelector('#begin').onclick=()=>{active=true;document.querySelector('#begin').disabled=true;draw();};
 document.querySelector('#move').onclick=act;surface.addEventListener('pointerdown',act);
 addEventListener('keydown',e=>{if(e.key==='ArrowRight')act();});addEventListener('resize',draw);draw();
 </script></body></html>`;
}
export const domGame='<!doctype html><html><head><meta name="yaplix-arena" content="goal-required-v1"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><button onclick="this.textContent=Number(this.textContent)+1">0</button><script>/* authored offline fixture */</script></body></html>';
