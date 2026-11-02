# Recovery authorized in chat after the first paid W4 trial stopped.
# Only the immutable recovery procedure writes. It first inspects through its
# write-refusing gate, then revalidates the exact held state before reconciliation.
$ErrorActionPreference = 'Stop'
# Codex may launch Windows PowerShell from pwsh with a PSModulePath that omits
# Windows PowerShell's bundled modules. Import hashing from this shell explicitly.
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility') -ErrorAction Stop
$w4TaskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$w4Config = Get-Content -LiteralPath (Join-Path $w4TaskRoot 'artifacts/w4-readiness/e3469af/launch.json') -Raw | ConvertFrom-Json
$w4Trial = Join-Path $w4TaskRoot 'artifacts/w4-paid/2026-11-02T13-42-05-152Z/live-host/runs/2026-11-02T18-17-29-951Z-live_plc/portal-host/portal-20261102181837516-1'
$w4ExpectedHeldSha = '311f2f3a2ce6fc3f50b4dcb33b3192a921fb2fa6adfffca94ff139f21c7fc60a'
$w4StatusFile = Join-Path $w4Trial 'authorized-recovery-status.json'
$w4Status = @{ status = 'preparing'; startedAtIso = [DateTimeOffset]::UtcNow.ToString('o'); modelCalls = 0; reference = $w4Trial }
$w4SecretPointer = [IntPtr]::Zero
$w4PreviousUser = $env:OPC_USER
$w4PreviousPassword = $env:OPC_PASSWORD
try {
    if ((Get-FileHash -LiteralPath (Join-Path $w4Trial 'held-state.json') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4ExpectedHeldSha) { throw 'Held record changed; refusing recovery.' }
    if ((& git -C $w4Config.pinnedCheckout rev-parse HEAD).Trim() -ne $w4Config.sourceCommit) { throw 'Immutable recovery checkout moved.' }
    if ((Get-FileHash -LiteralPath $w4Config.proof -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4Config.proofSha256) { throw 'Offline proof changed.' }
    $w4Proof = Get-Content -LiteralPath $w4Config.proof -Raw | ConvertFrom-Json
    foreach ($w4Group in @($w4Proof.sourceHashes, $w4Proof.frozenHashes)) {
        foreach ($w4File in $w4Group.PSObject.Properties) {
            if ((Get-FileHash -LiteralPath (Join-Path $w4Config.pinnedCheckout $w4File.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4File.Value) { throw "Pinned bytes changed: $($w4File.Name)" }
        }
    }
    $w4Status.status = 'awaiting-local-password'
    $w4Status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $w4StatusFile -Encoding UTF8
    $w4Secret = Read-Host 'Recovery CODESYS PLC password (masked; zero model calls)' -AsSecureString
    $w4SecretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($w4Secret)
    $env:OPC_USER = 'PLC'
    $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($w4SecretPointer)
    $w4Recovery = Join-Path $w4Config.pinnedCheckout 'scripts/recover-w4-held.js'
    $w4Args = @($w4Recovery, $w4Trial, '--artifacts', (Split-Path -Parent $w4Trial))
    Push-Location -LiteralPath $w4Config.pinnedCheckout
    try {
        $w4Status.status = 'inspecting'
        $w4Status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $w4StatusFile -Encoding UTF8
        & node @w4Args
        if ($LASTEXITCODE -ne 0) { throw 'Read-only recovery inspection refused; no reconciliation attempted.' }
        $w4Latest = Get-Content -LiteralPath (Join-Path $w4Trial 'recovery-latest.json') -Raw | ConvertFrom-Json
        $w4Inspection = Get-Content -LiteralPath (Join-Path $w4Latest.directory 'result.json') -Raw | ConvertFrom-Json
        $w4Status.inspectionDirectory = $w4Latest.directory
        if ($w4Inspection.status -eq 'no_reconciliation_required') { $w4Status.status = 'no_reconciliation_required' }
        elseif ($w4Inspection.status -eq 'inspected' -and $w4Inspection.classification.supported -and $w4Inspection.heldStateSha256 -eq $w4ExpectedHeldSha) {
            $w4Status.status = 'reconciling'
            $w4Status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $w4StatusFile -Encoding UTF8
            & node @w4Args --reconcile --authorize $w4ExpectedHeldSha
            if ($LASTEXITCODE -ne 0) { throw 'Reconciliation did not pass. No retry; preserve the record and any retained lock.' }
            $w4Final = Get-Content -LiteralPath (Join-Path $w4Trial 'recovery-latest.json') -Raw | ConvertFrom-Json
            $w4Status.status = $w4Final.status
            $w4Status.recoveryDirectory = $w4Final.directory
        } else { throw 'Unexpected inspection result; no reconciliation attempted.' }
    } finally { Pop-Location }
    Write-Host ('Recovery finished: ' + $w4Status.status + '. No model requests were made.')
} catch {
    $w4Status.status = 'refused-or-failed'
    $w4Status.error = $_.Exception.Message
    Write-Host $w4Status.error -ForegroundColor Red
} finally {
    $env:OPC_USER = $w4PreviousUser
    $env:OPC_PASSWORD = $w4PreviousPassword
    if ($w4SecretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($w4SecretPointer) }
    $w4Status.finishedAtIso = [DateTimeOffset]::UtcNow.ToString('o')
    $w4Status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $w4StatusFile -Encoding UTF8
}
