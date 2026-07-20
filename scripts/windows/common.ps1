$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$script:StudioRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$script:NodeExecutable = $null
$script:NpmExecutable = $null

function Assert-WindowsHost {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This script is for native Windows PowerShell. Use npm commands directly on other platforms.'
  }
}

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = @($machinePath, $userPath) -join ';'
}

function Get-NodeVersion {
  param([Parameter(Mandatory = $true)][string]$Executable)

  $raw = (& $Executable -p 'process.versions.node').Trim()
  if ($LASTEXITCODE -ne 0) { return $null }
  try { return [Version]$raw } catch { return $null }
}

function Find-CompatibleNode {
  $candidates = @()
  $pathNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($pathNode) { $candidates += $pathNode.Source }
  if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe') }
  if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe') }
  if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe') }

  foreach ($candidate in @($candidates | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    $version = Get-NodeVersion -Executable $candidate
    if ((-not $version) -or $version -lt [Version]'22.12.0' -or $version -ge [Version]'25.0.0') { continue }
    $npm = Join-Path (Split-Path -Parent $candidate) 'npm.cmd'
    if (-not (Test-Path -LiteralPath $npm -PathType Leaf)) { continue }
    return [PSCustomObject]@{
      Node = $candidate
      Npm = $npm
      Version = $version
    }
  }
  return $null
}

function Install-NodeLts {
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw 'Node.js 22.12-24.x is required. Install Node.js LTS from nodejs.org, reopen this terminal, and run setup-windows.cmd again.'
  }

  Write-Host '[Xuguang] Installing or updating Node.js LTS with winget...'
  & $winget.Source upgrade --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    & $winget.Source install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw 'winget could not install Node.js LTS.' }
  }
  Refresh-ProcessPath
}

function Assert-NodeToolchain {
  param([switch]$InstallIfMissing)

  $toolchain = Find-CompatibleNode
  if (-not $toolchain) {
    if (-not $InstallIfMissing) {
      throw 'Node.js 22.12-24.x is required. Run setup-windows.cmd first.'
    }
    Install-NodeLts
    $toolchain = Find-CompatibleNode
  }

  if (-not $toolchain) {
    throw 'A compatible Node.js installation was not found after setup. Install Node.js 22.12-24.x and run setup-windows.cmd again.'
  }
  $script:NodeExecutable = $toolchain.Node
  $script:NpmExecutable = $toolchain.Npm
  Write-Host "[Xuguang] Node.js $($toolchain.Version) ($($toolchain.Node))"
}

function Invoke-StudioNpm {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  if (-not $script:NpmExecutable) { throw 'Node.js toolchain has not been initialized.' }
  & $script:NpmExecutable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
}

function Initialize-WindowsRuntime {
  $localAppData = [Environment]::GetFolderPath('LocalApplicationData')
  if ([string]::IsNullOrWhiteSpace($localAppData)) {
    $localAppData = Join-Path $env:USERPROFILE 'AppData\Local'
  }
  $documents = [Environment]::GetFolderPath('MyDocuments')
  if ([string]::IsNullOrWhiteSpace($documents)) {
    $documents = Join-Path $env:USERPROFILE 'Documents'
  }

  $appHome = Join-Path $localAppData 'XuguangNovelStudio'
  $dataDir = Join-Path $appHome 'data'
  $runtimeDir = if ([string]::IsNullOrWhiteSpace($env:NOVEL_STUDIO_RUNTIME_DIR)) {
    Join-Path $appHome 'runtime'
  } else {
    [System.IO.Path]::GetFullPath($env:NOVEL_STUDIO_RUNTIME_DIR)
  }
  $libraryRoot = Join-Path $documents 'Xuguang Novel Library'
  New-Item -ItemType Directory -Path $dataDir, $runtimeDir, $libraryRoot -Force | Out-Null

  if ([string]::IsNullOrWhiteSpace($env:NOVEL_STUDIO_DATA_DIR)) {
    $env:NOVEL_STUDIO_DATA_DIR = $dataDir
  }
  if ([string]::IsNullOrWhiteSpace($env:NOVEL_STUDIO_LIBRARY_ROOT)) {
    $env:NOVEL_STUDIO_LIBRARY_ROOT = $libraryRoot
  }

  return [PSCustomObject]@{
    AppHome = $appHome
    DataDir = $env:NOVEL_STUDIO_DATA_DIR
    RuntimeDir = $runtimeDir
    LibraryRoot = $env:NOVEL_STUDIO_LIBRARY_ROOT
  }
}

function Get-StudioHealth {
  param([Parameter(Mandatory = $true)][int]$Port)

  try {
    return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 1
  } catch {
    return $null
  }
}

function Test-PortAvailable {
  param([Parameter(Mandatory = $true)][int]$Port)

  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($listener) { $listener.Stop() }
  }
}

function Find-AvailablePort {
  param(
    [Parameter(Mandatory = $true)][int]$PreferredPort,
    [int]$Attempts = 20
  )

  foreach ($port in $PreferredPort..($PreferredPort + $Attempts - 1)) {
    if (Test-PortAvailable -Port $port) { return $port }
  }
  throw "No free local port was found in range $PreferredPort-$($PreferredPort + $Attempts - 1)."
}

function Resolve-StudioLaunchPort {
  param([Parameter(Mandatory = $true)][int]$PreferredPort)

  foreach ($port in $PreferredPort..($PreferredPort + 19)) {
    $health = Get-StudioHealth -Port $port
    if ($health) {
      $platformProperty = $health.PSObject.Properties['platform']
      if ($health.ok -eq $true -and $health.service -eq 'novel-studio-next' -and $platformProperty -and $platformProperty.Value -eq 'win32') {
        return [PSCustomObject]@{ Port = $port; Reuse = $true }
      }
    }
    if (Test-PortAvailable -Port $port) {
      return [PSCustomObject]@{ Port = $port; Reuse = $false }
    }
  }
  throw "No usable Novel Studio port was found in range $PreferredPort-$($PreferredPort + 19)."
}
