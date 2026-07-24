# Fast Windows packaging for LobsterAI / GSAI Office.
#
# Builds the renderer + Electron main, (optionally) the skills, and produces the
# NSIS installer. Invokes the local toolchain directly (node + node_modules\.bin)
# instead of through pnpm, so a `pnpm run` deps check can never trigger an
# implicit reinstall + native rebuild mid-build (the failure this script exists
# to avoid). Run `pnpm install` yourself whenever dependencies change.
#
# Flags:
#   -PrepareOpenClawRuntime  Rebuild the bundled OpenClaw runtime first (needs pnpm).
#   -SkipRendererBuild       Reuse an existing dist/ renderer bundle.
#   -SkipSkills              Skip building the bundled skills (faster incremental builds).
#   -KeepNativeRebuild       Let electron-builder rebuild native deps (default: off).
param(
  [switch]$PrepareOpenClawRuntime,
  [switch]$SkipRendererBuild,
  [switch]$SkipSkills,
  [switch]$KeepNativeRebuild
)

$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue) {
  $Global:PSNativeCommandUseErrorActionPreference = $false
}

# The renderer bundle exceeds Node's default ~2GB heap and crashes `vite build`
# with "JavaScript heap out of memory". Raise it (preserving a caller-set value).
if (-not $env:NODE_OPTIONS) {
  $env:NODE_OPTIONS = '--max-old-space-size=4096'
} elseif ($env:NODE_OPTIONS -notmatch 'max-old-space-size') {
  $env:NODE_OPTIONS = "$env:NODE_OPTIONS --max-old-space-size=4096"
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$binDir = Join-Path $repoRoot 'node_modules\.bin'
$logPath = Join-Path $env:TEMP ('lobsterai-dist-win-fast-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
$summary = New-Object System.Collections.Generic.List[object]
$totalWatch = [System.Diagnostics.Stopwatch]::StartNew()

function Add-PathIfExists([string]$path) {
  if ($path -and (Test-Path $path)) {
    $env:PATH = "$path;$env:PATH"
  }
}

function Find-CommandPath([string]$name) {
  $command = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) { return $command.Source }
  return $null
}

function Test-Node24 {
  $node = Find-CommandPath 'node'
  if (-not $node) { return $false }
  $version = & $node -v
  return $version -match '^v24\.'
}

function Resolve-LocalBin([string]$name) {
  # pnpm/npm create <name>.cmd shims under node_modules\.bin on Windows.
  $cmd = Join-Path $binDir "$name.cmd"
  if (-not (Test-Path $cmd)) {
    throw "Local binary not found: $cmd`nRun 'pnpm install' before packaging."
  }
  return $cmd
}

function Run-Step([string]$name, [scriptblock]$step) {
  Write-Host "==> $name"
  "==> $name" | Out-File -FilePath $logPath -Append -Encoding utf8
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  Push-Location $repoRoot
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $step | Tee-Object -FilePath $logPath -Append
    $exitCode = $LASTEXITCODE
    if ($null -ne $exitCode -and $exitCode -ne 0) {
      throw "$name failed with exit code $exitCode"
    }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
    Pop-Location
    $watch.Stop()
  }
  $summary.Add([pscustomobject]@{
    Step = $name
    Seconds = [Math]::Round($watch.Elapsed.TotalSeconds, 1)
  })
}

function Assert-Command([string]$name) {
  if (-not (Find-CommandPath $name)) {
    throw "Missing required command: $name"
  }
}

# Make Node, npm and Git discoverable without relying on the caller's shell profile.
Add-PathIfExists $binDir
Add-PathIfExists "$env:ProgramFiles\nodejs"
Add-PathIfExists "$env:LOCALAPPDATA\Programs\nodejs"
Add-PathIfExists "$env:USERPROFILE\AppData\Roaming\npm"
Add-PathIfExists "$env:ProgramFiles\Git\bin"
Add-PathIfExists "$env:ProgramFiles\Git\cmd"

if (-not (Test-Node24)) {
  throw 'Node.js 24 is required (package.json engines: >=24 <25). Install Node 24.x or put it on PATH.'
}
Assert-Command 'node'
Assert-Command 'npm'
Assert-Command 'git'

# Resolve the local build tools up front so a missing install fails fast and clearly.
$tsc = Resolve-LocalBin 'tsc'
$vite = Resolve-LocalBin 'vite'
$electronBuilder = Resolve-LocalBin 'electron-builder'

# pnpm is only needed to (re)build the OpenClaw runtime.
$pnpm = $null
if ($PrepareOpenClawRuntime) {
  $pnpm = Find-CommandPath 'pnpm.cmd'
  if (-not $pnpm) { $pnpm = Find-CommandPath 'pnpm.exe' }
  if (-not $pnpm) { throw 'pnpm is required for -PrepareOpenClawRuntime but was not found on PATH.' }
}

$runtimeEntry = Join-Path $repoRoot 'vendor\openclaw-runtime\current\openclaw.mjs'
if ((-not (Test-Path $runtimeEntry)) -and (-not $PrepareOpenClawRuntime)) {
  throw 'OpenClaw runtime is missing. Re-run with -PrepareOpenClawRuntime, or run pnpm run openclaw:runtime:win-x64 once.'
}

$version = (Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version

Write-Host "Repo:    $repoRoot"
Write-Host "Log:     $logPath"
Write-Host "Version: $version"
Write-Host "Node:    $(& node -v)"
Write-Host "Git:     $(& git --version)"

$buildStart = Get-Date

if ($PrepareOpenClawRuntime) {
  Run-Step 'prepare OpenClaw runtime' { & $pnpm run openclaw:runtime:win-x64 }
}

Run-Step 'generate build keyfrom' { & node scripts/generate-keyfrom-build-info.cjs }
Run-Step 'setup Python runtime'  { & node scripts/setup-python-runtime.js }

if (-not $SkipRendererBuild) {
  Run-Step 'typecheck renderer' { & $tsc }
  Run-Step 'bundle renderer'    { & $vite build }
}

Run-Step 'compile Electron main' { & $tsc --project electron-tsconfig.json }

if (-not $SkipSkills) {
  Run-Step 'build skills' { & npm run build:skills }
}

$builderArgs = @('--win', '--x64', '--config', 'scripts/electron-builder-config.cjs')
if (-not $KeepNativeRebuild) {
  $builderArgs += '--config.npmRebuild=false'
}
Run-Step 'package Windows installer' { & $electronBuilder @builderArgs }

$totalWatch.Stop()
$summary.Add([pscustomobject]@{
  Step = 'total'
  Seconds = [Math]::Round($totalWatch.Elapsed.TotalSeconds, 1)
})

Write-Host ''
Write-Host 'Timing summary:'
$summary | Format-Table -AutoSize

# Verify the build actually produced a fresh installer for this version, so a
# silent packaging failure cannot be mistaken for success.
$releaseDir = Join-Path $repoRoot 'release'
$installer = Get-ChildItem -Path $releaseDir -Recurse -Filter '*.exe' -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -ge $buildStart -and $_.Name -like "*$version*" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $installer) {
  throw "Packaging finished but no fresh installer matching version $version was found in $releaseDir."
}

Write-Host ''
Write-Host "Installer: $($installer.FullName)"
Write-Host ("Size:      {0:N1} MB" -f ($installer.Length / 1MB))
Write-Host "Log:       $logPath"
