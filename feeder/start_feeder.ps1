# Start the dsh-fireworks audio feeder (hidden background process).
# Usage:  start_feeder.ps1                       # capture the default device
#         start_feeder.ps1 -Capture "CABLE"      # capture by name substring
param(
  [string]$Capture = "",
  [string]$PythonPath = ""
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$e = [char]0x8033 + [char]0x673A   # headphones (written via codepoints so this file stays pure ASCII)
if ($Capture -eq "") { $Capture = $env:DSH_FW_CAPTURE }
if (-not $Capture) { $Capture = $e }

$stateDir = if ($env:DSH_HOME) { Join-Path $env:DSH_HOME 'fireworks' } else { Join-Path $env:USERPROFILE '.dsh\fireworks' }
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$pidFile = Join-Path $stateDir 'feeder.pid'
$stopFlag = Join-Path $stateDir 'stop.flag'

# stop a previous feeder first (it holds the loopback stream)
if (Test-Path $pidFile) {
  New-Item -ItemType File -Path $stopFlag -Force | Out-Null
  try {
    $old = [int](Get-Content $pidFile -Raw)
    for ($i = 0; $i -lt 30 -and (Get-Process -Id $old -ErrorAction SilentlyContinue); $i++) {
      Start-Sleep -Milliseconds 100
    }
  } catch { }
  Remove-Item $stopFlag, $pidFile -ErrorAction SilentlyContinue
}

$py = if ($PythonPath -and (Test-Path $PythonPath)) { $PythonPath }
      elseif (Test-Path 'D:\tools\miniconda3\python.exe') { 'D:\tools\miniconda3\python.exe' }
      else { 'python' }

$argList = @('-u', (Join-Path $here 'feeder.py'), '--capture-substr', $Capture)
$p = Start-Process -FilePath $py -ArgumentList $argList -WindowStyle Hidden -PassThru `
  -WorkingDirectory $here `
  -RedirectStandardOutput (Join-Path $stateDir 'feeder.log') `
  -RedirectStandardError (Join-Path $stateDir 'feeder.err')
Start-Sleep -Milliseconds 800
if ($p.HasExited) {
  Write-Host "feeder FAILED to start - see $stateDir\feeder.err"
  Get-Content (Join-Path $stateDir 'feeder.err') -ErrorAction SilentlyContinue
} else {
  Write-Host "feeder running: pid $($p.Id), capture '$Capture', state: $stateDir\state.json"
}
