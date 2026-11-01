param(
    [string]$CodesysExe = 'C:\Program Files\CODESYS 3.5.22.30\CODESYS\Common\CODESYS.exe',
    [string]$Profile = 'CODESYS V3.5 SP22 Patch 3'
)
$ErrorActionPreference = 'Stop'
$cbLibraryRoot = Split-Path $PSScriptRoot -Parent
$cbScript = Join-Path $PSScriptRoot 'build-library.py'
$cbLaunchStamp = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH-mm-ss-fffZ')
$cbLaunchDir = Join-Path $cbLibraryRoot "artifacts\launch-$cbLaunchStamp"
New-Item -ItemType Directory -Path $cbLaunchDir | Out-Null
$cbStarted = [DateTime]::UtcNow
# Start-Process uses Windows command-line quoting, not a PowerShell script string.
$cbArguments = @("--profile=`"$Profile`"", "--runscript=`"$cbScript`"", '--noUI', '--skipunlicensedplugins')
$cbProcess = Start-Process -FilePath $CodesysExe -WorkingDirectory (Split-Path $CodesysExe -Parent) -ArgumentList $cbArguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $cbLaunchDir 'stdout.log') -RedirectStandardError (Join-Path $cbLaunchDir 'stderr.log')
Write-Host "Offline CODESYS library build PID $($cbProcess.Id); no PLC connection."
if (-not $cbProcess.WaitForExit(240000)) {
    Stop-Process -Id $cbProcess.Id
    throw "Offline build exceeded four minutes; stopped only its own process. Logs: $cbLaunchDir"
}
$cbLatestFile = Join-Path $cbLibraryRoot 'artifacts\latest.json'
if (-not (Test-Path -LiteralPath $cbLatestFile)) { throw "CODESYS exited before writing a result. Logs: $cbLaunchDir" }
if ((Get-Item -LiteralPath $cbLatestFile).LastWriteTimeUtc -lt $cbStarted) { throw "Build result is from an older invocation. Logs: $cbLaunchDir" }
$cbLatest = Get-Content -LiteralPath $cbLatestFile -Raw | ConvertFrom-Json
if ($cbLatest.status -ne 'pass') { throw "Library build failed. Result: $($cbLatest.directory)\result.json" }
Write-Host "Built library and independent consumers: $($cbLatest.directory)"
