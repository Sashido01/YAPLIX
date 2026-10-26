import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {Fault} from './contracts.ts';
/** Explicit delivery choice. Never changes browser after a validation failure. */
export function checkerChannel():'chrome'|'chromium'{
 const value=process.env.YAPLIX_BROWSER_CHANNEL??'chromium';
 if(value!=='chrome'&&value!=='chromium')throw new Fault('BROWSER_INSTALL_REQUIRED',503);
 return value;
}
export function systemChromePresent(){
 if(process.platform==='linux')return existsSync('/opt/google/chrome/chrome');
 if(process.platform==='win32')return [process.env.LOCALAPPDATA,process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)']].some(base=>base&&existsSync(resolve(base,'Google/Chrome/Application/chrome.exe')));
 return false;
}
/** Full ships Playwright's pinned headless shell as well as regular Chromium. */
export function checkerLaunchTarget(browserRoot=process.env.PLAYWRIGHT_BROWSERS_PATH):{channel?:'chrome';executablePath?:string}{
 if(checkerChannel()==='chrome')return {channel:'chrome' as const};
 if(!browserRoot)throw new Fault('BROWSER_INSTALL_REQUIRED',503);
 const binary=process.platform==='win32'?'chrome-headless-shell-win64/chrome-headless-shell.exe':'chrome-headless-shell-linux64/chrome-headless-shell';
 if(process.platform!=='win32'&&process.platform!=='linux')throw new Fault('BROWSER_INSTALL_REQUIRED',503);
 return {executablePath:resolve(browserRoot,'chromium_headless_shell-1248',binary)};
}
