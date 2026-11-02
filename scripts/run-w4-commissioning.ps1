# W4 zero-model commissioning and W4 held-state recovery with a masked OPC credential prompt.
# The password exists only in this process's memory and in the environment of the one node process
# it starts; it is cleared on every exit path and never written to evidence or logs.
#
#   Read-only baseline:  scripts/run-w4-commissioning.ps1 -Inspect
#   Commissioning run:   scripts/run-w4-commissioning.ps1 -Run [-ModuleCheckout <pinned checkout>] [-LoadNote '<portal/HMI state>']
#   Held-state review:   scripts/run-w4-commissioning.ps1 -RecoverFrom <run directory>
#   Reconciliation:      scripts/run-w4-commissioning.ps1 -RecoverFrom <run directory> -Reconcile -Authorize <held-state sha256>
#
# -Run requires CONTROLSBENCH_WONDER_PROCESS_COMMIT, CONTROLSBENCH_WONDER_HANDOFF and
# CONTROLSBENCH_WONDER_HANDOFF_SHA256 in the environment (the reviewed W4 manifest), as the adapter does.
param([switch]$Inspect, [switch]$Run, [string]$RecoverFrom, [switch]$Reconcile, [string]$Authorize, [string]$ModuleCheckout,
      [string]$LoadNote, [string]$OpcUser = 'PLC', [switch]$SkipOfflineGate)
$ErrorActionPreference = 'Stop'
$selected = @($Inspect.IsPresent, $Run.IsPresent, [bool]$RecoverFrom) | Where-Object { $_ }
if ($selected.Count -ne 1) { throw 'Choose exactly one of -Inspect, -Run or -RecoverFrom <run directory>.' }
if ($Reconcile -and -not $RecoverFrom) { throw '-Reconcile applies only with -RecoverFrom.' }
if ($Reconcile -and -not $Authorize) { throw '-Reconcile requires -Authorize <held-state.json SHA-256> from the reviewed inspection.' }
Push-Location (Join-Path $PSScriptRoot '..')
try {
    if (-not $SkipOfflineGate) {
        & npm.cmd run typecheck
        if ($LASTEXITCODE -ne 0) { throw 'Type checking failed; no PLC contact.' }
        & node --test --test-concurrency=1 test/w4-commissioning.test.ts
        if ($LASTEXITCODE -ne 0) { throw 'Offline commissioning tests failed; no PLC contact.' }
    }
    $w4Secret = Read-Host 'W4 CODESYS PLC password (masked)' -AsSecureString
    $w4SecretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($w4Secret)
    try {
        $env:OPC_USER = $OpcUser
        $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($w4SecretPtr)
        if ($RecoverFrom) {
            $nodeArgs = @((Join-Path $PSScriptRoot 'recover-w4-held.js'), $RecoverFrom)
            if ($Reconcile) { $nodeArgs += @('--reconcile', '--authorize', $Authorize) }
        } else {
            $nodeArgs = @((Join-Path $PSScriptRoot 'run-w4-commissioning.js'))
            if ($Inspect) { $nodeArgs += '--inspect-only' }
            if ($ModuleCheckout) { $nodeArgs += @('--module', $ModuleCheckout) }
            if ($LoadNote) { $nodeArgs += @('--load-note', $LoadNote) }
        }
        & node @nodeArgs
        $w4ExitCode = $LASTEXITCODE
    }
    finally {
        Remove-Item Env:OPC_USER -ErrorAction SilentlyContinue
        Remove-Item Env:OPC_PASSWORD -ErrorAction SilentlyContinue
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($w4SecretPtr)
    }
    if ($w4ExitCode -ne 0) { throw 'W4 step did not pass. Preserve the evidence; review held-state.json or the recovery result before any further step. No automatic retry.' }
}
finally { Pop-Location }
