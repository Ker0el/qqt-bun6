param([int]$Port = 8787, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskLogRoot = Join-Path $taskRoot '.runtime'
New-Item -ItemType Directory -Path $taskLogRoot -Force | Out-Null
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskUrl = "http://localhost:$Port"
$taskRunning = $false
try {
    $taskInfo = Invoke-RestMethod -Uri "$taskUrl/api/info" -TimeoutSec 2
    $taskRunning = $taskInfo.game -eq 'qqt-bun6-local'
} catch { }
if (-not $taskRunning) {
    if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'node_modules/ws/package.json'))) {
        Push-Location -LiteralPath $taskRoot
        try { & npm.cmd ci --omit=dev --ignore-scripts --no-fund --no-audit; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' } }
        finally { Pop-Location }
    }
    $env:PORT = "$Port"
    $taskServerPath = Join-Path $taskRoot 'server.mjs'
    $taskProcess = Start-Process -FilePath $taskNode -ArgumentList ('"' + $taskServerPath + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskLogRoot 'server.log') -RedirectStandardError (Join-Path $taskLogRoot 'server-error.log')
    Set-Content -LiteralPath (Join-Path $taskLogRoot 'server.pid') -Value $taskProcess.Id
    for ($taskAttempt = 0; $taskAttempt -lt 50; $taskAttempt++) {
        Start-Sleep -Milliseconds 100
        try { $taskInfo = Invoke-RestMethod -Uri "$taskUrl/api/info" -TimeoutSec 1; $taskRunning = $taskInfo.game -eq 'qqt-bun6-local'; if ($taskRunning) { break } } catch { }
    }
    if (-not $taskRunning) { throw "Server did not start. See $taskLogRoot/server-error.log" }
}
Write-Output "QQ Tang is running: $taskUrl"
if (-not $NoBrowser) { Start-Process $taskUrl }
