# Switch the known terminal host to the tested retry pin, then run zero-model
# commissioning. The chat may issue paid Start only after status is bench-pass.
param([Parameter(Mandatory=$true)][string]$Packet,[Parameter(Mandatory=$true)][string]$AuthorizePacket)
$ErrorActionPreference='Stop'
foreach($w4Module in @('Microsoft.PowerShell.Utility','Microsoft.PowerShell.Management','CimCmdlets')) { Import-Module (Join-Path $PSHOME ('Modules/'+$w4Module)) -ErrorAction Stop }
$w4Root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$w4PacketPath=(Resolve-Path -LiteralPath $Packet).Path
if ((Get-FileHash -LiteralPath $w4PacketPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $AuthorizePacket) { throw 'Approved resume packet changed.' }
$w4Packet=Get-Content -LiteralPath $w4PacketPath -Raw | ConvertFrom-Json
$w4FullProof=$w4Packet.approvalRevision.contract -eq 'controlsbench.w4-full-proof-approval.v1'
$w4ContextProof=$w4Packet.approvalRevision.contract -eq 'controlsbench.w4-full-proof-approval.v3'
$w4LongProof=$w4ContextProof -or $w4Packet.approvalRevision.contract -eq 'controlsbench.w4-full-proof-approval.v2'
if ($w4ContextProof) {
    if ($w4Packet.approvalRevision.authorizedCreditPoolUsd -ne 150 -or $w4Packet.maximumModelRequests -ne 20 -or $w4Packet.maximumNewConservativeUsd -ne 100 -or $w4Packet.sessionBaseline.conservativeUsd -ne 45 -or $w4Packet.aggregateConservativeCeilingUsd -ne 145 -or $w4Packet.sessionHardUsd -ne 150 -or $w4Packet.perRequestAdmissionUsd -ne 5 -or $w4Packet.admissionMode -ne 'context_ceiling' -or $w4Packet.maxTransientRetries -ne 5 -or $w4Packet.maxRejectedDecisions -ne 3) { throw 'Direct full-context admission differs from authorized proof profile.' }
} elseif ($w4LongProof) {
    if ($w4Packet.approvalRevision.authorizedCreditPoolUsd -ne 150 -or $w4Packet.maximumModelRequests -ne 20 -or $w4Packet.maximumNewConservativeUsd -ne 60 -or $w4Packet.sessionBaseline.conservativeUsd -lt 12 -or $w4Packet.aggregateConservativeCeilingUsd -ne ($w4Packet.sessionBaseline.conservativeUsd+60) -or $w4Packet.sessionHardUsd -ne 150 -or $w4Packet.aggregateConservativeCeilingUsd -gt 150 -or $w4Packet.perRequestAdmissionUsd -ne 3 -or $w4Packet.maxTransientRetries -ne $(if($w4Packet.retryDecisionTransport){5}else{2}) -or $w4Packet.maxRejectedDecisions -ne 3) { throw 'Expanded proof packet differs from the authorized configuration.' }
} elseif ($w4FullProof) {
    if ($w4Packet.approvalRevision.authorizedCreditPoolUsd -ne 150 -or $w4Packet.maximumModelRequests -ne 5 -or $w4Packet.maximumNewConservativeUsd -ne 5 -or $w4Packet.sessionBaseline.conservativeUsd -ne 10 -or $w4Packet.aggregateConservativeCeilingUsd -ne 15 -or $w4Packet.maxTransientRetries -ne 1) { throw 'Full-proof packet differs from the authorized continuation.' }
} elseif ($w4Packet.approvalRevision.contract -ne 'controlsbench.w4-resume-approval.v1' -or $w4Packet.maximumModelRequests -ne 2 -or $w4Packet.maximumNewConservativeUsd -ne 2 -or $w4Packet.sessionBaseline.conservativeUsd -ne 10 -or $w4Packet.aggregateConservativeCeilingUsd -ne 12 -or $w4Packet.maxTransientRetries -ne 1) { throw 'Expected exactly two remaining attempts with one bounded retry.' }
foreach($w4Source in $w4Packet.launchSourceHashes.PSObject.Properties) { if ((Get-FileHash -LiteralPath (Join-Path $w4Root $w4Source.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4Source.Value) { throw ('Launch source changed: '+$w4Source.Name) } }
$w4Directory=Split-Path -Parent $w4PacketPath
$w4ConfigPath=Join-Path $w4Root $w4Packet.launchConfiguration.path
if ((Get-FileHash -LiteralPath $w4ConfigPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4Packet.launchConfiguration.sha256) { throw 'Launch configuration changed.' }
$w4Config=Get-Content -LiteralPath $w4ConfigPath -Raw | ConvertFrom-Json
if ((& git -C $w4Config.pinnedCheckout rev-parse HEAD).Trim() -ne $w4Packet.ownerCommit) { throw 'Retry pin moved.' }
if ((Get-FileHash -LiteralPath $w4Config.proof -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4Config.proofSha256 -or (Get-FileHash -LiteralPath $w4Config.manifest -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4Config.manifestSha256) { throw 'Source-bound proof/manifest changed.' }
$w4Proof=Get-Content -LiteralPath $w4Config.proof -Raw | ConvertFrom-Json
if ($w4Proof.status -ne 'pass') { throw 'Offline promotion proof must pass.' }
foreach($w4Group in @($w4Proof.sourceHashes,$w4Proof.frozenHashes)) { foreach($w4File in $w4Group.PSObject.Properties) { if ((Get-FileHash -LiteralPath (Join-Path $w4Config.pinnedCheckout $w4File.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4File.Value) { throw ('Pinned bytes changed: '+$w4File.Name) } } }
$w4Account=Join-Path $w4Packet.repositoryRoot 'artifacts/wonder/session.jsonl'
if ((Get-FileHash -LiteralPath $w4Account -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4Packet.sessionBaseline.sha256) { throw 'Paid account changed; no launch or paid call.' }
if (Test-Path -LiteralPath (Join-Path $w4Packet.repositoryRoot 'artifacts/m10/live.lock')) { throw 'Another runtime writer is active.' }
$w4Host=Invoke-RestMethod 'http://127.0.0.1:5190/api/host' -TimeoutSec 5
$w4Report=$null
if (-not $w4FullProof -and (-not $w4LongProof -or $w4Packet.previousHost.expectedCampaignId)) { $w4Report=Invoke-RestMethod 'http://127.0.0.1:5190/api/campaign/report' -TimeoutSec 30 }
if ($w4LongProof) {
    if ($w4Host.campaignId -ne $w4Packet.previousHost.expectedCampaignId -or ($w4Packet.previousHost.expectedCampaignId -and $w4Report.status -ne 'stopped')) { throw 'Expected the exact previous campaign or fresh observer host.' }
} elseif ($w4FullProof) {
    if ($w4Host.campaignId -or $w4Report) { throw 'Expected the fresh retry host with no campaign.' }
} elseif ($w4Host.campaignId -ne 'portal-20261103000832522-1' -or $w4Report.status -ne 'stopped') { throw 'Expected the exact terminal old campaign.' }
# Serializing the historical report can briefly block the old shared host's
# polling loop. Wait for a new good read; never accept its held stale snapshot.
$w4BaselineDeadline=[DateTime]::UtcNow.AddSeconds(15)
do {
    Start-Sleep -Milliseconds 500
    $w4Hmi=Invoke-RestMethod 'http://127.0.0.1:5191/api/state' -TimeoutSec 5
} while ($w4Hmi.link.state -ne 'connected' -and [DateTime]::UtcNow -lt $w4BaselineDeadline)
$w4Values=$w4Hmi.snapshot.values
@{observedAtIso=[DateTimeOffset]::UtcNow.ToString('o');link=$w4Hmi.link;baseline=@{mode=$w4Values.'GVL_DemoRead.Status.ModeText';fault=$w4Values.'GVL_DemoRead.Status.FaultCode';item=$w4Values.'GVL_DemoRead.Status.ItemActive';pending=$w4Values.'GVL_DemoRead.Status.CompletionPending';motor=$w4Values.'GVL_DemoRead.Status.Motor_RunCmd'}} | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $w4Directory 'pre-prompt-baseline.json') -Encoding UTF8
if ($w4Packet.priorRecovery) {
    $w4RecoveryReference=(Resolve-Path -LiteralPath (Join-Path $w4Root $w4Packet.priorRecovery.reference)).Path
    if (-not $w4RecoveryReference.StartsWith((Join-Path $w4Root 'artifacts/w4-paid/'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Recovery record outside paid proof artifacts.' }
    if ($w4Packet.priorRecovery.path -notin @('pending-runout','aborted-d1-jam') -or (Get-FileHash -LiteralPath (Join-Path $w4RecoveryReference 'held-state.json') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4Packet.priorRecovery.heldStateSha256) { throw 'Exact supported recovery record required.' }
    if ($w4Hmi.link.state -ne 'connected') { throw 'Live observer must be connected before recovery inspection.' }
} elseif ($w4Hmi.link.state -ne 'connected' -or $w4Values.'GVL_DemoRead.Status.ModeText'.value -ne 'Stopped' -or $w4Values.'GVL_DemoRead.Status.FaultCode'.value -ne 0 -or $w4Values.'GVL_DemoRead.Status.ItemActive'.value -ne $false -or $w4Values.'GVL_DemoRead.Status.CompletionPending'.value -ne $false -or $w4Values.'GVL_DemoRead.Status.Motor_RunCmd'.value -ne $false) { throw 'Fresh stopped PLC baseline required.' }
foreach($w4BaselinePath in @('ModeText','FaultCode','ItemActive','CompletionPending','Motor_RunCmd')) { if ($w4Values.('GVL_DemoRead.Status.'+$w4BaselinePath).good -ne $true) { throw ('PLC baseline quality is not Good: '+$w4BaselinePath) } }
if ($w4FullProof -or $w4LongProof) {
    $w4OldProcess=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$w4Packet.previousHost.pid)
    $w4PreviousPin='w4-retry-runtime-pin';if($w4Packet.previousHost.pinDirectoryName){$w4PreviousPin=$w4Packet.previousHost.pinDirectoryName}
    if (-not $w4OldProcess -or $w4OldProcess.Name -ne 'node.exe' -or $w4OldProcess.CommandLine -notlike ('*'+$w4PreviousPin+'*run-hmi-portal.js*') -or $w4OldProcess.CommandLine -notlike ('*'+$w4Packet.previousHost.packetDirectoryName+'*')) { throw 'Previous proof host process identity changed.' }
} else {
    $w4OldRecord=Get-Content -LiteralPath (Join-Path $w4Root 'artifacts/w4-paid/2026-11-03T00-05-36-042Z/live-host/runs/2026-11-03T00-08-00-121Z-live_plc/portal-host/portal-20261103000832522-1/held-state.json') -Raw | ConvertFrom-Json
    $w4OldProcess=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$w4OldRecord.ownership.acquired.parentPid)
    if (-not $w4OldProcess -or $w4OldProcess.Name -ne 'node.exe' -or $w4OldProcess.CommandLine -notlike '*w4-commissioning-pin*run-hmi-portal.js*' -or $w4OldProcess.CommandLine -notlike '*2026-11-03T00-05-36-042Z*') { throw 'Old host process identity changed.' }
}
@{observedAtIso=[DateTimeOffset]::UtcNow.ToString('o');host=$w4Host;hmi=$w4Hmi} | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath (Join-Path $w4Directory 'pre-switch-observer.json') -Encoding UTF8
$w4Status=@{phase='awaiting-password';modelCalls=0;packetSha256=$AuthorizePacket;sourceCommit=$w4Config.sourceCommit}
$w4StatusFile=Join-Path $w4Directory 'launch-status.json'
$w4Status | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $w4StatusFile -Encoding UTF8
$w4Environment=@{CONTROLSBENCH_W4_PACKET=$w4PacketPath;CONTROLSBENCH_W4_APPROVAL_SHA256=$AuthorizePacket;CONTROLSBENCH_W4_LAUNCH_CONFIG=$w4ConfigPath;
 CONTROLSBENCH_WONDER_PROCESS_MODULE=(Join-Path $w4Config.pinnedCheckout 'src/live/wonder-process/index.ts');CONTROLSBENCH_WONDER_PROCESS_COMMIT=$w4Config.sourceCommit;
 CONTROLSBENCH_WONDER_HANDOFF=$w4Config.manifest;CONTROLSBENCH_WONDER_HANDOFF_SHA256=$w4Config.manifestSha256;CONTROLSBENCH_WONDER_PRICING_REVIEWED='2026-11-01';CONTROLSBENCH_HMI_BROWSER='C:\Program Files\Google\Chrome\Application\chrome.exe'}
$w4Previous=@{};foreach($w4Name in @($w4Environment.Keys)+@('OPC_USER','OPC_PASSWORD','MODEL_API_KEY')) { $w4Previous[$w4Name]=[Environment]::GetEnvironmentVariable($w4Name) }
$w4Ptr=[IntPtr]::Zero
try {
    $w4Secret=Read-Host 'Retry-build bench check and trial PLC password (masked)' -AsSecureString
    $w4Ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($w4Secret)
    $env:OPC_USER='PLC';$env:OPC_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($w4Ptr)
    if (-not $env:MODEL_API_KEY) { foreach($w4Line in Get-Content -LiteralPath (Join-Path $w4Packet.repositoryRoot '.env')) { if ($w4Line -match '^\s*MODEL_API_KEY\s*=\s*(.*?)\s*$') { $env:MODEL_API_KEY=$Matches[1].Trim().Trim('"').Trim("'");break } } }
    if (-not $env:MODEL_API_KEY) { throw 'Private model key missing; do not paste it in chat.' }
    foreach($w4Name in $w4Environment.Keys) { [Environment]::SetEnvironmentVariable($w4Name,$w4Environment[$w4Name]) }
    if ($w4Packet.priorRecovery) {
        $w4Status.phase='recorded-prior-bench-cleanup';$w4Status | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $w4StatusFile -Encoding UTF8
        Push-Location -LiteralPath $w4Root
        try {
            $w4RecoveryFlag='--'+$w4Packet.priorRecovery.path
            & node scripts/w4-paid/recover-completed-hold.mjs $w4RecoveryReference $w4RecoveryFlag
            if ($LASTEXITCODE -ne 0) { throw 'Exact read-only pending-runout inspection refused; no cleanup write.' }
            & node scripts/w4-paid/recover-completed-hold.mjs $w4RecoveryReference $w4RecoveryFlag --reconcile --authorize $w4Packet.priorRecovery.heldStateSha256
            if ($LASTEXITCODE -ne 0) { throw 'Recorded bench cleanup failed; preserve state and lock.' }
        } finally { Pop-Location }
        $w4Recovered=Get-Content -LiteralPath (Join-Path $w4RecoveryReference ($w4Packet.priorRecovery.path+'-recovery-latest.json')) -Raw | ConvertFrom-Json
        if ($w4Recovered.status -ne 'pass') { throw 'Recorded cleanup must pass before switching host.' }
        $w4Status.priorRecoveryDirectory=$w4Recovered.directory
        Start-Sleep -Milliseconds 1500
        $w4Hmi=Invoke-RestMethod 'http://127.0.0.1:5191/api/state' -TimeoutSec 5;$w4Values=$w4Hmi.snapshot.values
        if ($w4Hmi.link.state -ne 'connected' -or $w4Values.'GVL_DemoRead.Status.ModeText'.value -ne 'Stopped' -or $w4Values.'GVL_DemoRead.Status.FaultCode'.value -ne 0 -or $w4Values.'GVL_DemoRead.Status.ItemActive'.value -ne $false -or $w4Values.'GVL_DemoRead.Status.CompletionPending'.value -ne $false -or $w4Values.'GVL_DemoRead.Status.Motor_RunCmd'.value -ne $false) { throw 'Fresh stopped baseline required after recorded cleanup.' }
    }
    $w4Command=@{contractVersion=1;requestId=('retry-switch-'+[DateTime]::UtcNow.Ticks);type='disconnect_hmi';payload=@{}} | ConvertTo-Json
    Invoke-RestMethod 'http://127.0.0.1:5190/api/commands' -Method Post -ContentType 'application/json' -Body $w4Command | Out-Null
    $w4Deadline=[DateTime]::UtcNow.AddSeconds(15)
    do { Start-Sleep -Milliseconds 250;$w4Host=Invoke-RestMethod 'http://127.0.0.1:5190/api/host' -TimeoutSec 5 } while ($w4Host.hmi.state -ne 'disconnected' -and [DateTime]::UtcNow -lt $w4Deadline)
    if ($w4Host.hmi.state -ne 'disconnected') { throw 'Capture did not close; old host was not stopped.' }
    Stop-Process -Id $w4OldProcess.ProcessId -ErrorAction Stop;Start-Sleep -Milliseconds 1000
    $w4Args=@((Join-Path $w4Config.pinnedCheckout 'scripts/run-hmi-portal.js'),'--live','--campaign','wonder','--campaign-module',(Join-Path $PSScriptRoot 'factory.mjs'),'--portal-port','5190','--hmi-port','5191','--hmi-headless','--commands','disabled','--artifacts',$w4Packet.campaignArtifactRoot)
    if ($w4Packet.hostObserver) {
        if ($w4Packet.hostObserver.captureIntervalMs -ne 2000) { throw 'Declared observer capture must remain 2000 ms.' }
        $w4Args+=@('--capture-ms','2000')
    }
    $w4Process=Start-Process -FilePath 'node.exe' -ArgumentList $w4Args -WorkingDirectory $w4Config.pinnedCheckout -WindowStyle Hidden -RedirectStandardOutput (Join-Path $w4Directory 'host.stdout.txt') -RedirectStandardError (Join-Path $w4Directory 'host.stderr.txt') -PassThru
    $w4Status.hostPid=$w4Process.Id;$w4Status.phase='host-starting'
    $w4Status | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $w4StatusFile -Encoding UTF8
    $w4Deadline=[DateTime]::UtcNow.AddSeconds(60)
    do { Start-Sleep -Milliseconds 500;if ($w4Process.HasExited) { throw 'Retry host exited; see saved logs.' };try { $w4Host=Invoke-RestMethod 'http://127.0.0.1:5190/api/host' -TimeoutSec 2 } catch { $w4Host=$null } } while ((-not $w4Host -or $w4Host.hmi.state -ne 'observing') -and [DateTime]::UtcNow -lt $w4Deadline)
    if (-not $w4Host -or $w4Host.campaignId -or $w4Host.hmi.state -ne 'observing') { throw 'Fresh retry host did not become ready.' }
    $w4Status.phase='zero-model-bench-check';$w4Status | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $w4StatusFile -Encoding UTF8
    Push-Location -LiteralPath $w4Config.pinnedCheckout
    try {
        & node scripts/run-w4-commissioning.js --module $w4Config.pinnedCheckout --artifacts (Join-Path $w4Directory 'bench-check') --load-note 'Retry-capable coordinator pin with live HMI capture; no model calls in commissioning' | Tee-Object -FilePath (Join-Path $w4Directory 'bench-check.stdout.txt')
        if ($LASTEXITCODE -ne 0) { throw 'Zero-model bench check failed; no paid Start permitted. Preserve held-state evidence.' }
    } finally { Pop-Location }
    $w4Bench=Get-ChildItem -LiteralPath (Join-Path $w4Directory 'bench-check') -Directory | Sort-Object Name | Select-Object -Last 1
    $w4Result=Get-Content -LiteralPath (Join-Path $w4Bench.FullName 'result.json') -Raw | ConvertFrom-Json
    if ($w4Result.status -ne 'pass' -or -not $w4Result.qualification.passed) { throw 'Native qualification did not pass.' }
    $w4Status.phase='bench-pass-ready-for-paid-start';$w4Status.benchDirectory=$w4Bench.FullName
    Write-Host 'Bench check passed. App is ready at http://127.0.0.1:5190/ . Chat will start the authorized trial; do not click Start yourself.'
} catch { $w4Status.phase='refused-or-failed';$w4Status.error=$_.Exception.Message;Write-Host $w4Status.error -ForegroundColor Red }
finally {
    foreach($w4Name in $w4Previous.Keys) { [Environment]::SetEnvironmentVariable($w4Name,$w4Previous[$w4Name]) }
    if ($w4Ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($w4Ptr) }
    $w4Status.updatedAtIso=[DateTimeOffset]::UtcNow.ToString('o');$w4Status | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $w4StatusFile -Encoding UTF8
}
