$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-WindowsHost
$runtime = Initialize-WindowsRuntime
$records = @(Get-ChildItem -LiteralPath $runtime.RuntimeDir -Filter 'server-*.json' -File -ErrorAction SilentlyContinue)

if ($records.Count -eq 0) {
  Write-Host '[Xuguang] No Windows background server record was found.'
  exit 0
}

$stopped = 0
foreach ($recordFile in $records) {
  try {
    $record = Get-Content -LiteralPath $recordFile.FullName -Raw | ConvertFrom-Json
    $process = Get-Process -Id ([int]$record.pid) -ErrorAction SilentlyContinue
    if ($process) {
      $actualStart = $process.StartTime.ToUniversalTime()
      $expectedStart = [DateTime]::Parse([string]$record.startedAt).ToUniversalTime()
      if ([Math]::Abs(($actualStart - $expectedStart).TotalSeconds) -lt 2) {
        Stop-Process -Id $process.Id -Force
        $stopped += 1
        Write-Host "[Xuguang] Stopped Windows server PID $($process.Id) on port $($record.port)."
      }
    }
  } catch {
    Write-Warning "Could not process $($recordFile.FullName): $($_.Exception.Message)"
  } finally {
    Remove-Item -LiteralPath $recordFile.FullName -Force -ErrorAction SilentlyContinue
  }
}

if ($stopped -eq 0) {
  Write-Host '[Xuguang] No running Windows background server was found.'
}
