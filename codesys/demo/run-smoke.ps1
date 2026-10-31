param(
    [ValidateSet('A','B','C','D','All')][string]$Gate = 'All',
    [string]$OpcUser = 'PLC',
    [switch]$Watch
)
$ErrorActionPreference = 'Stop'
$secret = Read-Host 'CODESYS PLC password' -AsSecureString
$secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
$requestPath = Join-Path $PSScriptRoot 'operator-request.json'
$statusPath = Join-Path $PSScriptRoot 'operator-status.json'
$lastRequestId = ''
$nextGate = $Gate
if (Test-Path -LiteralPath $requestPath) {
    $lastRequestId = (Get-Content -LiteralPath $requestPath -Raw | ConvertFrom-Json).id
}
try {
    do {
        @{ active = $true; running = $true; gate = $nextGate; requestId = $lastRequestId } |
            ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8
        try {
            $env:OPC_USER = $OpcUser
            $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
            & node (Join-Path $PSScriptRoot 'tests\smoke.cjs') $nextGate
            $smokeExitCode = $LASTEXITCODE
        }
        finally {
            Remove-Item Env:OPC_PASSWORD -ErrorAction SilentlyContinue
            Remove-Item Env:OPC_USER -ErrorAction SilentlyContinue
        }
        @{ active = [bool]$Watch; running = $false; gate = $nextGate; requestId = $lastRequestId; exitCode = $smokeExitCode } |
            ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8
        if (-not $Watch) {
            if ($smokeExitCode -ne 0) { throw "M8 smoke stopped at a failed assertion. Read the timestamped evidence; do not continue." }
            break
        }
        Write-Host 'M8 operator session waiting. No automatic retry. Ctrl+C closes the session.'
        do {
            Start-Sleep -Milliseconds 500
            if (-not (Test-Path -LiteralPath $requestPath)) { continue }
            $request = Get-Content -LiteralPath $requestPath -Raw | ConvertFrom-Json
            if ([string]::IsNullOrWhiteSpace($request.id) -or $request.id -eq $lastRequestId) { continue }
            $lastRequestId = $request.id
            if ($request.action -eq 'stop') { return }
            if ($request.action -ne 'run' -or $request.gate -notin @('A','B','C','D','All')) {
                throw 'Invalid M8 operator request; stopped without running.'
            }
            $nextGate = $request.gate
            break
        } while ($true)
    } while ($Watch)
}
finally {
    Remove-Item Env:OPC_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:OPC_USER -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)
    @{ active = $false; running = $false } | ConvertTo-Json |
        Set-Content -LiteralPath $statusPath -Encoding UTF8
}
