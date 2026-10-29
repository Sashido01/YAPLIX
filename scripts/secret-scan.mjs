import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const probe=spawnSync('gitleaks',['version'],{encoding:'utf8'});
if(probe.error?.code==='ENOENT'||probe.status!==0){console.error('SECRET_SCAN_TOOL_MISSING: install a trusted gitleaks binary before release acceptance.');process.exit(2);}
const configDir=mkdtempSync(join(tmpdir(),'yaplix-gitleaks-'));
const config=join(configDir,'gitleaks.toml');
writeFileSync(config,[
  'title = "YAPLIX source scan"',
  '[extend]',
  'useDefault = true',
  '[allowlist]',
  'paths = [',
  "  '''(^|/)(\\.local|node_modules|build|\\.git)(/|$)''',",
  "  '''(^|/)\\.env(?:\\..*)?$''',",
  ']',
  '',
].join('\n'));
const result=spawnSync('gitleaks',['dir','--config',config,'--redact','--no-banner','.'],{stdio:'inherit'});
if(result.error)console.error(result.error.message);
rmSync(configDir,{recursive:true,force:true});
if(result.status===0)console.log('Secret content scan passed for tracked and untracked source candidates. Git history and staged candidate still require separate scan before publication.');
process.exitCode=result.error?1:result.status??1;
