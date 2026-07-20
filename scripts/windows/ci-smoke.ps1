param(
  [int]$BackgroundPort = 8790,
  [int]$DevApiPort = 8890,
  [int]$DevWebPort = 5190
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-WindowsHost
Assert-NodeToolchain
Set-Location -LiteralPath $script:StudioRoot
$runtime = Initialize-WindowsRuntime
$backgroundTestPort = Find-AvailablePort -PreferredPort $BackgroundPort
$devApiTestPort = Find-AvailablePort -PreferredPort $DevApiPort
$devWebTestPort = Find-AvailablePort -PreferredPort $DevWebPort

function Wait-ForHealth {
  param([Parameter(Mandatory = $true)][int]$Port)

  foreach ($attempt in 1..60) {
    Start-Sleep -Milliseconds 500
    $health = Get-StudioHealth -Port $Port
    if ($health) {
      $platformProperty = $health.PSObject.Properties['platform']
      if ($health.ok -eq $true -and $platformProperty -and $platformProperty.Value -eq 'win32') {
        return $health
      }
    }
  }
  throw "Windows API did not become ready on port $Port."
}

try {
  & (Join-Path $script:StudioRoot 'start.ps1') -NoBrowser -SkipBuild -Port $backgroundTestPort
  $backgroundHealth = Wait-ForHealth -Port $backgroundTestPort
  Write-Host "[Xuguang] Background launcher smoke passed on $backgroundTestPort ($($backgroundHealth.platform))."
} finally {
  & (Join-Path $PSScriptRoot 'stop.ps1')
}

$stdout = Join-Path $runtime.RuntimeDir 'dev-smoke.out.log'
$stderr = Join-Path $runtime.RuntimeDir 'dev-smoke.err.log'
Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
$devProcess = Start-Process -FilePath powershell.exe -ArgumentList @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', (Join-Path $PSScriptRoot 'dev.ps1'),
  '-ApiPort', [string]$devApiTestPort,
  '-WebPort', [string]$devWebTestPort
) -WorkingDirectory $script:StudioRoot -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

try {
  $devHealth = Wait-ForHealth -Port $devApiTestPort
  $webReady = $false
  foreach ($attempt in 1..30) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$devWebTestPort/" -TimeoutSec 1
      if ($response.StatusCode -eq 200) {
        $webReady = $true
        break
      }
    } catch {}
    if ($devProcess.HasExited) { break }
  }
  if (-not $webReady) {
    $detail = @(
      (Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue),
      (Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue)
    ) -join [Environment]::NewLine
    throw "Windows development UI did not become ready on port $devWebTestPort.$([Environment]::NewLine)$detail"
  }
  Write-Host "[Xuguang] Development smoke passed: API $devApiTestPort ($($devHealth.platform)), UI $devWebTestPort."
} finally {
  if (-not $devProcess.HasExited) {
    & taskkill.exe /PID $devProcess.Id /T /F | Out-Null
  }
}
