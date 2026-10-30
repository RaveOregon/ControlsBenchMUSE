param(
    [string]$OpcUser = 'PLC'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runnerPath = Join-Path $repoRoot 'scripts\run-m7-live.js'
$resultPath = Join-Path $repoRoot 'artifacts\m7\m7-live-result.json'
$tracePath = Join-Path $repoRoot 'artifacts\m7\m7-live-trace.json'
$secret = Read-Host 'CODESYS PLC password' -AsSecureString
$secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)

try {
    $env:OPC_USER = $OpcUser
    $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
    $env:M7_OUTPUT = $resultPath
    $env:M7_TRACE = $tracePath
    Push-Location -LiteralPath $repoRoot
    try {
        & node $runnerPath
        if ($LASTEXITCODE -ne 0) {
            throw "M7 live run failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    Remove-Item Env:OPC_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:OPC_USER -ErrorAction SilentlyContinue
    Remove-Item Env:M7_OUTPUT -ErrorAction SilentlyContinue
    Remove-Item Env:M7_TRACE -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)
}

Write-Host "M7 result saved to $resultPath"
Write-Host "M7 trace saved to $tracePath"
