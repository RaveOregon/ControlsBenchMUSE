param(
    [string]$OpcUser = 'PLC'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$probePath = Join-Path $repoRoot 'codesys\scripts\probe-m1.cjs'
$resultPath = Join-Path $repoRoot 'codesys\artifacts\m1-opcua-result.json'
$secret = Read-Host 'CODESYS PLC password' -AsSecureString
$secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)

try {
    $env:OPC_USER = $OpcUser
    $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
    $env:M1_OUTPUT = $resultPath
    Push-Location -LiteralPath $repoRoot
    try {
        & node $probePath
        if ($LASTEXITCODE -ne 0) {
            throw "M1 probe failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    Remove-Item Env:OPC_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:OPC_USER -ErrorAction SilentlyContinue
    Remove-Item Env:M1_OUTPUT -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)
}

Write-Host "Non-secret result saved to $resultPath"
