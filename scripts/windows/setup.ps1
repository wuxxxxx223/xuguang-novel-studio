param(
  [switch]$NoLaunch,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-WindowsHost
Assert-NodeToolchain -InstallIfMissing
Set-Location -LiteralPath $script:StudioRoot
$runtime = Initialize-WindowsRuntime

Write-Host '[Xuguang] Installing locked dependencies...'
Invoke-StudioNpm -Arguments @('ci')

if (-not $SkipBuild) {
  Write-Host '[Xuguang] Building the web app...'
  Invoke-StudioNpm -Arguments @('run', 'build')
}

Write-Host '[Xuguang] Windows setup complete.'
Write-Host "[Xuguang] Data: $($runtime.DataDir)"
Write-Host "[Xuguang] Library: $($runtime.LibraryRoot)"

if (-not $NoLaunch) {
  & (Join-Path $script:StudioRoot 'start.ps1') -SkipBuild
}
