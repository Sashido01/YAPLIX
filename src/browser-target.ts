import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {Fault} from './contracts.ts';
/** Explicit delivery choice. Never changes browser after a validation failure. */
export type BrowserTarget={channel:'chrome'|'chromium';executablePath:string;ready:boolean};
export function checkerChannel(env:NodeJS.ProcessEnv=process.env):'chrome'|'chromium'{
 const value=env.YAPLIX_BROWSER_CHANNEL??'chromium';
 if(value!=='chrome'&&value!=='chromium')throw new Fault('BROWSER_INSTALL_REQUIRED',503);
 return value;
}
export function systemChromePath(platform=process.platform,env:NodeJS.ProcessEnv=process.env){
 if(platform==='linux')return '/opt/google/chrome/chrome';
 if(platform==='win32')return [env.LOCALAPPDATA,env.PROGRAMFILES,env['PROGRAMFILES(X86)']].filter((base):base is string=>Boolean(base)).map(base=>resolve(base,'Google/Chrome/Application/chrome.exe')).find(existsSync)??resolve(env.PROGRAMFILES??'C:/Program Files','Google/Chrome/Application/chrome.exe');
 if(platform==='darwin')return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 return '';
}
/** Resolve the same actual executable used for readiness, launch, and diagnostics. */
export function resolveBrowserTarget(chromiumExecutablePath:string,platform=process.platform,env:NodeJS.ProcessEnv=process.env):BrowserTarget{
 const channel=checkerChannel(env),executablePath=channel==='chrome'?systemChromePath(platform,env):chromiumExecutablePath;
 return{channel,executablePath,ready:Boolean(executablePath)&&existsSync(executablePath)};
}
export function systemChromePresent(platform=process.platform,env:NodeJS.ProcessEnv=process.env){
 const path=systemChromePath(platform,env);return Boolean(path)&&existsSync(path);
}
