#!/usr/bin/env python3
"""One developer entry point for the existing payload and installer builders."""
import argparse,json,pathlib,subprocess,sys

ROOT=pathlib.Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser()
p.add_argument('--platform',choices=['linux','windows'],required=True)
p.add_argument('--node-archive',type=pathlib.Path,required=True)
p.add_argument('--shasums',type=pathlib.Path,required=True)
p.add_argument('--browsers',type=pathlib.Path,required=True)
p.add_argument('--output',type=pathlib.Path,required=True)
a=p.parse_args()
host='windows' if sys.platform=='win32' else 'linux' if sys.platform=='linux' else 'unsupported'
if a.platform!=host:p.error('Build on the target operating system; runtime proof requires that OS')
out=a.output.resolve()
if out.exists() and any(out.iterdir()):p.error('Output must be new or empty; previous artifacts are preserved')
out.mkdir(parents=True,exist_ok=True)
payload=out/'payload'
subprocess.run([sys.executable,str(ROOT/'scripts/package-desktop.py'),'--platform',a.platform,'--payload-only','--payload-output',str(payload),'--node-archive',str(a.node_archive.resolve()),'--shasums',str(a.shasums.resolve()),'--browsers',str(a.browsers.resolve())],cwd=ROOT,check=True)
packages=out/'packages'
for mode in ('lite','full'):
 subprocess.run([sys.executable,str(ROOT/'scripts/package-installer.py'),'--platform',a.platform,'--payload',str(payload),'--mode',mode,'--output',str(packages)],cwd=ROOT,check=True)
checksums=sorted(packages.glob('*.sha256'))
if len(checksums)!=2:raise RuntimeError('Expected two installer checksums')
print(json.dumps({'platform':a.platform,'checksums':[str(f) for f in checksums]},indent=2))
