import {chmodSync,mkdtempSync,rmSync,lstatSync,statSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Fault} from './contracts.ts';

let profileRoot:string|undefined;

/**
 * Give Playwright a private, process-unique short temp root. Linux uses /tmp
 * explicitly so project and YAPLIX_DATA_HOME depth cannot lengthen Chromium's
 * Unix-domain socket path. Other platforms use their OS temp root.
 */
export function configureBrowserTempRoot():string{
 if(profileRoot)return profileRoot;
 let path:string;
 try{
  const base=process.platform==='linux'?'/tmp':realpathSync(tmpdir());
  const baseInfo=process.platform==='linux'?lstatSync(base):statSync(base);
  if(!baseInfo.isDirectory()||baseInfo.isSymbolicLink())throw new Fault('BROWSER_SANDBOX_UNAVAILABLE',503);
  if(process.platform==='linux'&&(baseInfo.uid!==0||(baseInfo.mode&0o1000)===0))throw new Fault('BROWSER_SANDBOX_UNAVAILABLE',503);
  path=mkdtempSync(join(base,'yx-'));
 }catch(error){if(error instanceof Fault)throw error;throw new Fault('BROWSER_SANDBOX_UNAVAILABLE',503);}
 try{
  if(process.platform!=='win32')chmodSync(path,0o700);
  const info=statSync(path);
  if(!info.isDirectory()||process.getuid?.()!==undefined&&info.uid!==process.getuid()||process.platform!=='win32'&&(info.mode&0o077)!==0)throw new Fault('BROWSER_SANDBOX_UNAVAILABLE',503);
  if(process.platform==='linux'&&resolve(path).length>32)throw new Fault('BROWSER_TEMP_PATH_TOO_LONG',503);
  profileRoot=path;
  for(const key of ['TEMP','TMP','TMPDIR'])process.env[key]=path;
  process.once('exit',()=>{try{rmSync(path,{recursive:true,force:true});}catch{/* Best-effort cleanup after the checker process exits. */}});
  return path;
 }catch(error){try{rmSync(path,{recursive:true,force:true});}catch{}if(error instanceof Fault)throw error;throw new Fault('BROWSER_SANDBOX_UNAVAILABLE',503);}
}
