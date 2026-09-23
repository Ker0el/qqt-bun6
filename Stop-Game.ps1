$ErrorActionPreference = 'Stop'
$taskPidPath = Join-Path $PSScriptRoot '.runtime/server.pid'
if (-not (Test-Path -LiteralPath $taskPidPath)) { Write-Output 'No managed game server found.'; exit }
$taskPid = [int](Get-Content -LiteralPath $taskPidPath -Raw)
$taskProc = Get-CimInstance Win32_Process -Filter "ProcessId = $taskPid" -ErrorAction SilentlyContinue
$taskServerPath = Join-Path $PSScriptRoot 'server.mjs'
if ($taskProc -and $taskProc.Name -eq 'node.exe' -and $taskProc.CommandLine.Contains($taskServerPath)) {
    Stop-Process -Id $taskPid
    Write-Output 'Game server stopped.'
} else { Write-Output 'Saved server process is not running.' }
