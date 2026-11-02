# Stop the dsh-fireworks audio feeder and clean up its flags.
$ErrorActionPreference = 'SilentlyContinue'
$stateDir = if ($env:DSH_HOME) { Join-Path $env:DSH_HOME 'fireworks' } else { Join-Path $env:USERPROFILE '.dsh\fireworks' }
$pidFile = Join-Path $stateDir 'feeder.pid'
$stopFlag = Join-Path $stateDir 'stop.flag'

New-Item -ItemType File -Path $stopFlag -Force | Out-Null
if (Test-Path $pidFile) {
  try {
    $old = [int](Get-Content $pidFile -Raw)
    for ($i = 0; $i -lt 30 -and (Get-Process -Id $old -ErrorAction SilentlyContinue); $i++) {
      Start-Sleep -Milliseconds 100
    }
  } catch { }
}
Remove-Item $stopFlag, $pidFile -ErrorAction SilentlyContinue
Write-Host "feeder stopped"
