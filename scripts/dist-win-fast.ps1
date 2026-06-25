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

# The renderer bundle exceeds Node's default ~2GB heap and crashes `vite build` with
# "JavaScript heap out of memory". Raise the limit (preserving any caller-provided value).
if (-not $env:NODE_OPTIONS) {
  $env:NODE_OPTIONS = '--max-old-space-size=4096'
} elseif ($env:NODE_OPTIONS -notmatch 'max-old-space-size') {
  $env:NODE_OPTIONS = "$env:NODE_OPTIONS --max-old-space-size=4096"
}

# Stop pnpm from auto-running an install before each `pnpm run`/`pnpm exec`. On Windows
# that implicit install fires `electron-builder install-app-deps`, which then fails to
# spawn pnpm to rebuild native modules ("pnpm.mjs: %1 is not a valid Win32 application").
# Native deps ship working prebuilds and packaging already uses --config.npmRebuild=false,
# so that rebuild is unnecessary here. Run `pnpm install` manually when dependencies change.
$env:npm_config_verify_deps_before_run = 'false'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
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
  if ($command) {
    return $command.Source
  }
  return $null
}

function Find-ApplicationPath([string]$name) {
  $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) {
    return $command.Source
  }
  return $null
}

function Test-Node24 {
  $node = Find-CommandPath 'node'
  if (-not $node) {
    return $false
  }
  $version = & $node -v
  return $version -match '^v24\.'
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

Add-PathIfExists (Join-Path $repoRoot 'node_modules\.bin')
Add-PathIfExists "$env:ProgramFiles\nodejs"
Add-PathIfExists "$env:LOCALAPPDATA\Programs\nodejs"
Add-PathIfExists "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
Add-PathIfExists "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin"
Add-PathIfExists "$env:USERPROFILE\AppData\Roaming\npm"
Add-PathIfExists "$env:ProgramFiles\Git\bin"
Add-PathIfExists "$env:ProgramFiles\Git\cmd"

if (-not (Test-Node24)) {
  throw 'Node.js 24 is required. Install Node 24.x or make it available on PATH.'
}

Assert-Command 'node'
Assert-Command 'git'

$pnpm = Find-ApplicationPath 'pnpm.cmd'
if (-not $pnpm) {
  $pnpm = Find-ApplicationPath 'pnpm.exe'
}
if (-not $pnpm) {
  throw 'Missing required command: pnpm.cmd'
}

$runtimeEntry = Join-Path $repoRoot 'vendor\openclaw-runtime\current\openclaw.mjs'
if (-not (Test-Path $runtimeEntry)) {
  if (-not $PrepareOpenClawRuntime) {
    throw 'OpenClaw runtime is missing. Re-run with -PrepareOpenClawRuntime, or run npm run openclaw:runtime:win-x64 once.'
  }
}

Write-Host "Repo: $repoRoot"
Write-Host "Log:  $logPath"
Write-Host "Node: $(& node -v)"
Write-Host "pnpm: $(& $pnpm -v)"
Write-Host "Git:  $(& git --version)"

if ($PrepareOpenClawRuntime) {
  Run-Step 'prepare OpenClaw runtime' { & $pnpm run openclaw:runtime:win-x64 }
}

Run-Step 'generate build keyfrom' { node scripts/generate-keyfrom-build-info.cjs }
Run-Step 'setup Python runtime' { & $pnpm run setup:python-runtime }

if (-not $SkipRendererBuild) {
  Run-Step 'build renderer' { & $pnpm run build }
}

Run-Step 'compile Electron main' { & $pnpm exec tsc --project electron-tsconfig.json }

if (-not $SkipSkills) {
  Run-Step 'build skills' { & $pnpm run build:skills }
}

$builderArgs = @('--win', '--x64', '--config', 'scripts/electron-builder-config.cjs')
if (-not $KeepNativeRebuild) {
  $builderArgs += '--config.npmRebuild=false'
}
Run-Step 'package Windows installer' { & $pnpm exec electron-builder @builderArgs }

$totalWatch.Stop()
$summary.Add([pscustomobject]@{
  Step = 'total'
  Seconds = [Math]::Round($totalWatch.Elapsed.TotalSeconds, 1)
})

Write-Host ''
Write-Host 'Timing summary:'
$summary | Format-Table -AutoSize

Write-Host ''
Write-Host 'Latest installers:'
Get-ChildItem -Path (Join-Path $repoRoot 'release') -Recurse -Filter '*.exe' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 5 FullName, Length, LastWriteTime |
  Format-Table -AutoSize

Write-Host ''
Write-Host "Log: $logPath"
