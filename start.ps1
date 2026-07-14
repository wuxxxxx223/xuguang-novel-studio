param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$healthUrl = 'http://127.0.0.1:8790/api/health'
$appUrl = 'http://127.0.0.1:8790/'
$dataDir = Join-Path $PSScriptRoot '.data'

function Test-XuguangHealth {
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
    return $health.ok -eq $true -and $health.service -eq 'novel-studio-next'
  } catch {
    return $false
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
  Write-Host '[Xuguang] Installing dependencies...'
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
}

Write-Host '[Xuguang] Building the web app...'
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'npm run build failed.' }

if (-not (Test-XuguangHealth)) {
  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $stdout = Join-Path $dataDir 'server-8790.out.log'
  $stderr = Join-Path $dataDir 'server-8790.err.log'
  Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
  $process = Start-Process -FilePath $node -ArgumentList 'server/index.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  Set-Content -LiteralPath (Join-Path $dataDir 'server-8790.pid') -Value $process.Id -Encoding ascii

  $ready = $false
  foreach ($attempt in 1..40) {
    Start-Sleep -Milliseconds 250
    if (Test-XuguangHealth) { $ready = $true; break }
    if ($process.HasExited) { break }
  }
  if (-not $ready) {
    $detail = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw } else { 'No server error log was produced.' }
    throw "Xuguang server failed to start on 127.0.0.1:8790.`n$detail"
  }
}

Write-Host "[Xuguang] Ready: $appUrl"
if (-not $NoBrowser) {
  Start-Process $appUrl | Out-Null
}
