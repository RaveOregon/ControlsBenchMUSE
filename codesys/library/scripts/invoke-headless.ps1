param(
    [Parameter(Mandatory = $true)][string]$Script,
    [Parameter(Mandatory = $true)][string]$ResultPointer,
    [int]$TimeoutSeconds = 600,
    [string]$CodesysExe = 'C:\Program Files\CODESYS 3.5.22.30\CODESYS\Common\CODESYS.exe',
    [string]$Profile = 'CODESYS V3.5 SP22 Patch 3',
    [switch]$AllowUnlicensedPluginPrompt
)
# Runs one lane script in its own hidden --noUI CODESYS process. It never attaches
# to, closes or restarts an existing IDE, and the scripts it runs never log in.
$ErrorActionPreference = 'Stop'
$cbLibraryRoot = Split-Path $PSScriptRoot -Parent
$cbScriptPath = (Resolve-Path -LiteralPath $Script).Path
$cbPointer = Join-Path $cbLibraryRoot $ResultPointer
$cbStamp = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH-mm-ss-fffZ')
$cbLaunchDir = Join-Path $cbLibraryRoot "artifacts\launch-$cbStamp"
New-Item -ItemType Directory -Path $cbLaunchDir | Out-Null
$cbStarted = [DateTime]::UtcNow
$cbArguments = @("--profile=`"$Profile`"", "--runscript=`"$cbScriptPath`"", '--noUI')
if (-not $AllowUnlicensedPluginPrompt) { $cbArguments += '--skipunlicensedplugins' }
$cbProcess = Start-Process -FilePath $CodesysExe -WorkingDirectory (Split-Path $CodesysExe -Parent) -ArgumentList $cbArguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $cbLaunchDir 'stdout.log') -RedirectStandardError (Join-Path $cbLaunchDir 'stderr.log')
Write-Host "Headless CODESYS PID $($cbProcess.Id) running $(Split-Path $cbScriptPath -Leaf); no PLC connection."
if (-not $cbProcess.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-Process -Id $cbProcess.Id
    throw "Headless run exceeded $TimeoutSeconds s; stopped only its own process. Logs: $cbLaunchDir"
}
if (-not (Test-Path -LiteralPath $cbPointer)) { throw "CODESYS exited before writing $ResultPointer. Logs: $cbLaunchDir" }
if ((Get-Item -LiteralPath $cbPointer).LastWriteTimeUtc -lt $cbStarted) { throw "Result pointer is from an older invocation. Logs: $cbLaunchDir" }
$cbLatest = Get-Content -LiteralPath $cbPointer -Raw | ConvertFrom-Json
Write-Host "Status: $($cbLatest.status); result directory: $($cbLatest.directory); launch logs: $cbLaunchDir"
if ($cbLatest.status -ne 'pass') { exit 1 }
exit 0
