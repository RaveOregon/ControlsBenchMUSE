param([Parameter(Mandatory=$true)][string]$Packet,[Parameter(Mandatory=$true)][string]$AuthorizePacket,[switch]$ValidateOnly)
$ErrorActionPreference='Stop'
foreach($s2Module in @('Microsoft.PowerShell.Utility','Microsoft.PowerShell.Management','CimCmdlets')){Import-Module (Join-Path $PSHOME ('Modules/'+$s2Module))}
$s2Root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$s2Path=(Resolve-Path -LiteralPath $Packet).Path
$s2Dir=Split-Path -Parent $s2Path
$s2Status=@{phase='preflight';modelCalls=0}
$s2StatusPath=Join-Path $s2Dir 'launch-status.json'
$s2Prior=@{};$s2Ptr=[IntPtr]::Zero
try{
    if((Get-FileHash -LiteralPath $s2Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $AuthorizePacket){throw 'S2 packet changed'}
    $s2Packet=Get-Content -LiteralPath $s2Path -Raw | ConvertFrom-Json
    if($s2Packet.contract -ne 'controlsbench.s2-hmi-proof.v1' -or $s2Packet.authorizedCreditPoolUsd -ne 150 -or $s2Packet.requestAdmissionUsd -ne 5 -or $s2Packet.maximumRequests -lt 1 -or $s2Packet.maximumRequests -gt 8 -or ($s2Packet.accountBaseline.totalUsd+5*$s2Packet.maximumRequests) -gt 145){throw 'Invalid S2 allowance'}
    if(($s2Packet.sourceRoot.TrimEnd('\','/')) -ne $s2Root.TrimEnd('\','/')){throw 'Wrong source checkout'}
    if((& git -C $s2Root rev-parse HEAD).Trim() -ne $s2Packet.sourceCommit){throw 'S2 source commit changed'}
    foreach($s2File in $s2Packet.sourceHashes.PSObject.Properties){if((Get-FileHash -LiteralPath (Join-Path $s2Root $s2File.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $s2File.Value){throw ('S2 source changed: '+$s2File.Name)}}
    if((Get-FileHash -LiteralPath $s2Packet.offlineProof.file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $s2Packet.offlineProof.sha256){throw 'Offline evidence changed'}
    if((Get-FileHash -LiteralPath $s2Packet.ownerConfiguration.file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $s2Packet.ownerConfiguration.sha256){throw 'Owner configuration changed'}
    $s2Owner=Get-Content -LiteralPath $s2Packet.ownerConfiguration.file -Raw | ConvertFrom-Json
    if($s2Owner.sourceCommit -ne '503abd3b895cb2fc03853a9ec2d75166544e2a59'){throw 'Unexpected physical engine pin'}
    if((Get-FileHash -LiteralPath (Join-Path $s2Packet.repositoryRoot 'artifacts/wonder/session.jsonl') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $s2Packet.accountBaseline.sha256){throw 'Account changed'}
    if(Test-Path -LiteralPath (Join-Path $s2Packet.repositoryRoot 'artifacts/m10/live.lock')){throw 'Another runtime owns the PLC'}
    if($ValidateOnly){$s2Status.phase='validated-offline';return}
    $s2Host=Invoke-RestMethod 'http://127.0.0.1:5190/api/host' -TimeoutSec 5
    if($s2Host.campaignId -ne $s2Packet.previousHost.campaignId){throw 'Unexpected current app campaign'}
    $s2Report=Invoke-RestMethod 'http://127.0.0.1:5190/api/campaign/report' -TimeoutSec 30
    if($s2Report.status -notin @('completed','stopped','failed')){throw 'Previous campaign has not completed'}
    $s2Deadline=[DateTime]::UtcNow.AddSeconds(20)
    do{Start-Sleep -Milliseconds 500;$s2Hmi=Invoke-RestMethod 'http://127.0.0.1:5191/api/state' -TimeoutSec 5}while($s2Hmi.link.state -ne 'connected' -and [DateTime]::UtcNow -lt $s2Deadline)
    if($s2Hmi.link.state -ne 'connected' -or $s2Hmi.link.bootIdentity -ne $s2Packet.bootIdentity){throw 'Fresh inspected boot required'}
    foreach($s2Pair in @(@('ModeText','Stopped'),@('FaultCode',0),@('ItemActive',$false),@('CompletionPending',$false),@('OfferPending',$false),@('Motor_RunCmd',$false))){$s2Sample=$s2Hmi.snapshot.values.('GVL_DemoRead.Status.'+$s2Pair[0]);if(-not $s2Sample.good -or $s2Sample.value -ne $s2Pair[1]){throw ('Dirty or unknown baseline: '+$s2Pair[0])}}
    $s2Old=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$s2Packet.previousHost.pid)
    if(-not $s2Old -or $s2Old.CommandLine -notlike ('*'+$s2Packet.previousHost.pinDirectoryName+'*run-hmi-portal.js*')){throw 'Exact old host identity not found'}
    @{host=$s2Host;hmi=$s2Hmi;observedAtIso=[DateTimeOffset]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 45 | Set-Content -LiteralPath (Join-Path $s2Dir 'pre-switch-observer.json') -Encoding UTF8
    $s2Status.phase='awaiting-password';$s2Status | ConvertTo-Json | Set-Content -LiteralPath $s2StatusPath -Encoding UTF8
    $s2Environment=@{CONTROLSBENCH_S2_PACKET=$s2Path;CONTROLSBENCH_S2_PACKET_SHA256=$AuthorizePacket;CONTROLSBENCH_W4_LAUNCH_CONFIG=$s2Packet.ownerConfiguration.file;
      CONTROLSBENCH_WONDER_PROCESS_MODULE=(Join-Path $s2Owner.pinnedCheckout 'src/live/wonder-process/index.ts');CONTROLSBENCH_WONDER_PROCESS_COMMIT=$s2Owner.sourceCommit;
      CONTROLSBENCH_WONDER_HANDOFF=$s2Owner.manifest;CONTROLSBENCH_WONDER_HANDOFF_SHA256=$s2Owner.manifestSha256;CONTROLSBENCH_WONDER_PRICING_REVIEWED='2026-11-01';CONTROLSBENCH_HMI_BROWSER='C:\Program Files\Google\Chrome\Application\chrome.exe'}
    foreach($s2Name in @($s2Environment.Keys)+@('OPC_USER','OPC_PASSWORD','MODEL_API_KEY')){$s2Prior[$s2Name]=[Environment]::GetEnvironmentVariable($s2Name)}
    $s2Secret=Read-Host 'S2 Muse HMI proof PLC password (masked)' -AsSecureString
    $s2Ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2Secret)
    foreach($s2Name in $s2Environment.Keys){[Environment]::SetEnvironmentVariable($s2Name,$s2Environment[$s2Name])}
    $env:OPC_USER='PLC';$env:OPC_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($s2Ptr)
    if(-not $env:MODEL_API_KEY){foreach($s2Line in Get-Content -LiteralPath (Join-Path $s2Packet.repositoryRoot '.env')){if($s2Line -match '^\s*MODEL_API_KEY\s*=\s*(.*?)\s*$'){$env:MODEL_API_KEY=$Matches[1].Trim().Trim('"').Trim("'");break}}}
    if(-not $env:MODEL_API_KEY){throw 'Local Meta key missing'}
    $s2Command=@{contractVersion=1;requestId=('s2-switch-'+[DateTime]::UtcNow.Ticks);type='disconnect_hmi';payload=@{}} | ConvertTo-Json
    Invoke-RestMethod 'http://127.0.0.1:5190/api/commands' -Method Post -ContentType 'application/json' -Body $s2Command | Out-Null
    $s2Deadline=[DateTime]::UtcNow.AddSeconds(15)
    do{Start-Sleep -Milliseconds 250;$s2Host=Invoke-RestMethod 'http://127.0.0.1:5190/api/host' -TimeoutSec 5}while($s2Host.hmi.state -ne 'disconnected' -and [DateTime]::UtcNow -lt $s2Deadline)
    if($s2Host.hmi.state -ne 'disconnected'){throw 'Old capture did not close'}
    Stop-Process -Id $s2Old.ProcessId;Start-Sleep -Milliseconds 1000
    $s2Args=@((Join-Path $s2Root 'scripts/run-hmi-portal.js'),'--live','--campaign','wonder','--campaign-module',(Join-Path $s2Root 'src/host/wonder-hmi-factory.ts'),'--portal-port','5190','--hmi-port','5191','--hmi-headless','--agent-hmi','--commands','enabled','--capture-ms','3000','--shared-poll-ms','2000','--artifacts',$s2Packet.artifactRoot)
    $s2Process=Start-Process node.exe -ArgumentList $s2Args -WorkingDirectory $s2Root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $s2Dir 'host.stdout.txt') -RedirectStandardError (Join-Path $s2Dir 'host.stderr.txt') -PassThru
    $s2Status.hostPid=$s2Process.Id;$s2Status.phase='host-starting';$s2Status | ConvertTo-Json | Set-Content -LiteralPath $s2StatusPath -Encoding UTF8
    $s2Deadline=[DateTime]::UtcNow.AddSeconds(60)
    do{Start-Sleep -Milliseconds 500;try{$s2Host=Invoke-RestMethod 'http://127.0.0.1:5190/api/host' -TimeoutSec 2}catch{$s2Host=$null}}while((-not $s2Host -or $s2Host.hmi.state -ne 'observing') -and [DateTime]::UtcNow -lt $s2Deadline)
    if(-not $s2Host -or $s2Host.campaignId -or $s2Host.hmi.state -ne 'observing'){throw 'S2 host did not become ready; no paid Start'}
    $s2Status.phase='ready-for-authorized-start';Write-Host 'S2 app ready at http://127.0.0.1:5190/ . Chat will start the authorized proof once; do not click Start yourself.'
}catch{$s2Status.phase='refused-or-failed';$s2Status.error=$_.Exception.Message;Write-Host $s2Status.error -ForegroundColor Red}
finally{
    foreach($s2Name in $s2Prior.Keys){[Environment]::SetEnvironmentVariable($s2Name,$s2Prior[$s2Name])}
    if($s2Ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($s2Ptr)}
    $s2Status.updatedAtIso=[DateTimeOffset]::UtcNow.ToString('o');$s2Status | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $s2StatusPath -Encoding UTF8
}
