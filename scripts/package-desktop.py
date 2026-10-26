#!/usr/bin/env python3
"""Allowlisted offline packaging. Node archive and official checksums are build inputs."""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, tarfile, tempfile, zipfile
ROOT = pathlib.Path(__file__).resolve().parent.parent
p = argparse.ArgumentParser()
p.add_argument('--payload-only',action='store_true',help='Keep a verified payload for the shared portable builder')
p.add_argument('--payload-output',type=pathlib.Path,help='Output directory for --payload-only')
p.add_argument('--platform', choices=['linux','windows'], default='linux')
p.add_argument('--node-archive', type=pathlib.Path, required=True)
p.add_argument('--shasums', type=pathlib.Path, required=True)
p.add_argument('--browsers', type=pathlib.Path, required=True)
a=p.parse_args()
version='24.18.0'
expected_name=f'node-v{version}-'+('linux-x64.tar.xz' if a.platform=='linux' else 'win-x64.zip')
if a.node_archive.name!=expected_name: p.error('Only pinned Node 24.18.0 x64 archive is supported')
hashfile=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
checks={line.split()[1].lstrip('*'):line.split()[0] for line in a.shasums.read_text().splitlines() if len(line.split())==2}
if checks.get(expected_name)!=hashfile(a.node_archive): p.error('Node archive SHA256 mismatch')
lock=json.loads((ROOT/'package-lock.json').read_text())
if lock['packages']['node_modules/playwright-core']['version']!='1.64.0': p.error('Review Chromium revision for changed Playwright')
browser=a.browsers/('chromium-1248')
executable=browser/('chrome-linux64/chrome' if a.platform=='linux' else 'chrome-win64/chrome.exe')
if not executable.is_file(): p.error('Pinned platform Chromium 1248 is missing')
out=ROOT/'.local/install-001/packages';out.mkdir(parents=True,exist_ok=True)
# Temporary staging is always owned by this invocation, never a user's directory.
with tempfile.TemporaryDirectory(prefix='stage-',dir=out.parent) as tmp:
 t=pathlib.Path(tmp); app=t/'payload';app.mkdir()
 # Derive the server graph; retain source loading and filesystem contracts.
 meta=t/'graph.json'
 # API writes the metafile explicitly; no host-specific executable assumptions.
 subprocess.run(['node','-e',"const fs=require('fs');const result=require('esbuild').buildSync(JSON.parse(process.argv[1]));fs.writeFileSync(process.argv[2],JSON.stringify(result.metafile));",json.dumps({'entryPoints':['src/server.ts','scripts/app-runtime.ts'],'bundle':True,'platform':'node','format':'esm','packages':'external','outdir':str(t/'graph'),'metafile':True}),str(meta)],cwd=ROOT,check=True)
 inputs=json.loads(meta.read_text())['inputs']
 tracked=set(subprocess.check_output(['git','ls-files','-z','--','src','assets'],cwd=ROOT).decode().split('\0'))
 for name in inputs:
  if name.startswith('src/'):
   if name not in tracked and name!='src/browser-target.ts':raise RuntimeError('Untracked runtime source must be reviewed before packaging: '+name)
   target=app/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/name,target)
   emitted=pathlib.Path('build')/pathlib.Path(name).with_suffix('.js')
   target=app/emitted;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/emitted,target)
 for name in tracked:
  if name.startswith('assets/'):
   target=app/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/name,target)
 shutil.copytree(ROOT/'build/public',app/'build/public')
 (app/'scripts').mkdir();(app/'packaging').mkdir()
 for name in ['desktop.mjs','app-runtime.ts','install-engine.mjs','install-adapter.mjs','install-ui.mjs','install-probe.mjs','windows-lan-setup.ps1']:shutil.copy2(ROOT/'scripts'/name,app/'scripts'/name)
 for name in ['dialog.ps1','yaplix.svg','install-shortcuts.ps1','install.html','install-client.js']:shutil.copy2(ROOT/'packaging'/name,app/'packaging'/name)
 if a.platform=='windows':
  # Windows PowerShell 5.1 requires BOM for UTF-8 Cyrillic script literals.
  dialog=app/'packaging/dialog.ps1';dialog.write_bytes(b'\xef\xbb\xbf'+dialog.read_bytes())
 for name in ['package.json','package-lock.json','INSTALL.md']:shutil.copy2(ROOT/name,app/name)
 for name,meta in lock['packages'].items():
  if name and not meta.get('dev',False):
   if not name.startswith('node_modules/'):raise RuntimeError('Unexpected dependency path')
   source=ROOT/name
   if json.loads((source/'package.json').read_text())['version']!=meta['version']:raise RuntimeError('Run npm ci: installed dependency version mismatch')
   shutil.copytree(source,app/name,ignore=shutil.ignore_patterns('.cache'))
 runtime=app/'runtime';runtime.mkdir()
 unpack=t/'node';unpack.mkdir()
 if a.platform=='linux':
  with tarfile.open(a.node_archive) as archive:archive.extractall(unpack,filter='data')
  dist=unpack/f'node-v{version}-linux-x64'
  shutil.copy2(dist/'bin/node',runtime/'node')
 else:
  with zipfile.ZipFile(a.node_archive) as archive:archive.extractall(unpack)
  dist=unpack/f'node-v{version}-win-x64'
  shutil.copy2(dist/'node.exe',runtime/'node.exe')
  # nodew is built on Windows; no terminal window for graphical shortcuts.
  nodew=ROOT/'.local/install-001/nodew.exe'
  if not nodew.is_file():p.error('Build packaging/nodew.c on Windows first; see installer-building.md')
  shutil.copy2(nodew,runtime/'nodew.exe')
 shutil.copy2(dist/'LICENSE',runtime/'NODE-LICENSE.txt')
 shutil.copytree(browser,app/'browsers/chromium-1248')
 # The regular Chromium channel is used for the protected production checker.
 (app/'packaging/delivery.json').write_text(json.dumps({'browser':'isolated-chromium'}))
 manifest={str(f.relative_to(app)).replace(os.sep,'/'):hashfile(f) for f in sorted(app.rglob('*')) if f.is_file()}
 (app/'integrity.json').write_text(json.dumps(manifest,sort_keys=True))
 if a.payload_only:
  dest=(a.payload_output or ROOT/'.local/install-002/windows-payload').resolve()
  if dest.exists():p.error('Output payload already exists; preserve or choose a fresh build workspace')
  shutil.copytree(app,dest);print(str(dest));raise SystemExit(0)
 package_version=json.loads((ROOT/'package.json').read_text())['version']
 if a.platform=='linux':
  deb=t/'deb';target=deb/'opt/yaplix';target.parent.mkdir(parents=True);shutil.move(app,target)
  control=deb/'DEBIAN';control.mkdir()
  dependencies='libc6 (>= 2.39), libstdc++6, libgcc-s1, libasound2t64, libatk-bridge2.0-0t64, libatk1.0-0t64, libatspi2.0-0t64, libcairo2, libcups2t64, libdbus-1-3, libdrm2, libexpat1, libgbm1, libglib2.0-0t64, libnspr4, libnss3, libpango-1.0-0, libudev1, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxkbcommon0, libxrandr2, fonts-liberation, xdg-utils, zenity'
  (control/'control').write_text(f'Package: yaplix\nVersion: {package_version}\nArchitecture: amd64\nMaintainer: YAPLIX\nDepends: {dependencies}\nSection: games\nPriority: optional\nDescription: YAPLIX local HTML5 game workshop\n Includes Node.js and protected Chromium checker. User data is kept separately.\n')
  bin=deb/'usr/bin';bin.mkdir(parents=True)
  (bin/'yaplix').write_text('#!/bin/sh\nexec /opt/yaplix/runtime/node /opt/yaplix/scripts/desktop.mjs "$@"\n');(bin/'yaplix').chmod(0o755)
  icons=deb/'usr/share/icons/hicolor/scalable/apps';icons.mkdir(parents=True);shutil.copy2(ROOT/'packaging/yaplix.svg',icons/'yaplix.svg')
  menus=deb/'usr/share/applications';menus.mkdir(parents=True)
  for name,title,args in [('yaplix','YAPLIX',''),('yaplix-stop','Остановить YAPLIX','--stop'),('yaplix-settings','Настроить AI YAPLIX','--settings'),('yaplix-logs','Журнал YAPLIX','--logs')]:
   (menus/(name+'.desktop')).write_text(f'[Desktop Entry]\nType=Application\nName={title}\nExec=/usr/bin/yaplix {args}\nIcon=yaplix\nTerminal=false\nCategories=Game;\nStartupNotify=false\n')
  # The Debian archive records root ownership and the helper's required setuid bit.
  (target/'browsers/chromium-1248/chrome-linux64/chrome_sandbox').chmod(0o4755)
  for f in deb.rglob('*'):
   if f.is_dir():f.chmod(0o755)
  artifact=out/f'YAPLIX-{package_version}-ubuntu24.04-amd64.deb'
  subprocess.run(['dpkg-deb','--root-owner-group','-Zxz','-z3','--build',str(deb),str(artifact)],check=True)
 else:
  artifact=out/f'YAPLIX-{package_version}-windows-x64-setup.exe'
  prefix='/D' if os.name=='nt' else '-D'
  uninstall=t/'uninstall.nsh'
  lines=[]
  for f in sorted(app.rglob('*')):
   if f.is_file():lines.append('Delete "$INSTDIR\\'+str(f.relative_to(app)).replace(os.sep,'\\').replace('$','$$')+'"')
  for d in sorted((f for f in app.rglob('*') if f.is_dir()),key=lambda f:len(f.parts),reverse=True):
   lines.append('RMDir "$INSTDIR\\'+str(d.relative_to(app)).replace(os.sep,'\\').replace('$','$$')+'"')
  uninstall.write_text('\n'.join(lines)+'\n',encoding='utf-8-sig')
  subprocess.run(['makensis',f'{prefix}PAYLOAD={app}',f'{prefix}OUTPUT={artifact}',f'{prefix}UNINSTALL_MANIFEST={uninstall}',str(ROOT/'packaging/windows.nsi')],check=True)
 (out/(artifact.name+'.sha256')).write_text(hashfile(artifact)+'  '+artifact.name+'\n')
 print(json.dumps({'artifact':str(artifact),'bytes':artifact.stat().st_size,'sha256':hashfile(artifact)},indent=2))
