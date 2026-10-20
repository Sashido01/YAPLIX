/** Independently authored offline games and reductions, never provider output. */
export function canvasGame(kind='arcade'){
 const gl=kind==='webgl'||kind==='webgl2';
 const render=gl?`
 const ctx=surface.getContext('${kind}');if(!ctx)throw Error('WEBGL_UNAVAILABLE');
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
 return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
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
export const domGame='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><button onclick="this.textContent=Number(this.textContent)+1">0</button><script>/* authored offline fixture */</script></body></html>';
