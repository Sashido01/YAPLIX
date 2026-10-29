#!/usr/bin/env python3
"""Reuse INSTALL-001 payload; build small per-user ELF installers. No OS changes."""
import argparse,hashlib,json,os,pathlib,shutil,subprocess,tarfile,tempfile
ROOT=pathlib.Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('--platform',choices=['linux','windows'],default='linux');p.add_argument('--payload',type=pathlib.Path,required=True);p.add_argument('--mode',choices=['lite','full'],required=True);p.add_argument('--output',type=pathlib.Path);a=p.parse_args()
base=a.payload.resolve();digest=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
manifest=json.loads((base/'integrity.json').read_text())
for name,value in manifest.items():
 f=(base/name).resolve()
 if not f.is_relative_to(base) or digest(f)!=value:raise RuntimeError('Base payload integrity mismatch: '+name)
# A cached payload may predate DEMO removal or the current UI. Never silently
# publish those assets alongside current runtime overlays; rebuild the payload.
for name in manifest:
 if name.startswith('assets/'):
  source=ROOT/name
  if not source.is_file() or digest(source)!=manifest[name]:
   raise RuntimeError('STALE_PAYLOAD_ASSETS: rebuild the reviewed current payload: '+name)
out=(a.output or ROOT/'.local/install-002/packages').resolve();out.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='pack-',dir=out.parent) as tmp:
 stage=pathlib.Path(tmp);app=stage/'payload';app.mkdir()
 for name in manifest:
  if name.startswith('browsers/') and a.mode=='lite':continue
  f=app/name;f.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(base/name,f)
  f.chmod(f.stat().st_mode&0o777) # never install setuid files in a user profile
 # Reviewed source overlays keep the existing app, dependencies and build pipeline.
 sources=[n for n in manifest if n.startswith(('src/','build/src/','build/public/'))]+['src/browser-target.ts','build/src/browser-target.js','scripts/desktop.mjs','package.json','INSTALL.md']
 sources+=['scripts/operation-trace.mjs','scripts/app-runtime.ts','scripts/install-engine.mjs','scripts/install-adapter.mjs','scripts/install-ui.mjs','scripts/install-probe.mjs','packaging/install.html','packaging/install-client.js','packaging/install-shortcuts.ps1']
 for name in set(sources):
  f=app/name;f.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/name,f)
 (app/'packaging/delivery.json').write_text(json.dumps({'browser':'system-chrome' if a.mode=='lite' else 'isolated-chromium','os':'windows-10-11' if a.platform=='windows' else 'ubuntu-24.04','arch':'x64'}))
 provenance=[]
 if a.mode=='full' and a.platform=='linux':
  # Isolated, verified distro libraries; glibc/loader remain the target OS base.
  result=subprocess.check_output(['/usr/bin/ldd',str(base/'browsers/chromium-1248/chrome-linux64/chrome')],env={**os.environ,'LC_ALL':'C','LD_LIBRARY_PATH':''},text=True)
  for line in result.splitlines():
   if '=>' not in line:continue
   parts=line.split('=>',1);alias=parts[0].strip();value=parts[1].strip().split()[0]
   if value=='not':raise RuntimeError('Missing build-host Chromium library: '+alias)
   source=pathlib.Path(value);real=source.resolve()
   variants=[str(real),str(real).replace('/usr/lib/','/lib/'),str(source)]
   owned=None
   for variant in variants:
    r=subprocess.run(['dpkg-query','-S',variant],capture_output=True,text=True)
    if r.returncode==0:owned=r.stdout.split(': ',1)[0];break
   if not owned:raise RuntimeError('Unowned library: '+alias)
   if owned.split(':')[0]=='libc6':continue
   sums=pathlib.Path('/var/lib/dpkg/info')/(owned+'.md5sums')
   if not sums.exists():sums=pathlib.Path('/var/lib/dpkg/info')/(owned.split(':')[0]+'.md5sums')
   entries={line.split(maxsplit=1)[1].strip():line.split()[0] for line in sums.read_text().splitlines()}
   expected=next((entries.get(v.lstrip('/')) for v in variants if entries.get(v.lstrip('/'))),None)
   if not expected or hashlib.md5(real.read_bytes()).hexdigest()!=expected:raise RuntimeError('Distro library checksum mismatch: '+alias)
   lib=app/'lib'/alias;lib.parent.mkdir(exist_ok=True);shutil.copy2(real,lib)
   version=subprocess.check_output(['dpkg-query','-W','-f=${Version}',owned],text=True)
   provenance.append({'library':alias,'package':owned,'version':version,'sha256':digest(lib),'verified':'installed Ubuntu package checksum'})
   license=pathlib.Path('/usr/share/doc')/owned.split(':')[0]/'copyright'
   if license.exists():
    dest=app/'licenses'/owned.replace(':','_');dest.mkdir(parents=True,exist_ok=True);shutil.copy2(license,dest/'copyright')
 (app/'packaging/libraries.json').write_text(json.dumps(provenance,indent=2)+'\n')
 entries={str(f.relative_to(app)).replace(os.sep,'/'):digest(f) for f in sorted(app.rglob('*')) if f.is_file()}
 (app/'integrity.json').write_text(json.dumps(entries,sort_keys=True))
 size=sum(f.stat().st_size for f in app.rglob('*') if f.is_file())
 if a.platform=='windows':
  artifact=out/f'YAPLIX-0.0.1-windows-x64-{a.mode}-setup.exe'
  for file in ['dialog.ps1','install-shortcuts.ps1']:
   ps=app/'packaging'/file
   content=ps.read_bytes().removeprefix(b'\xef\xbb\xbf');ps.write_bytes(b'\xef\xbb\xbf'+content)
  entries={str(f.relative_to(app)).replace(os.sep,'/'):digest(f) for f in sorted(app.rglob('*')) if f.is_file() and f.name!='integrity.json'}
  (app/'integrity.json').write_text(json.dumps(entries,sort_keys=True))
  prefix='/D' if os.name=='nt' else '-D'
  subprocess.run(['makensis',f'{prefix}PAYLOAD={app}',f'{prefix}OUTPUT={artifact}',str(ROOT/'packaging/windows.nsi')],check=True)
 else:
  archive=stage/'payload.tar.xz'
  with tarfile.open(archive,'w:xz',preset=3) as tar:tar.add(app,arcname='payload')
  artifact=out/f'YAPLIX-0.0.1-ubuntu24.04-x64-{a.mode}.run'
  subprocess.run(['gcc','-O2','-s',f'-DARCHIVE_BYTES={archive.stat().st_size}ULL',f'-DUNPACKED_BYTES={size}ULL',f'-DARCHIVE_SHA="{digest(archive)}"',str(ROOT/'packaging/bootstrap.c'),'-o',str(artifact)],check=True)
  with artifact.open('ab') as target,archive.open('rb') as src:shutil.copyfileobj(src,target)
  artifact.chmod(0o755)
 (out/(artifact.name+'.sha256')).write_text(digest(artifact)+'  '+artifact.name+'\n')
 evidence={'artifact':str(artifact),'mode':a.mode,'bytes':artifact.stat().st_size,'sha256':digest(artifact),'unpackedBytes':size,'isolatedLibraries':provenance}
 (out/(a.mode+'-build.json')).write_text(json.dumps(evidence,indent=2)+'\n')
 print(json.dumps({k:v for k,v in evidence.items() if k!='isolatedLibraries'},indent=2))
