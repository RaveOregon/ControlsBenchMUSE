param([string]$OpcUser = 'PLC', [switch]$Watch, [switch]$PrepareBaseline)
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
        $m10RequestPath = 'artifacts/m10/operator-request.json'
        $m10StatusPath = 'artifacts/m10/operator-status.json'
        New-Item -ItemType Directory -Path 'artifacts/m10' -Force | Out-Null
        $m10LastId = if (Test-Path -LiteralPath $m10RequestPath) { (Get-Content -LiteralPath $m10RequestPath -Raw | ConvertFrom-Json).id } else { '' }
        $m10Prepare = [bool]$PrepareBaseline
        do {
            @{ active = $true; running = $true; requestId = $m10LastId } | ConvertTo-Json | Set-Content -LiteralPath $m10StatusPath -Encoding UTF8
            $m10ExitCode = 1
            try {
                $env:OPC_USER = $OpcUser
                $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($m10SecretPtr)
                if ($m10Prepare) {
                    & node (Join-Path $PSScriptRoot 'prepare-m10-baseline.js')
                    if ($LASTEXITCODE -ne 0) { throw 'Baseline reconciliation failed; no campaign started.' }
                    $env:M10_PREPARATION_DIR = (Get-Content -LiteralPath 'artifacts/m10/preparation-latest.json' -Raw | ConvertFrom-Json).directory
                }
                & node (Join-Path $PSScriptRoot 'run-m10-live.js')
                $m10ExitCode = $LASTEXITCODE
            } catch { Write-Warning $_.Exception.Message }
            finally {
                Remove-Item Env:OPC_USER -ErrorAction SilentlyContinue
                Remove-Item Env:OPC_PASSWORD -ErrorAction SilentlyContinue
                Remove-Item Env:M10_PREPARATION_DIR -ErrorAction SilentlyContinue
            }
            @{ active = [bool]$Watch; running = $false; requestId = $m10LastId; exitCode = $m10ExitCode } | ConvertTo-Json | Set-Content -LiteralPath $m10StatusPath -Encoding UTF8
            if (-not $Watch) { if ($m10ExitCode -ne 0) { throw 'M10 stopped. Preserve the failure evidence; investigate before retrying.' }; break }
            Write-Host 'M10 stopped/finished. Waiting for an explicit bounded operator request; no automatic retry. Ctrl+C closes credentials.'
            $m10IdleDeadline = (Get-Date).AddMinutes(30)
            do {
                Start-Sleep -Milliseconds 500
                if ((Get-Date) -ge $m10IdleDeadline) { return }
                if (-not (Test-Path -LiteralPath $m10RequestPath)) { continue }
                $m10Request = Get-Content -LiteralPath $m10RequestPath -Raw | ConvertFrom-Json
                if ([string]::IsNullOrWhiteSpace($m10Request.id) -or $m10Request.id -eq $m10LastId) { continue }
                $m10LastId = $m10Request.id
                if ($m10Request.action -eq 'stop') { return }
                if ($m10Request.action -notin @('run','prepare_then_run')) { throw 'Invalid fixed M10 operator request' }
                $m10Prepare = $m10Request.action -eq 'prepare_then_run'
                break
            } while ($true)
        } while ($Watch)
    }
    finally {
        Remove-Item Env:OPC_USER -ErrorAction SilentlyContinue
        Remove-Item Env:OPC_PASSWORD -ErrorAction SilentlyContinue
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($m10SecretPtr)
        if ($m10StatusPath) { @{ active = $false; running = $false } | ConvertTo-Json | Set-Content -LiteralPath $m10StatusPath -Encoding UTF8 }
    }
}
finally { Pop-Location }
