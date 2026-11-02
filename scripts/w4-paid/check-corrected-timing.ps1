# Zero-model timing check. Replaces the terminal paid host with a fresh read-only
# observer running from the immutable checkout; commissioning owns all PLC writes.
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Management') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules/CimCmdlets') -ErrorAction Stop
$w4Root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$w4Config = Get-Content -LiteralPath (Join-Path $w4Root 'artifacts/w4-readiness/e3469af/launch.json') -Raw | ConvertFrom-Json
$w4Trial = Join-Path $w4Root 'artifacts/w4-paid/2026-11-02T13-42-05-152Z/live-host/runs/2026-11-02T18-17-29-951Z-live_plc/portal-host/portal-20261102181837516-1'
$w4Evidence = Join-Path $w4Root ('artifacts/w4-paid/timing-' + [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH-mm-ss-fffZ'))
New-Item -ItemType Directory -Path $w4Evidence | Out-Null
$w4Status = @{ status = 'preparing'; modelCalls = 0; directory = $w4Evidence }
$w4SecretPtr = [IntPtr]::Zero
$w4Names = @('OPC_USER','OPC_PASSWORD','CONTROLSBENCH_WONDER_PROCESS_COMMIT','CONTROLSBENCH_WONDER_HANDOFF','CONTROLSBENCH_WONDER_HANDOFF_SHA256','CONTROLSBENCH_HMI_BROWSER')
$w4Previous = @{}
foreach ($w4Name in $w4Names) { $w4Previous[$w4Name] = [Environment]::GetEnvironmentVariable($w4Name) }
try {
    $w4Recovery = Get-Content -LiteralPath (Join-Path $w4Trial 'authorized-recovery-status.json') -Raw | ConvertFrom-Json
    if ($w4Recovery.status -ne 'pass') { throw 'Recorded recovery must pass first.' }
    if (Test-Path -LiteralPath (Join-Path $w4Root '../../artifacts/m10/live.lock')) { throw 'Another writer owns the runtime.' }
    if ((& git -C $w4Config.pinnedCheckout rev-parse HEAD).Trim() -ne $w4Config.sourceCommit) { throw 'Immutable checkout moved.' }
    if ((Get-FileHash -LiteralPath $w4Config.proof -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4Config.proofSha256) { throw 'Proof changed.' }
    $w4Proof = Get-Content -LiteralPath $w4Config.proof -Raw | ConvertFrom-Json
    foreach ($w4Group in @($w4Proof.sourceHashes,$w4Proof.frozenHashes)) {
        foreach ($w4File in $w4Group.PSObject.Properties) {
            if ((Get-FileHash -LiteralPath (Join-Path $w4Config.pinnedCheckout $w4File.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4File.Value) { throw "Pinned bytes changed: $($w4File.Name)" }
        }
    }
    $w4Host = Invoke-RestMethod 'http://127.0.0.1:5190/api/host' -TimeoutSec 5
    $w4Report = Invoke-RestMethod 'http://127.0.0.1:5190/api/campaign/report' -TimeoutSec 5
    if ($w4Host.campaignId -ne 'portal-20261102181837516-1' -or $w4Report.status -ne 'stopped') { throw 'Expected the exact terminal paid host; refusing replacement.' }
    # Pin the host process identity before allowing its shutdown. The controlled
    # capture is disconnected through its own host API, closing its Chrome process.
    $w4OldHost = Get-CimInstance Win32_Process -Filter 'ProcessId = 15728'
    if (-not $w4OldHost -or $w4OldHost.Name -ne 'node.exe' -or $w4OldHost.CommandLine -notlike '*w4-commissioning-pin*run-hmi-portal.js*') { throw 'Old host process identity changed.' }
    $w4Status.status = 'awaiting-local-password'
    $w4Status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $w4Evidence 'status.json') -Encoding UTF8
    $w4Secret = Read-Host 'Zero-model timing check PLC password (masked)' -AsSecureString
    $w4SecretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($w4Secret)
    $env:OPC_USER = 'PLC'
    $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($w4SecretPtr)
    $w4Disconnect = @{ contractVersion=1; requestId=('timing-disconnect-' + [DateTime]::UtcNow.Ticks); type='disconnect_hmi'; payload=@{} } | ConvertTo-Json
    Invoke-RestMethod 'http://127.0.0.1:5190/api/commands' -Method Post -ContentType 'application/json' -Body $w4Disconnect | Out-Null
    $w4Deadline = [DateTime]::UtcNow.AddSeconds(15)
    do { Start-Sleep -Milliseconds 250; $w4Host = Invoke-RestMethod 'http://127.0.0.1:5190/api/host' -TimeoutSec 5 } while ($w4Host.hmi.state -ne 'disconnected' -and [DateTime]::UtcNow -lt $w4Deadline)
    if ($w4Host.hmi.state -ne 'disconnected') { throw 'Capture did not close; old host was not stopped.' }
    Stop-Process -Id $w4OldHost.ProcessId -ErrorAction Stop
    Start-Sleep -Milliseconds 1000
    $env:CONTROLSBENCH_HMI_BROWSER = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
    $env:CONTROLSBENCH_WONDER_PROCESS_COMMIT = $w4Config.sourceCommit
    $env:CONTROLSBENCH_WONDER_HANDOFF = $w4Config.manifest
    $env:CONTROLSBENCH_WONDER_HANDOFF_SHA256 = $w4Config.manifestSha256
    $w4HostArgs = @((Join-Path $w4Config.pinnedCheckout 'scripts/run-hmi-portal.js'),'--live','--campaign','m8','--portal-port','5190','--hmi-port','5191','--hmi-headless','--commands','disabled','--artifacts',(Join-Path $w4Evidence 'observer'))
    $w4Observer = Start-Process -FilePath 'node.exe' -ArgumentList $w4HostArgs -WorkingDirectory $w4Config.pinnedCheckout -WindowStyle Hidden -RedirectStandardOutput (Join-Path $w4Evidence 'observer.stdout.txt') -RedirectStandardError (Join-Path $w4Evidence 'observer.stderr.txt') -PassThru
    $w4Status.observerPid = $w4Observer.Id
    $w4Deadline = [DateTime]::UtcNow.AddSeconds(60)
    do {
        Start-Sleep -Milliseconds 500
        if ($w4Observer.HasExited) { throw 'Corrected observer exited; inspect its saved log.' }
        try { $w4Host = Invoke-RestMethod 'http://127.0.0.1:5190/api/host' -TimeoutSec 2 } catch { $w4Host = $null }
    } while ((-not $w4Host -or $w4Host.hmi.state -ne 'observing') -and [DateTime]::UtcNow -lt $w4Deadline)
    if (-not $w4Host -or $w4Host.hmi.state -ne 'observing' -or $w4Host.campaignId) { throw 'Fresh corrected observer was not ready.' }
    $w4Host | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $w4Evidence 'observer-before.json') -Encoding UTF8
    $w4Status.status = 'commissioning'
    $w4Status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $w4Evidence 'status.json') -Encoding UTF8
    Push-Location -LiteralPath $w4Config.pinnedCheckout
    try {
        & node scripts/run-w4-commissioning.js --module $w4Config.pinnedCheckout --load-note ('Corrected cwd host with live read-only HMI and capture; witness ' + $w4Evidence) | Tee-Object -FilePath (Join-Path $w4Evidence 'commissioning.stdout.txt')
        if ($LASTEXITCODE -ne 0) { throw 'Timing commissioning failed; do not retry automatically. Inspect the new held-state record.' }
    } finally { Pop-Location }
    $w4Status.status = 'pass'
    Write-Host 'Zero-model commissioning passed. Observer remains at http://127.0.0.1:5190/ . No model requests were made.'
} catch {
    $w4Status.status = 'refused-or-failed'
    $w4Status.error = $_.Exception.Message
    Write-Host $w4Status.error -ForegroundColor Red
} finally {
    foreach ($w4Name in $w4Names) { [Environment]::SetEnvironmentVariable($w4Name, $w4Previous[$w4Name]) }
    if ($w4SecretPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($w4SecretPtr) }
    $w4Status.finishedAtIso = [DateTimeOffset]::UtcNow.ToString('o')
    $w4Status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $w4Evidence 'status.json') -Encoding UTF8
}
