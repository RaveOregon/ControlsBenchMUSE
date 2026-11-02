# One specifically reviewed expanded trial. All app/PLC/model writes wait for
# packet verification, fresh stopped baseline and local masked credential entry.
param([Parameter(Mandatory=$true)][string]$Packet,[Parameter(Mandatory=$true)][string]$AuthorizePacket)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Management') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules/CimCmdlets') -ErrorAction Stop
$w4Data=Get-Content -LiteralPath $Packet -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $Packet -Algorithm SHA256).Hash.ToLowerInvariant() -ne $AuthorizePacket) { throw 'Expanded packet changed.' }
if ($w4Data.approvalRevision.contract -ne 'controlsbench.w4-expanded-approval.v1' -or $w4Data.maximumModelRequests -ne 4 -or $w4Data.maximumNewConservativeUsd -ne 4 -or $w4Data.maximumOutputTokens -ne 8000 -or $w4Data.sessionBaseline.conservativeUsd -ne 7 -or $w4Data.aggregateConservativeCeilingUsd -ne 11) { throw 'Expected the exact expanded review: four requests, 8000 output tokens, $7 + $4 = $11.' }
if (Test-Path -LiteralPath (Join-Path $w4Data.repositoryRoot 'artifacts/m10/live.lock')) { throw 'A writer holds the runtime.' }
$w4Host=Invoke-RestMethod 'http://127.0.0.1:5190/api/host' -TimeoutSec 5
$w4Report=Invoke-RestMethod 'http://127.0.0.1:5190/api/campaign/report' -TimeoutSec 5
$w4Hmi=Invoke-RestMethod 'http://127.0.0.1:5191/api/state' -TimeoutSec 5
if ($w4Host.campaignId -ne 'portal-20261102234344698-1' -or $w4Host.factory.id -ne 'wonder-w4-qualified-m8' -or $w4Report.status -ne 'stopped') { throw 'Expected the exact terminal previous trial.' }
$w4Values=$w4Hmi.snapshot.values
if ($w4Hmi.link.state -ne 'connected' -or $w4Values.'GVL_DemoRead.Status.ModeText'.value -ne 'Stopped' -or $w4Values.'GVL_DemoRead.Status.FaultCode'.value -ne 0 -or $w4Values.'GVL_DemoRead.Status.ItemActive'.value -ne $false -or $w4Values.'GVL_DemoRead.Status.CompletionPending'.value -ne $false -or $w4Values.'GVL_DemoRead.Status.Motor_RunCmd'.value -ne $false) { throw 'Fresh stopped PLC baseline not observed.' }
@{observedAtIso=[DateTimeOffset]::UtcNow.ToString('o');hmi=$w4Hmi;host=$w4Host} | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath (Join-Path (Split-Path -Parent $Packet) 'pre-trial-observer.json') -Encoding UTF8
$w4OldHost=Get-CimInstance Win32_Process -Filter 'ProcessId = 40860'
if (-not $w4OldHost -or $w4OldHost.Name -ne 'node.exe' -or $w4OldHost.CommandLine -notlike '*w4-commissioning-pin*run-hmi-portal.js*' -or $w4OldHost.CommandLine -notlike '*2026-11-02T21-16-08-803Z*') { throw 'Previous host process identity changed.' }
$w4Command=@{contractVersion=1;requestId=('expanded-disconnect-'+[DateTime]::UtcNow.Ticks);type='disconnect_hmi';payload=@{}} | ConvertTo-Json
Invoke-RestMethod 'http://127.0.0.1:5190/api/commands' -Method Post -ContentType 'application/json' -Body $w4Command | Out-Null
$w4Deadline=[DateTime]::UtcNow.AddSeconds(15)
do {Start-Sleep -Milliseconds 250;$w4Host=Invoke-RestMethod 'http://127.0.0.1:5190/api/host' -TimeoutSec 5} while ($w4Host.hmi.state -ne 'disconnected' -and [DateTime]::UtcNow -lt $w4Deadline)
if ($w4Host.hmi.state -ne 'disconnected') { throw 'Capture did not close; host was not stopped.' }
Stop-Process -Id $w4OldHost.ProcessId -ErrorAction Stop
Start-Sleep -Milliseconds 1000
& (Join-Path $PSScriptRoot 'launch.ps1') -Packet $Packet -AuthorizePacket $AuthorizePacket
