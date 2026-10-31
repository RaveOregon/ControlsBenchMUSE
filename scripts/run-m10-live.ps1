param([string]$OpcUser = 'PLC')
$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    & npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Type checking failed; no live run.' }
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'Offline tests failed; no live run.' }
    $m10Secret = Read-Host 'M10 CODESYS PLC password (masked)' -AsSecureString
    $m10SecretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($m10Secret)
    try {
        $env:OPC_USER = $OpcUser
        $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($m10SecretPtr)
        & node (Join-Path $PSScriptRoot 'run-m10-live.js')
        if ($LASTEXITCODE -ne 0) { throw 'M10 stopped. Preserve the failure evidence; do not retry before investigation.' }
    }
    finally {
        Remove-Item Env:OPC_USER -ErrorAction SilentlyContinue
        Remove-Item Env:OPC_PASSWORD -ErrorAction SilentlyContinue
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($m10SecretPtr)
    }
}
finally { Pop-Location }
