param([Parameter(Mandatory=$true)][string]$RecoverFrom,[switch]$ClearedContradiction)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility') -ErrorAction Stop
$w4Root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$w4Trial=(Resolve-Path -LiteralPath $RecoverFrom).Path
$w4Record=Get-Content -LiteralPath (Join-Path $w4Trial 'result.json') -Raw|ConvertFrom-Json
$w4Sha=(Get-FileHash -LiteralPath (Join-Path $w4Trial 'held-state.json') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($w4Record.status -ne 'held' -or $w4Record.heldState.sha256 -ne $w4Sha) { throw 'Exact closed campaign record required.' }
$w4Status=@{status='awaiting-password';modelCalls=0;heldStateSha256=$w4Sha}
$w4Kind='feedback-loss';$w4Flag='--feedback-loss';$w4Prompt='Fault-12 bench cleanup PLC password (masked; zero model calls)'
if($ClearedContradiction){$w4Kind='cleared-contradiction';$w4Flag='--cleared-contradiction';$w4Prompt='Cleared D1 fault cleanup PLC password (masked; zero model calls)'}
$w4StatusFile=Join-Path $w4Trial ($w4Kind+'-recovery-status.json')
$w4Status|ConvertTo-Json|Set-Content -LiteralPath $w4StatusFile -Encoding UTF8
$w4Before=@{};foreach($w4Name in @('OPC_USER','OPC_PASSWORD','CONTROLSBENCH_W4_LAUNCH_CONFIG')){$w4Before[$w4Name]=[Environment]::GetEnvironmentVariable($w4Name)}
$w4Ptr=[IntPtr]::Zero
try {
    $w4Secret=Read-Host $w4Prompt -AsSecureString
    $w4Ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($w4Secret)
    $env:OPC_USER='PLC';$env:OPC_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($w4Ptr)
    $env:CONTROLSBENCH_W4_LAUNCH_CONFIG=Join-Path $w4Root 'artifacts/w4-readiness/retry-62a1d8c/launch.json'
    Push-Location -LiteralPath $w4Root
    try {
        & node scripts/w4-paid/recover-completed-hold.mjs $w4Trial $w4Flag
        if ($LASTEXITCODE -ne 0) { throw 'Read-only fault-12 inspection refused; no cleanup writes.' }
        $w4Inspection=Get-Content -LiteralPath (Join-Path $w4Trial ($w4Kind+'-recovery-latest.json')) -Raw|ConvertFrom-Json
        $w4Status.inspectionDirectory=$w4Inspection.directory
        & node scripts/w4-paid/recover-completed-hold.mjs $w4Trial $w4Flag --reconcile --authorize $w4Sha
        if ($LASTEXITCODE -ne 0) { throw 'Cleanup failed; preserve evidence and lock. No automatic retry.' }
        $w4Final=Get-Content -LiteralPath (Join-Path $w4Trial ($w4Kind+'-recovery-latest.json')) -Raw|ConvertFrom-Json
        $w4Status.status=$w4Final.status;$w4Status.recoveryDirectory=$w4Final.directory
    } finally {Pop-Location}
} catch {$w4Status.status='refused-or-failed';$w4Status.error=$_.Exception.Message;Write-Host $w4Status.error -ForegroundColor Red}
finally {
    foreach($w4Name in $w4Before.Keys){[Environment]::SetEnvironmentVariable($w4Name,$w4Before[$w4Name])}
    if ($w4Ptr -ne [IntPtr]::Zero) {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($w4Ptr)}
    $w4Status.finishedAtIso=[DateTimeOffset]::UtcNow.ToString('o')
    $w4Status|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $w4StatusFile -Encoding UTF8
}
