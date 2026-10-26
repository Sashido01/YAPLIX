# Windows 10/11 x64 source checkout bootstrap. No administrator or global PATH.
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$InstallArgs)
$ErrorActionPreference='Stop'
$name='node-v24.18.0-win-x64'
$expected='0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821'
if(-not [Environment]::Is64BitOperatingSystem -or [Environment]::OSVersion.Version.Major -lt 10) { throw 'YAPLIX: требуется Windows 10/11 x64.' }
$base=if($env:YAPLIX_BOOTSTRAP_HOME){$env:YAPLIX_BOOTSTRAP_HOME}else{Join-Path $env:LOCALAPPDATA 'YAPLIX\tools'}
[void][IO.Directory]::CreateDirectory($base)
$target=Join-Path $base $name
$node=Join-Path $target 'node.exe'
$valid={ param($file) (Test-Path -LiteralPath $file -PathType Leaf) -and ((& $file --version 2>$null) -eq 'v24.18.0') }
if($env:YAPLIX_BOOTSTRAP_ARCHIVE -or -not (& $valid $node)) {
  $stage=Join-Path $base ('.node-stage-'+[guid]::NewGuid().ToString('N'))
  [void][IO.Directory]::CreateDirectory($stage)
  try {
    $archive=Join-Path $stage ($name+'.zip')
    if($env:YAPLIX_BOOTSTRAP_ARCHIVE) {
      Copy-Item -LiteralPath $env:YAPLIX_BOOTSTRAP_ARCHIVE -Destination $archive
    } else {
      $curl=Get-Command curl.exe -ErrorAction Stop
      Write-Host 'YAPLIX: загружаем изолированный Node 24.18.0 с nodejs.org.'
      & $curl.Source --fail --location --silent --show-error --connect-timeout 15 --max-time 180 --retry 2 --output $archive "https://nodejs.org/dist/v24.18.0/$name.zip"
      if($LASTEXITCODE -ne 0){throw 'YAPLIX: загрузка Node не удалась; проверьте сеть или передайте проверенный архив через YAPLIX_BOOTSTRAP_ARCHIVE.'}
    }
    $actual=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if($actual -ne $expected){throw 'YAPLIX: SHA256 архива Node не совпал; ничего не выполнялось.'}
    Expand-Archive -LiteralPath $archive -DestinationPath $stage
    $staged=Join-Path $stage $name
    if(-not (& $valid (Join-Path $staged 'node.exe'))){throw 'YAPLIX: архив не содержит подходящий Node.'}
    if(-not (Test-Path -LiteralPath $target)){Move-Item -LiteralPath $staged -Destination $target}
    if(-not (& $valid $node)){throw 'YAPLIX: существующий изолированный Node повреждён; каталог сохранён.'}
  } finally { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
if($InstallArgs.Count -eq 1 -and $InstallArgs[0] -eq '--runtime-only') { Write-Output $node; exit 0 }
& $node (Join-Path $PSScriptRoot 'scripts\install-source.mjs') @InstallArgs
exit $LASTEXITCODE
