$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility') -ErrorAction Stop
$w4Root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$w4Trial = Join-Path $w4Root 'artifacts/w4-paid/2026-11-02T21-16-08-803Z/live-host/runs/2026-11-02T23-43-04-875Z-live_plc/portal-host/portal-20261102234344698-1'
$w4Prior = Get-Content -LiteralPath (Join-Path $w4Trial 'result.json') -Raw | ConvertFrom-Json
$w4Sha = (Get-FileHash -LiteralPath (Join-Path $w4Trial 'held-state.json') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($w4Sha -ne $w4Prior.heldState.sha256) { throw 'Recorded held state changed.' }
$w4Status = @{status='awaiting-local-password';modelCalls=0;reference=$w4Trial;heldStateSha256=$w4Sha}
$w4StatusFile = Join-Path $w4Trial 'completion-recovery-status.json'
$w4Status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $w4StatusFile -Encoding UTF8
$w4Ptr=[IntPtr]::Zero
$w4BeforeUser=$env:OPC_USER
$w4BeforePassword=$env:OPC_PASSWORD
try {
    $w4Secret = Read-Host 'Completed-sort cleanup PLC password (masked; zero model calls)' -AsSecureString
    $w4Ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($w4Secret)
    $env:OPC_USER='PLC'
    $env:OPC_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($w4Ptr)
    Push-Location -LiteralPath $w4Root
    try {
        & node scripts/w4-paid/recover-completed-hold.mjs $w4Trial
        if ($LASTEXITCODE -ne 0) { throw 'Read-only inspection refused; no recovery attempted.' }
        $w4Inspected = Get-Content -LiteralPath (Join-Path $w4Trial 'completed-recovery-latest.json') -Raw | ConvertFrom-Json
        $w4Status.inspectionDirectory=$w4Inspected.directory
        & node scripts/w4-paid/recover-completed-hold.mjs $w4Trial --reconcile --authorize $w4Sha
        if ($LASTEXITCODE -ne 0) { throw 'Cleanup did not pass; retain evidence and any ownership lock. No retry.' }
        $w4Final = Get-Content -LiteralPath (Join-Path $w4Trial 'completed-recovery-latest.json') -Raw | ConvertFrom-Json
        $w4Status.status=$w4Final.status
        $w4Status.recoveryDirectory=$w4Final.directory
    } finally { Pop-Location }
} catch {
    $w4Status.status='refused-or-failed';$w4Status.error=$_.Exception.Message
    Write-Host $w4Status.error -ForegroundColor Red
} finally {
    $env:OPC_USER=$w4BeforeUser;$env:OPC_PASSWORD=$w4BeforePassword
    if ($w4Ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($w4Ptr) }
    $w4Status.finishedAtIso=[DateTimeOffset]::UtcNow.ToString('o')
    $w4Status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $w4StatusFile -Encoding UTF8
}
