import {build} from 'esbuild';
await build({entryPoints:['src/ui.ts','src/access-ui.ts','src/connection-ui.ts','src/telegram-ui.ts'],bundle:true,minify:true,treeShaking:true,format:'esm',target:['chrome100','safari15.4','firefox100'],outdir:'build/public',entryNames:'[name]',legalComments:'none'});
