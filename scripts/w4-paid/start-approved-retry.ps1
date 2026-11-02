# Replace only the known zero-model observer; the original launcher performs the
# pinned-source checks and obtains the private PLC credential at a masked prompt.
param([Parameter(Mandatory=$true)][string]$Packet,[Parameter(Mandatory=$true)][string]$AuthorizePacket)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Management') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules/CimCmdlets') -ErrorAction Stop
$w4Root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$w4Config = Get-Content -LiteralPath (Join-Path $w4Root 'artifacts/w4-readiness/e3469af/launch.json') -Raw | ConvertFrom-Json
$w4Packet = Get-Content -LiteralPath $Packet -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $Packet -Algorithm SHA256).Hash.ToLowerInvariant() -ne $AuthorizePacket) { throw 'Retry packet changed.' }
if ($w4Packet.maximumModelRequests -ne 3 -or $w4Packet.maximumNewConservativeUsd -ne 3 -or $w4Packet.sessionBaseline.conservativeUsd -ne 5 -or $w4Packet.aggregateConservativeCeilingUsd -ne 8) { throw 'Expected exactly the remaining original allowance.' }
if (Test-Path -LiteralPath (Join-Path $w4Packet.repositoryRoot 'artifacts/m10/live.lock')) { throw 'A runtime writer holds the lock.' }
$w4Host = Invoke-RestMethod 'http://127.0.0.1:5190/api/host' -TimeoutSec 5
$w4Hmi = Invoke-RestMethod 'http://127.0.0.1:5191/api/state' -TimeoutSec 5
if ($w4Host.campaignId -or $w4Host.factory.id -ne 'm8-live') { throw 'Expected the idle zero-model observer.' }
$w4Values = $w4Hmi.snapshot.values
if ($w4Hmi.link.state -ne 'connected' -or $w4Values.'GVL_DemoRead.Status.ModeText'.value -ne 'Stopped' -or $w4Values.'GVL_DemoRead.Status.FaultCode'.value -ne 0 -or $w4Values.'GVL_DemoRead.Status.ItemActive'.value -ne $false -or $w4Values.'GVL_DemoRead.Status.CompletionPending'.value -ne $false -or $w4Values.'GVL_DemoRead.Status.Motor_RunCmd'.value -ne $false) { throw 'Fresh stopped PLC baseline not observed; no host replacement or model call.' }
@{ observedAtIso=[DateTimeOffset]::UtcNow.ToString('o'); hmi=$w4Hmi; host=$w4Host } | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath (Join-Path (Split-Path -Parent $Packet) 'pre-retry-observer.json') -Encoding UTF8
$w4OldHost = Get-CimInstance Win32_Process -Filter 'ProcessId = 3116'
if (-not $w4OldHost -or $w4OldHost.Name -ne 'node.exe' -or $w4OldHost.CommandLine -notlike '*w4-commissioning-pin*run-hmi-portal.js*' -or $w4OldHost.CommandLine -notlike '*timing-2026-11-02T18-29-41-137Z*') { throw 'Observer identity changed; refusing shutdown.' }
$w4Command = @{ contractVersion=1; requestId=('retry-disconnect-' + [DateTime]::UtcNow.Ticks); type='disconnect_hmi'; payload=@{} } | ConvertTo-Json
Invoke-RestMethod 'http://127.0.0.1:5190/api/commands' -Method Post -ContentType 'application/json' -Body $w4Command | Out-Null
$w4Deadline = [DateTime]::UtcNow.AddSeconds(15)
do { Start-Sleep -Milliseconds 250; $w4Host = Invoke-RestMethod 'http://127.0.0.1:5190/api/host' -TimeoutSec 5 } while ($w4Host.hmi.state -ne 'disconnected' -and [DateTime]::UtcNow -lt $w4Deadline)
if ($w4Host.hmi.state -ne 'disconnected') { throw 'Capture did not close; host was not stopped.' }
Stop-Process -Id $w4OldHost.ProcessId -ErrorAction Stop
Start-Sleep -Milliseconds 1000
& (Join-Path $PSScriptRoot 'launch.ps1') -Packet $Packet -AuthorizePacket $AuthorizePacket
