param(
    [string]$OpcUser = 'PLC',
    [ValidateRange(1, 3600)]
    [int]$DurationSeconds = 600,
    [ValidateRange(0, 12)]
    [int]$MaxRuns = 0,
    [switch]$Smoke
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$probePath = Join-Path $repoRoot 'codesys\scripts\probe-m3.cjs'
$artifactName = if ($Smoke) { 'm3-smoke-result.json' } else { 'm3-result.json' }
$resultPath = Join-Path $repoRoot "codesys\artifacts\$artifactName"
$secret = Read-Host 'CODESYS PLC password' -AsSecureString
$secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)

try {
    $env:OPC_USER = $OpcUser
    $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
    $env:M3_DURATION_SECONDS = if ($Smoke) { '30' } else { $DurationSeconds.ToString() }
    $env:M3_SMOKE = if ($Smoke) { '1' } else { '0' }
    $env:M3_MAX_RUNS = $MaxRuns.ToString()
    $env:M3_OUTPUT = $resultPath
    Push-Location -LiteralPath $repoRoot
    try {
        & node $probePath
        if ($LASTEXITCODE -ne 0) {
            throw "M3 probe failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    Remove-Item Env:OPC_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:OPC_USER -ErrorAction SilentlyContinue
    Remove-Item Env:M3_DURATION_SECONDS -ErrorAction SilentlyContinue
    Remove-Item Env:M3_SMOKE -ErrorAction SilentlyContinue
    Remove-Item Env:M3_MAX_RUNS -ErrorAction SilentlyContinue
    Remove-Item Env:M3_OUTPUT -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)
}

Write-Host "Non-secret M3 result saved to $resultPath"
