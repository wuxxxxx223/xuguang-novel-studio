param(
  [switch]$NoBrowser,
  [switch]$SkipBuild,
  [int]$Port = 8790
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scripts\windows\common.ps1')
Assert-WindowsHost
Assert-NodeToolchain
Set-Location -LiteralPath $script:StudioRoot
$runtime = Initialize-WindowsRuntime

if (-not (Test-Path -LiteralPath (Join-Path $script:StudioRoot 'node_modules'))) {
  Write-Host '[Xuguang] Installing dependencies...'
  Invoke-StudioNpm -Arguments @('ci')
}

if (-not $SkipBuild) {
  Write-Host '[Xuguang] Building the web app...'
  Invoke-StudioNpm -Arguments @('run', 'build')
}

$target = Resolve-StudioLaunchPort -PreferredPort $Port
$appUrl = "http://127.0.0.1:$($target.Port)/"

if (-not $target.Reuse) {
  $env:NODE_ENV = 'production'
  $env:NOVEL_STUDIO_LOG_FORMAT = 'pretty'
  $env:PORT = [string]$target.Port
  $node = $script:NodeExecutable
  $stdout = Join-Path $runtime.RuntimeDir "server-$($target.Port).out.log"
  $stderr = Join-Path $runtime.RuntimeDir "server-$($target.Port).err.log"
  $processFile = Join-Path $runtime.RuntimeDir "server-$($target.Port).json"
  Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
  $process = Start-Process -FilePath $node -ArgumentList 'server/index.mjs' -WorkingDirectory $script:StudioRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  @{
    pid = $process.Id
    port = $target.Port
    startedAt = $process.StartTime.ToUniversalTime().ToString('o')
    studioRoot = $script:StudioRoot
  } | ConvertTo-Json | Set-Content -LiteralPath $processFile -Encoding utf8

  $ready = $false
  foreach ($attempt in 1..40) {
    Start-Sleep -Milliseconds 250
    $health = Get-StudioHealth -Port $target.Port
    if ($health -and $health.ok -eq $true -and $health.platform -eq 'win32') { $ready = $true; break }
    if ($process.HasExited) { break }
  }
  if (-not $ready) {
    $detail = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw } else { 'No server error log was produced.' }
    throw "Xuguang server failed to start on 127.0.0.1:$($target.Port).`n$detail"
  }
}

Write-Host "[Xuguang] Ready: $appUrl"
Write-Host "[Xuguang] Data: $($runtime.DataDir)"
Write-Host "[Xuguang] Library: $($runtime.LibraryRoot)"
if (-not $NoBrowser) {
  Start-Process $appUrl | Out-Null
}
