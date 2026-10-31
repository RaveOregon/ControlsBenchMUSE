param(
    [string]$OpcUser = 'PLC'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$probePath = Join-Path $repoRoot 'codesys\scripts\probe-m5.cjs'
$resultPath = Join-Path $repoRoot 'codesys\artifacts\m5-result.json'
$secret = Read-Host 'CODESYS PLC password' -AsSecureString
$secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)

try {
    $env:OPC_USER = $OpcUser
    $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
    $env:M5_OUTPUT = $resultPath
    Push-Location -LiteralPath $repoRoot
    try {
        & node $probePath
        if ($LASTEXITCODE -ne 0) {
            throw "M5 probe failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    Remove-Item Env:OPC_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:OPC_USER -ErrorAction SilentlyContinue
    Remove-Item Env:M5_OUTPUT -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)
}

Write-Host "Non-secret M5 result saved to $resultPath"
