param([Parameter(Mandatory=$true)][string]$Root,[string]$MenuHome)
$menu=if($MenuHome){Join-Path $MenuHome 'YAPLIX'}else{Join-Path ([Environment]::GetFolderPath('Programs')) 'YAPLIX'}
New-Item -ItemType Directory -Force -Path $menu | Out-Null
$shell=New-Object -ComObject WScript.Shell
foreach($entry in @(@('YAPLIX',''),@('Stop YAPLIX','--stop'),@('Configure AI','--settings'),@('YAPLIX log','--logs'))) {
 $link=$shell.CreateShortcut((Join-Path $menu ($entry[0]+'.lnk')))
 $guiNode=Join-Path $Root 'runtime\nodew.exe'
 if(-not (Test-Path -LiteralPath $guiNode)) { $guiNode=Join-Path $Root 'runtime\node.exe' }
 $link.TargetPath=$guiNode
 $link.Arguments='"'+(Join-Path $Root 'scripts\desktop.mjs')+'" '+$entry[1]
 $link.WorkingDirectory=$Root
 $link.Save()
}
