import {build} from 'esbuild';
import {copyFile,mkdir} from 'node:fs/promises';
await mkdir('build/src',{recursive:true});
await copyFile('src/windows-phone-network.ps1','build/src/windows-phone-network.ps1');
await build({entryPoints:['src/ui.ts','src/access-ui.ts','src/connection-ui.ts','src/phone-connect-ui.ts','src/phone-ui.ts','src/telegram-ui.ts'],bundle:true,minify:true,treeShaking:true,format:'esm',target:['chrome100','safari15.4','firefox100'],outdir:'build/public',entryNames:'[name]',legalComments:'none'});
