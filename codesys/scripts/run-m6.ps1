param(
    [string]$OpcUser = 'PLC',
    [ValidateRange(60, 3600)]
    [int]$DurationSeconds = 600,
    [ValidateRange(1, 13)]
    [int]$MaxRuns = 1,
    [switch]$HackathonScope
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$probePath = Join-Path $repoRoot 'codesys\scripts\probe-m6.cjs'
$artifactName = if ($HackathonScope) { 'm6-hackathon-result.json' } else { 'm6-result.json' }
$resultPath = Join-Path $repoRoot "codesys\artifacts\$artifactName"
$secret = Read-Host 'CODESYS PLC password' -AsSecureString
$secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)

try {
    $env:OPC_USER = $OpcUser
    $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
    $env:M6_DURATION_SECONDS = $DurationSeconds.ToString()
    $env:M6_MAX_RUNS = $MaxRuns.ToString()
    $env:M6_SCOPE = if ($HackathonScope) { 'hackathon' } else { 'full' }
    $env:M6_OUTPUT = $resultPath
    Push-Location -LiteralPath $repoRoot
    try {
        & node $probePath
        if ($LASTEXITCODE -ne 0) {
            throw "M6 probe failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    Remove-Item Env:OPC_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:OPC_USER -ErrorAction SilentlyContinue
    Remove-Item Env:M6_DURATION_SECONDS -ErrorAction SilentlyContinue
    Remove-Item Env:M6_MAX_RUNS -ErrorAction SilentlyContinue
    Remove-Item Env:M6_SCOPE -ErrorAction SilentlyContinue
    Remove-Item Env:M6_OUTPUT -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)
}

Write-Host "Non-secret M6 result saved to $resultPath"
