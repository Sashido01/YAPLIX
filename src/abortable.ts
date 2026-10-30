export function awaitWithAbort<T>(operation:Promise<T>,signal:AbortSignal,error:()=>Error,dispose?:(value:T)=>unknown):Promise<T>{
 return new Promise<T>((resolve,reject)=>{
  let settled=false;
  const onAbort=()=>{if(settled)return;settled=true;reject(error());};
  signal.addEventListener('abort',onAbort,{once:true});
  operation.then(value=>{
   if(settled){try{void Promise.resolve(dispose?.(value)).catch(()=>{});}catch{/* Late resources are best-effort disposed. */}return;}
   settled=true;signal.removeEventListener('abort',onAbort);resolve(value);
  },reason=>{
   if(settled)return;
   settled=true;signal.removeEventListener('abort',onAbort);reject(reason);
  });
  if(signal.aborted)onAbort();
 });
}
