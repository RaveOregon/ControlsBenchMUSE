param([string]$OpcUser = 'PLC', [int]$Port = 5181, [ValidateSet('auto','enabled','disabled')][string]$Commands = 'auto', [switch]$Portal, [switch]$HmiHeadless)
# CV-1 operator HMI against the live M8 controller. Prompts for the PLC password as a SecureString;
# it exists only in this PowerShell process and the HMI service child process environment.
$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    $hmiSecret = Read-Host "CV-1 HMI: CODESYS PLC password for user '$OpcUser' (masked)" -AsSecureString
    $hmiPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($hmiSecret)
    try {
        $env:OPC_USER = $OpcUser
        $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($hmiPtr)
        if ($Portal) {
            $portalArgs = @('--live', '--hmi-port', $Port, '--commands', $Commands)
            if ($HmiHeadless) { $portalArgs += '--hmi-headless' }
            & node (Join-Path $PSScriptRoot 'run-hmi-portal.js') @portalArgs
        } else {
            & node (Join-Path $PSScriptRoot 'run-hmi.js') --live --port $Port --commands $Commands
        }
    }
    finally {
        Remove-Item Env:OPC_USER -ErrorAction SilentlyContinue
        Remove-Item Env:OPC_PASSWORD -ErrorAction SilentlyContinue
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($hmiPtr)
    }
}
finally { Pop-Location }
