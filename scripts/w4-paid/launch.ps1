param([Parameter(Mandatory=$true)][string]$Packet, [Parameter(Mandatory=$true)][string]$AuthorizePacket)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility') -ErrorAction Stop
$w4PacketPath = (Resolve-Path -LiteralPath $Packet).Path
if ((Get-FileHash -LiteralPath $w4PacketPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $AuthorizePacket.ToLowerInvariant()) { throw 'Authorization must match the reviewed packet SHA-256.' }
$w4Packet = Get-Content -LiteralPath $w4PacketPath -Raw | ConvertFrom-Json
$w4Root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$w4Config = Get-Content -LiteralPath (Join-Path $w4Root 'artifacts/w4-readiness/e3469af/launch.json') -Raw | ConvertFrom-Json
$w4Ceiling = 8
if ($w4Packet.approvalRevision) {
    $w4Turns = 4
    $w4Ceiling = 11
    if ($w4Packet.approvalRevision.contract -eq 'controlsbench.w4-expanded-approval.v2') { $w4Turns=5; $w4Ceiling=12 }
    elseif ($w4Packet.approvalRevision.contract -ne 'controlsbench.w4-expanded-approval.v1') { throw 'Unknown expanded review.' }
    if ($w4Packet.approvalRevision.previousAggregateCeilingUsd -ne 8 -or $w4Packet.sessionBaseline.conservativeUsd -ne 7 -or $w4Packet.maximumModelRequests -ne $w4Turns -or $w4Packet.maximumOutputTokens -ne 8000) { throw 'Unexpected expanded review.' }
}
if ($w4Packet.ownerCommit -ne $w4Config.sourceCommit -or $w4Packet.maximumModelRequests -lt 1 -or $w4Packet.maximumModelRequests -gt $(if($w4Ceiling -eq 12){5}else{4}) -or $w4Packet.maximumModelRequests -ne $w4Packet.maximumNewConservativeUsd -or $w4Packet.aggregateConservativeCeilingUsd -ne $w4Ceiling -or ($w4Packet.sessionBaseline.conservativeUsd + $w4Packet.maximumNewConservativeUsd) -gt $w4Ceiling -or $w4Packet.maximumOutputTokens -gt 8000) { throw 'Unexpected campaign envelope.' }
foreach ($w4Source in $w4Packet.launchSourceHashes.PSObject.Properties) {
    if ((Get-FileHash -LiteralPath (Join-Path $w4Root $w4Source.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4Source.Value) { throw "Launch source changed: $($w4Source.Name)" }
}
if ((Get-FileHash -LiteralPath $w4Config.manifest -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4Config.manifestSha256) { throw 'Pinned manifest changed.' }
$w4Head = (& git -C $w4Config.pinnedCheckout rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $w4Head -ne $w4Config.sourceCommit) { throw 'Pinned runtime checkout moved.' }
$w4Proof = Get-Content -LiteralPath $w4Config.proof -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $w4Config.proof -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4Config.proofSha256 -or $w4Proof.status -ne 'pass') { throw 'Offline proof changed or failed.' }
foreach ($w4Group in @($w4Proof.sourceHashes, $w4Proof.frozenHashes)) {
    foreach ($w4File in $w4Group.PSObject.Properties) {
        if ((Get-FileHash -LiteralPath (Join-Path $w4Config.pinnedCheckout $w4File.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w4File.Value) { throw "Pinned source/frozen bytes changed: $($w4File.Name)" }
    }
}
# Refuse occupied observer ports before retaining a credential or creating any live session.
foreach ($w4Port in @(5190,5191)) {
    $w4Probe = New-Object System.Net.Sockets.TcpClient
    try { $w4Probe.Connect('127.0.0.1',$w4Port); throw "Port $w4Port is occupied. Stop the previous observer with Ctrl+C first." }
    catch [System.Net.Sockets.SocketException] { } finally { $w4Probe.Dispose() }
}
$w4Environment = @{
    CONTROLSBENCH_W4_PACKET = $w4PacketPath
    CONTROLSBENCH_W4_APPROVAL_SHA256 = $AuthorizePacket.ToLowerInvariant()
    CONTROLSBENCH_WONDER_PROCESS_MODULE = (Join-Path $w4Config.pinnedCheckout 'src/live/wonder-process/index.ts')
    CONTROLSBENCH_WONDER_PROCESS_COMMIT = $w4Config.sourceCommit
    CONTROLSBENCH_WONDER_HANDOFF = $w4Config.manifest
    CONTROLSBENCH_WONDER_HANDOFF_SHA256 = $w4Config.manifestSha256
    # Pricing rechecked 2026-11-02; unchanged rates match the pinned provider's version tag.
    CONTROLSBENCH_WONDER_PRICING_REVIEWED = '2026-11-01'
    CONTROLSBENCH_HMI_BROWSER = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
}
$w4Previous = @{}
$w4KeyBefore = $env:MODEL_API_KEY
$w4UserBefore = $env:OPC_USER
$w4PasswordBefore = $env:OPC_PASSWORD
$w4SecretPointer = [IntPtr]::Zero
try {
    if (-not $env:MODEL_API_KEY) {
        $w4DotEnv = Join-Path $w4Packet.repositoryRoot '.env'
        if (Test-Path -LiteralPath $w4DotEnv) {
            foreach ($w4Line in Get-Content -LiteralPath $w4DotEnv) {
                if ($w4Line -match '^\s*MODEL_API_KEY\s*=\s*(.*?)\s*$') { $env:MODEL_API_KEY = $Matches[1].Trim().Trim('"').Trim("'"); break }
            }
        }
    }
    if (-not $env:MODEL_API_KEY) { throw 'Private MODEL_API_KEY is missing from the environment or repository .env. Do not paste it into chat.' }
    foreach ($w4Name in $w4Environment.Keys) {
        $w4Previous[$w4Name] = [Environment]::GetEnvironmentVariable($w4Name)
        [Environment]::SetEnvironmentVariable($w4Name, $w4Environment[$w4Name])
    }
    $w4Secure = Read-Host 'Paid W4 CODESYS PLC password (masked)' -AsSecureString
    $w4SecretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($w4Secure)
    $env:OPC_USER = 'PLC'
    $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($w4SecretPointer)
    Write-Host 'Open http://127.0.0.1:5190/ . All three W4 categories must be selected.'
    Write-Host ('Start Campaign launches at most ' + $w4Packet.maximumModelRequests + ' requests / $' + $w4Packet.maximumNewConservativeUsd + ' conservative spending, within the reviewed $' + $w4Ceiling + ' aggregate ceiling; output allowance ' + $w4Packet.maximumOutputTokens + '. No automatic retry.')
    $w4Args = @((Join-Path $w4Config.pinnedCheckout 'scripts/run-hmi-portal.js'), '--live', '--campaign', 'wonder', '--campaign-module', (Join-Path $PSScriptRoot 'factory.mjs'), '--portal-port', '5190', '--hmi-port', '5191', '--hmi-headless', '--commands', 'disabled', '--artifacts', $w4Packet.campaignArtifactRoot)
    # HMI ownership discovery uses process.cwd(). Launch from the pinned checkout so
    # it finds the shared runtime lock and selects its reduced polling interval.
    Push-Location -LiteralPath $w4Config.pinnedCheckout
    try {
        & node @w4Args
        if ($LASTEXITCODE -ne 0) { throw 'Paid W4 host exited unsuccessfully. Preserve its evidence; do not automatically restart.' }
    } finally { Pop-Location }
} finally {
    foreach ($w4Name in $w4Previous.Keys) { [Environment]::SetEnvironmentVariable($w4Name, $w4Previous[$w4Name]) }
    $env:MODEL_API_KEY = $w4KeyBefore
    $env:OPC_USER = $w4UserBefore
    $env:OPC_PASSWORD = $w4PasswordBefore
    if ($w4SecretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($w4SecretPointer) }
}
