param(
  [int]$ApiPort = 8790,
  [int]$WebPort = 5178
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-WindowsHost
Assert-NodeToolchain
Set-Location -LiteralPath $script:StudioRoot
$runtime = Initialize-WindowsRuntime

if (-not (Test-Path -LiteralPath (Join-Path $script:StudioRoot 'node_modules'))) {
  Write-Host '[Xuguang] Installing dependencies...'
  Invoke-StudioNpm -Arguments @('ci')
}

$selectedApiPort = Find-AvailablePort -PreferredPort $ApiPort
$selectedWebPort = Find-AvailablePort -PreferredPort $WebPort
$env:NODE_ENV = 'development'
$env:PORT = [string]$selectedApiPort
$env:NOVEL_STUDIO_API_PROXY = "http://127.0.0.1:$selectedApiPort"
$env:NOVEL_STUDIO_WEB_PORT = [string]$selectedWebPort

Write-Host "[Xuguang] Development UI: http://127.0.0.1:$selectedWebPort/"
Write-Host "[Xuguang] Development API: http://127.0.0.1:$selectedApiPort/"
Write-Host "[Xuguang] Data: $($runtime.DataDir)"
Write-Host "[Xuguang] Library: $($runtime.LibraryRoot)"
Write-Host '[Xuguang] Press Ctrl+C to stop development servers.'

$viteEntry = Join-Path $script:StudioRoot 'node_modules\vite\bin\vite.js'
$apiProcess = Start-Process -FilePath $script:NodeExecutable -ArgumentList @('--watch', 'server/index.mjs') -WorkingDirectory $script:StudioRoot -NoNewWindow -PassThru
$webProcess = Start-Process -FilePath $script:NodeExecutable -ArgumentList @("`"$viteEntry`"") -WorkingDirectory $script:StudioRoot -NoNewWindow -PassThru

try {
  while (-not $apiProcess.HasExited -and -not $webProcess.HasExited) {
    Start-Sleep -Milliseconds 500
  }
  if ($apiProcess.HasExited) {
    throw "Windows development API exited with code $($apiProcess.ExitCode)."
  }
  throw "Windows Vite server exited with code $($webProcess.ExitCode)."
} finally {
  foreach ($process in @($apiProcess, $webProcess)) {
    if ($process -and -not $process.HasExited) {
      & taskkill.exe /PID $process.Id /T /F | Out-Null
    }
  }
}
