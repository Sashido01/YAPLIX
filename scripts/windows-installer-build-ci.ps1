# CI-only, per-workspace Windows installer build. No system package installation.
$ErrorActionPreference = 'Stop'
if (-not $env:CI -or -not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 CI is required.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
$tools = Join-Path $root '.local/release-ci-001/tools'
$build = Join-Path $root '.local/release-ci-001/windows-build'
New-Item -ItemType Directory -Force -Path $tools | Out-Null
if (Test-Path $build) { throw 'Installer build output must start empty.' }

function Download-Pinned([string]$url, [string]$path, [string]$sha256, [int]$maxTime = 180) {
  & curl.exe --disable --fail --location --silent --show-error --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time $maxTime --output $path $url
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $url" }
  $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $sha256) { throw "SHA256 mismatch: $path" }
}

$nodeArchive = Join-Path $tools 'node-v24.18.0-win-x64.zip'
Download-Pinned 'https://nodejs.org/dist/v24.18.0/node-v24.18.0-win-x64.zip' $nodeArchive '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821'
$shasums = Join-Path $tools 'SHASUMS256.txt'
& curl.exe --disable --fail --location --silent --show-error --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 60 --output $shasums 'https://nodejs.org/dist/v24.18.0/SHASUMS256.txt'
if ($LASTEXITCODE -ne 0) { throw 'Node official SHASUMS download failed.' }

$nsisArchive = Join-Path $tools 'nsis-3.11.zip'
Download-Pinned 'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.11/nsis-3.11.zip' $nsisArchive 'c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1'
$nsis = Join-Path $tools 'nsis-3.11'
Expand-Archive -LiteralPath $nsisArchive -DestinationPath $tools
if (-not (Test-Path (Join-Path $nsis 'makensis.exe'))) { throw 'Portable NSIS compiler is missing.' }
$env:PATH = "$nsis;$env:PATH"

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (-not (Test-Path $vswhere)) { throw 'Visual Studio locator is missing on the Windows runner.' }
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1
if (-not $vs) { throw 'MSVC x64 tools are missing on the Windows runner.' }
$dev = Join-Path $vs 'Common7/Tools/VsDevCmd.bat'
$nodewDir = Join-Path $root '.local/install-001'
New-Item -ItemType Directory -Force -Path $nodewDir | Out-Null
$compile = Join-Path $tools 'compile-nodew.cmd'
@(
  '@echo off'
  "call `"$dev`" -arch=x64 -host_arch=x64 >nul"
  'if errorlevel 1 exit /b 1'
  "cl /nologo /O2 /MT `"$root\packaging\nodew.c`" /Fo:`"$nodewDir\nodew.obj`" /Fe:`"$nodewDir\nodew.exe`" /link /SUBSYSTEM:WINDOWS"
  'exit /b %errorlevel%'
) | Set-Content -LiteralPath $compile -Encoding Ascii
& cmd.exe /d /c $compile
if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $nodewDir 'nodew.exe'))) { throw 'nodew.exe build failed.' }

$browser = Join-Path $root '.local/playwright'
New-Item -ItemType Directory -Force -Path $browser | Out-Null
$browserParts = @(
  @{Archive='chrome-win64.zip'; Directory='chromium-1248'; Sha256='220021ecfdad08c116fc71a153e65e3861ba841c531afc4f7acc7bd5d44b41db'},
  @{Archive='chrome-headless-shell-win64.zip'; Directory='chromium_headless_shell-1248'; Sha256='5af4c82cf4b351ec4bad4c71dcf938af14fccea8a0eb0d5c2a7b49ccc922698c'}
)
foreach ($part in $browserParts) {
  $archive = Join-Path $tools $part.Archive
  Download-Pinned "https://cdn.playwright.dev/builds/cft/156.0.8078.4/win64/$($part.Archive)" $archive $part.Sha256 900
  $destination = Join-Path $browser $part.Directory
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  Expand-Archive -LiteralPath $archive -DestinationPath $destination
}
foreach ($name in @('chromium-1248/chrome-win64/chrome.exe', 'chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe')) {
  if (-not (Test-Path (Join-Path $browser $name))) { throw "Pinned Windows browser missing: $name" }
}
& python scripts/build-installers.py --platform windows --node-archive $nodeArchive --shasums $shasums --browsers $browser --output $build
if ($LASTEXITCODE -ne 0) { throw 'Windows Lite/Full build failed.' }
foreach ($mode in @('lite', 'full')) {
  $artifact = Join-Path $build "packages/YAPLIX-0.0.1-windows-x64-$mode-setup.exe"
  $sum = "$artifact.sha256"
  if (-not (Test-Path $artifact) -or -not (Test-Path $sum)) { throw "Missing $mode installer or checksum." }
  $expected = ((Get-Content -LiteralPath $sum -Raw).Trim() -split '\s+')[0]
  if ((Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw "$mode installer SHA256 mismatch." }
}
