# Prepared read-only commissioning entry. No model, PLC write or recovery action.
$ErrorActionPreference = 'Stop'
$w4Config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'launch.json') -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $w4Config.manifest -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4Config.manifestSha256) { throw 'Manifest bytes changed.' }
if ((Get-FileHash -LiteralPath $w4Config.proof -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4Config.proofSha256) { throw 'Offline proof bytes changed.' }
$w4Proof = Get-Content -LiteralPath $w4Config.proof -Raw | ConvertFrom-Json
if ($w4Proof.status -ne 'pass' -or $w4Proof.sourceCommit -ne $w4Config.sourceCommit) { throw 'Expected passing source-bound proof.' }
$w4Head = (& git -C $w4Config.pinnedCheckout rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $w4Head -ne $w4Config.sourceCommit) { throw 'Pinned checkout moved.' }
foreach ($w4Group in @($w4Proof.sourceHashes, $w4Proof.frozenHashes)) {
    foreach ($w4File in $w4Group.PSObject.Properties) {
        $w4Actual = (Get-FileHash -LiteralPath (Join-Path $w4Config.pinnedCheckout $w4File.Name) -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($w4Actual -ne $w4File.Value) { throw "Pinned file differs from tested bytes: $($w4File.Name)" }
    }
}
$w4Environment = @{
    CONTROLSBENCH_WONDER_PROCESS_COMMIT = $w4Config.sourceCommit
    CONTROLSBENCH_WONDER_HANDOFF = $w4Config.manifest
    CONTROLSBENCH_WONDER_HANDOFF_SHA256 = $w4Config.manifestSha256
}
$w4Previous = @{}
try {
    foreach ($w4Name in $w4Environment.Keys) {
        $w4Previous[$w4Name] = [Environment]::GetEnvironmentVariable($w4Name)
        [Environment]::SetEnvironmentVariable($w4Name, $w4Environment[$w4Name])
    }
    # The exact pinned source has already passed the offline union. The wrapper retains all
    # entry, ownership, frozen-project and read-only gates and prompts locally for the password.
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $w4Config.pinnedCheckout 'scripts/run-w4-commissioning.ps1') -Inspect -SkipOfflineGate
    if ($LASTEXITCODE -ne 0) { throw 'Read-only inspection did not pass; preserve its recorded result.' }
} finally {
    foreach ($w4Name in $w4Environment.Keys) { [Environment]::SetEnvironmentVariable($w4Name, $w4Previous[$w4Name]) }
}
