param([string]$OpcUser = 'PLC', [string]$HmiUrl = '', [int]$Port = 5179)
$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    $m8HostSecret = Read-Host 'M8 OPC password (masked; server process only)' -AsSecureString
    $m8HostPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($m8HostSecret)
    try {
        $env:OPC_USER = $OpcUser
        $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($m8HostPointer)
        & node (Join-Path $PSScriptRoot 'host-portal.js') --campaign m8 --preflight
        if ($LASTEXITCODE -ne 0) { throw 'Offline preflight failed. No PLC contacted.' }
        $m8HostArguments = @((Join-Path $PSScriptRoot 'host-portal.js'), '--campaign', 'm8', '--port', [string]$Port)
        if ($HmiUrl) { $m8HostArguments += @('--hmi-url', $HmiUrl) }
        & node @m8HostArguments
        if ($LASTEXITCODE -ne 0) { throw 'Portal host exited with an error; inspect artifacts before another campaign.' }
    }
    finally {
        Remove-Item Env:OPC_USER -ErrorAction SilentlyContinue
        Remove-Item Env:OPC_PASSWORD -ErrorAction SilentlyContinue
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($m8HostPointer)
        $m8HostSecret.Dispose()
    }
}
finally { Pop-Location }
