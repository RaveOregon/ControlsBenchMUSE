# Invoke the original immutable recovery with this campaign's exact held record.
param([Parameter(Mandatory=$true)][string]$RecoverFrom)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility') -ErrorAction Stop
$w4Root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$w4Config=Get-Content -LiteralPath (Join-Path $w4Root 'artifacts/w4-readiness/e3469af/launch.json') -Raw | ConvertFrom-Json
$w4Trial=(Resolve-Path -LiteralPath $RecoverFrom).Path
if (-not $w4Trial.StartsWith((Join-Path $w4Root 'artifacts/w4-paid/'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Recovery must refer to a saved paid-trial directory.' }
$w4Prior=Get-Content -LiteralPath (Join-Path $w4Trial 'result.json') -Raw | ConvertFrom-Json
$w4Sha=(Get-FileHash -LiteralPath (Join-Path $w4Trial 'held-state.json') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($w4Prior.status -ne 'held' -or $w4Sha -ne $w4Prior.heldState.sha256) { throw 'Exact held record required.' }
if ((& git -C $w4Config.pinnedCheckout rev-parse HEAD).Trim() -ne $w4Config.sourceCommit) { throw 'Recovery source checkout moved.' }
if ((Get-FileHash -LiteralPath $w4Config.proof -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4Config.proofSha256) { throw 'Offline proof changed.' }
$w4Proof=Get-Content -LiteralPath $w4Config.proof -Raw | ConvertFrom-Json
foreach($w4Group in @($w4Proof.sourceHashes,$w4Proof.frozenHashes)) { foreach($w4File in $w4Group.PSObject.Properties) {
    if ((Get-FileHash -LiteralPath (Join-Path $w4Config.pinnedCheckout $w4File.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4File.Value) { throw "Pinned recovery bytes changed: $($w4File.Name)" }
} }
$w4Status=@{status='awaiting-local-password';reference=$w4Trial;heldStateSha256=$w4Sha;modelCalls=0}
$w4StatusPath=Join-Path $w4Trial 'native-recovery-status.json'
$w4Status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $w4StatusPath -Encoding UTF8
$w4Ptr=[IntPtr]::Zero;$w4BeforeUser=$env:OPC_USER;$w4BeforePassword=$env:OPC_PASSWORD
try {
    $w4Secret=Read-Host 'Bench recovery PLC password (masked; zero model calls)' -AsSecureString
    $w4Ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($w4Secret)
    $env:OPC_USER='PLC';$env:OPC_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($w4Ptr)
    $w4Args=@((Join-Path $w4Config.pinnedCheckout 'scripts/recover-w4-held.js'),$w4Trial,'--artifacts',(Split-Path -Parent $w4Trial))
    Push-Location -LiteralPath $w4Config.pinnedCheckout
    try {
        & node @w4Args
        if ($LASTEXITCODE -ne 0) { throw 'Native read-only recovery inspection refused; no write attempted.' }
        $w4Inspected=Get-Content -LiteralPath (Join-Path $w4Trial 'recovery-latest.json') -Raw | ConvertFrom-Json
        $w4Status.inspectionDirectory=$w4Inspected.directory
        if ($w4Inspected.status -eq 'no_reconciliation_required') { $w4Status.status='no_reconciliation_required' }
        elseif ($w4Inspected.status -eq 'inspected') {
            & node @w4Args --reconcile --authorize $w4Sha
            if ($LASTEXITCODE -ne 0) { throw 'Native recovery failed; preserve evidence and ownership. No retry.' }
            $w4Final=Get-Content -LiteralPath (Join-Path $w4Trial 'recovery-latest.json') -Raw | ConvertFrom-Json
            $w4Status.status=$w4Final.status;$w4Status.recoveryDirectory=$w4Final.directory
        } else { throw 'Unexpected recovery inspection status.' }
    } finally { Pop-Location }
} catch { $w4Status.status='refused-or-failed';$w4Status.error=$_.Exception.Message;Write-Host $w4Status.error -ForegroundColor Red }
finally {
    $env:OPC_USER=$w4BeforeUser;$env:OPC_PASSWORD=$w4BeforePassword
    if ($w4Ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($w4Ptr) }
    $w4Status.finishedAtIso=[DateTimeOffset]::UtcNow.ToString('o')
    $w4Status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $w4StatusPath -Encoding UTF8
}
