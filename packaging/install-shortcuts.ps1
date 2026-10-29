param([Parameter(Mandatory=$true)][string]$Root)
$menu=Join-Path ([Environment]::GetFolderPath('Programs')) 'YAPLIX'
New-Item -ItemType Directory -Force -Path $menu | Out-Null
$shell=New-Object -ComObject WScript.Shell
foreach($entry in @(@('YAPLIX',''),@('Stop YAPLIX','--stop'),@('Configure AI','--settings'),@('YAPLIX log','--logs'))) {
 $link=$shell.CreateShortcut((Join-Path $menu ($entry[0]+'.lnk')))
 $link.TargetPath=Join-Path $Root 'runtime\nodew.exe'
 $link.Arguments='"'+(Join-Path $Root 'scripts\desktop.mjs')+'" '+$entry[1]
 $link.WorkingDirectory=$Root
 $link.Save()
}
