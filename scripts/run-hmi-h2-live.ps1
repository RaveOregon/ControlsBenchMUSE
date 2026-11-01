param([string]$OpcUser = 'PLC', [switch]$Headed)
# H2 live verification of the CV-1 operator HMI. Prompts for the PLC password as a SecureString; it exists only in
# this PowerShell process and the child process environment. Requires M8 build 8001 in RUN, a clean stopped baseline
# and no other runtime owner. The run never resets an unexplained state.
$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    & npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Type checking failed; no live run.' }
    $h2Secret = Read-Host "CV-1 HMI H2: CODESYS PLC password for user '$OpcUser' (masked)" -AsSecureString
    $h2Ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($h2Secret)
    try {
        $env:OPC_USER = $OpcUser
        $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($h2Ptr)
        $h2Args = @()
        if ($Headed) { $h2Args += '--headed' }
        & node (Join-Path $PSScriptRoot 'run-hmi-h2-live.js') @h2Args
        if ($LASTEXITCODE -ne 0) { Write-Warning 'H2 stopped. Evidence is preserved; inspect before any retry.' }
    }
    finally {
        Remove-Item Env:OPC_USER -ErrorAction SilentlyContinue
        Remove-Item Env:OPC_PASSWORD -ErrorAction SilentlyContinue
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($h2Ptr)
    }
}
finally { Pop-Location }
