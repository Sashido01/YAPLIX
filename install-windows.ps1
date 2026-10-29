# Windows 10/11 x64 source checkout bootstrap. No administrator or global PATH.
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$InstallArgs)
$ErrorActionPreference='Stop'
# Auto-cleanup of stale installer/desktop locks from interrupted runs (preserves SQLite database and backups)
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'YAPLIX|desktop\.mjs|install-ui\.mjs|server\.ts' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 400
foreach ($lockPath in @(
  (Join-Path $env:LOCALAPPDATA 'YAPLIX\desktop.lock'),
  (Join-Path $env:LOCALAPPDATA 'YAPLIX\desktop.json'),
  (Join-Path $env:LOCALAPPDATA 'Programs\YAPLIX\installer\transaction.json'),
  (Join-Path $env:LOCALAPPDATA 'Programs\YAPLIX\installer\install.lock'),
  (Join-Path $env:LOCALAPPDATA 'Programs\YAPLIX\installer\view.json')
)) {
  if (Test-Path -LiteralPath $lockPath) { Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue }
}
$instDir = Join-Path $env:LOCALAPPDATA 'Programs\YAPLIX\installer'
if (Test-Path -LiteralPath $instDir) {
  Get-ChildItem -LiteralPath $instDir -Filter 'probe-*' -Directory -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

$name='node-v24.18.0-win-x64'
$expected='0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821'
$expectedBinary='9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de'
if(-not [Environment]::Is64BitOperatingSystem -or [Environment]::OSVersion.Version.Major -lt 10) { throw 'YAPLIX: требуется Windows 10/11 x64.' }
Write-Host 'YAPLIX: план — проверить Node 24.18.0, при необходимости загрузить официальный архив с SHA256 в личный профиль; затем временно собрать исходники через npm ci и открыть мастер установки. Системные пакеты не меняются; база сохраняется с backup при обновлении.'
Write-Host 'YAPLIX: сеть нужна только для недостающих Node/npm-компонентов; HTTP_PROXY, HTTPS_PROXY, NO_PROXY и доверенные сертификаты сохраняются.'
$base=if($env:YAPLIX_BOOTSTRAP_HOME){$env:YAPLIX_BOOTSTRAP_HOME}else{Join-Path $env:LOCALAPPDATA 'YAPLIX\tools'}
[void][IO.Directory]::CreateDirectory($base)
$target=Join-Path $base $name
$node=Join-Path $target 'node.exe'
$valid={ param($file) (Test-Path -LiteralPath $file -PathType Leaf) -and ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expectedBinary) }
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
      $curlArgs=@('--disable','--fail','--location','--silent','--show-error','--proto','=https','--proto-redir','=https','--connect-timeout','15','--max-time','180','--retry','2')
      # curl.exe inherits proxy variables; credentials stay out of process argv.
      if($env:NODE_EXTRA_CA_CERTS){$curlArgs+=@('--cacert',$env:NODE_EXTRA_CA_CERTS)}
      & $curl.Source @curlArgs --output $archive "https://nodejs.org/dist/v24.18.0/$name.zip"
      if($LASTEXITCODE -ne 0){throw 'YAPLIX: загрузка Node не удалась; проверьте DNS/TLS/маршрут и HTTP_PROXY, HTTPS_PROXY, NO_PROXY или передайте проверенный архив через YAPLIX_BOOTSTRAP_ARCHIVE.'}
    }
    $actual=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if($actual -ne $expected){throw 'YAPLIX: SHA256 архива Node не совпал; ничего не выполнялось.'}
    Expand-Archive -LiteralPath $archive -DestinationPath $stage
    $staged=Join-Path $stage $name
    if(-not (& $valid (Join-Path $staged 'node.exe'))){throw 'YAPLIX: архив не содержит подходящий Node.'}
    if(-not (Test-Path -LiteralPath $target)){Move-Item -LiteralPath $staged -Destination $target}
    if(-not (& $valid $node)){throw 'YAPLIX: существующий изолированный Node не совпадает с официальным SHA256; каталог сохранён.'}
  } finally { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
if($InstallArgs.Count -eq 1 -and $InstallArgs[0] -eq '--runtime-only') { Write-Output $node; exit 0 }
& $node (Join-Path $PSScriptRoot 'scripts\install-source.mjs') @InstallArgs
exit $LASTEXITCODE
