param(
    [ValidateSet('PreRestart', 'PostRestart')]
    [string]$Phase = 'PreRestart',
    [string]$OpcUser = 'PLC'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$probePath = Join-Path $repoRoot 'codesys\scripts\probe-m2.cjs'
$resultPath = Join-Path $repoRoot 'codesys\artifacts\m2-opcua-result.json'
$tracePath = Join-Path $repoRoot 'codesys\artifacts\m2-coherence-trace.jsonl'
$secret = Read-Host 'CODESYS PLC password' -AsSecureString
$secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)

try {
    $env:OPC_USER = $OpcUser
    $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
    $env:M2_OUTPUT = $resultPath
    $env:M2_TRACE = $tracePath
    $arguments = @($probePath)
    if ($Phase -eq 'PostRestart') {
        $arguments += '--post-restart'
    }
    Push-Location -LiteralPath $repoRoot
    try {
        & node @arguments
        if ($LASTEXITCODE -ne 0) {
            throw "M2 $Phase probe failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    Remove-Item Env:OPC_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:OPC_USER -ErrorAction SilentlyContinue
    Remove-Item Env:M2_OUTPUT -ErrorAction SilentlyContinue
    Remove-Item Env:M2_TRACE -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)
}

Write-Host "Non-secret result saved to $resultPath"
if ($Phase -eq 'PreRestart') {
    Write-Host "Raw 10,000-image trace saved to $tracePath"
    Write-Host 'Next: in CODESYS choose Online > Reset Cold, start RUN, then rerun with -Phase PostRestart.'
}
