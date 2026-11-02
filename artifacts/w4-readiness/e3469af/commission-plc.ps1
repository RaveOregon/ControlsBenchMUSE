# Zero-model live commissioning entry. Requires the actual HMI and portal observer to be running.
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
# Check the live observer before asking for the commissioning credential.
$w4Identity = Invoke-RestMethod -Uri 'http://127.0.0.1:5191/api/identity' -TimeoutSec 5
$w4Host = Invoke-RestMethod -Uri 'http://127.0.0.1:5190/api/host' -TimeoutSec 5
if ($w4Identity.source.kind -ne 'live_plc') { throw 'HMI source must be the live PLC, not a fixture.' }
if ($w4Host.campaignId) { throw 'The observer portal already has a campaign; use a fresh observer session.' }
if ($w4Host.hmi.state -ne 'observing' -or -not $w4Host.hmi.lastFrame) { throw 'The portal must be capturing the HMI.' }
$w4FrameAge = ([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($w4Host.hmi.lastFrame.capturedAtIso)).TotalMilliseconds
if ($w4FrameAge -lt 0 -or $w4FrameAge -gt 5000) { throw 'The HMI frame is not current.' }
$w4ObserverFile = Join-Path $PSScriptRoot ('observer-load-' + [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH-mm-ss-fffZ') + '.json')
@{ observedAtIso = [DateTimeOffset]::UtcNow.ToString('o'); hmiIdentity = $w4Identity; host = $w4Host } | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $w4ObserverFile -Encoding UTF8
$w4LoadNote = 'Live PLC HMI :5191 and portal :5190; captured session ' + $w4Host.hmi.sessionId + '; pre-run observer witness ' + $w4ObserverFile
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
    # entry, ownership and frozen-project gates; baseline/final inspection remain read-only.
    # The declared commissioning sequence between them writes through the isolated engine.
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $w4Config.pinnedCheckout 'scripts/run-w4-commissioning.ps1') -Run -SkipOfflineGate -LoadNote $w4LoadNote
    if ($LASTEXITCODE -ne 0) { throw 'Commissioning did not pass; preserve its recorded result and held-state evidence. No automatic retry.' }
} finally {
    foreach ($w4Name in $w4Environment.Keys) { [Environment]::SetEnvironmentVariable($w4Name, $w4Previous[$w4Name]) }
}
