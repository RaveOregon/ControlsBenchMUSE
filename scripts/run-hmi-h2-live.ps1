param([string]$OpcUser = 'PLC', [switch]$Headed, [switch]$Watch, [string]$RecoverFrom = '')
# H2 live verification of the CV-1 operator HMI. Prompts for the PLC password as a SecureString; it exists only in
# this PowerShell process and the child process environment. Requires M8 build 8001 in RUN, a clean stopped baseline
# and no other runtime owner. The run never resets an unexplained state.
#
# -Watch keeps the credential in this process after a run and waits for an explicit request in
# artifacts/hmi/h2/operator-request.json ({"id":"<new id>","action":"run"|"stop"}). It never retries by itself and
# clears the credential on stop, Ctrl+C or 30 minutes idle.
#
# -RecoverFrom <saved failed run> first runs the explicit, recorded reconciliation of that run's held PLC state
# (scripts/recover-hmi-h2-baseline.js). H2 runs only if the reconciliation passes.
$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    & npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Type checking failed; no live run.' }
    $h2Secret = Read-Host "CV-1 HMI H2: CODESYS PLC password for user '$OpcUser' (masked)" -AsSecureString
    $h2Ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($h2Secret)
    $h2RequestPath = 'artifacts/hmi/h2/operator-request.json'
    $h2StatusPath = 'artifacts/hmi/h2/operator-status.json'
    New-Item -ItemType Directory -Path 'artifacts/hmi/h2' -Force | Out-Null
    $h2LastId = if (Test-Path -LiteralPath $h2RequestPath) { (Get-Content -LiteralPath $h2RequestPath -Raw | ConvertFrom-Json).id } else { '' }
    try {
        do {
            @{ active = $true; running = $true; requestId = $h2LastId } | ConvertTo-Json | Set-Content -LiteralPath $h2StatusPath -Encoding UTF8
            $h2Exit = 1
            try {
                $env:OPC_USER = $OpcUser
                $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($h2Ptr)
                $h2Recovered = $true
                if ($RecoverFrom) {
                    & node (Join-Path $PSScriptRoot 'recover-hmi-h2-baseline.js') $RecoverFrom
                    $h2Recovered = ($LASTEXITCODE -eq 0)
                    $RecoverFrom = ''
                    if (-not $h2Recovered) { Write-Warning 'Baseline reconciliation failed; H2 not started. Inspect the recovery evidence.' }
                    $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($h2Ptr)
                }
                if ($h2Recovered) {
                    $h2Args = @()
                    if ($Headed) { $h2Args += '--headed' }
                    & node (Join-Path $PSScriptRoot 'run-hmi-h2-live.js') @h2Args
                    $h2Exit = $LASTEXITCODE
                }
                if ($h2Exit -ne 0) { Write-Warning 'H2 stopped. Evidence is preserved; inspect before any retry.' }
            }
            finally {
                Remove-Item Env:OPC_USER -ErrorAction SilentlyContinue
                Remove-Item Env:OPC_PASSWORD -ErrorAction SilentlyContinue
            }
            @{ active = [bool]$Watch; running = $false; requestId = $h2LastId; exitCode = $h2Exit } | ConvertTo-Json | Set-Content -LiteralPath $h2StatusPath -Encoding UTF8
            if (-not $Watch) { break }
            Write-Host 'H2 finished. Waiting for an explicit request in artifacts/hmi/h2/operator-request.json; no automatic retry. Ctrl+C clears the credential.'
            $h2IdleDeadline = (Get-Date).AddMinutes(30)
            $h2Next = $false
            do {
                Start-Sleep -Milliseconds 500
                if ((Get-Date) -ge $h2IdleDeadline) { break }
                if (-not (Test-Path -LiteralPath $h2RequestPath)) { continue }
                $h2Request = Get-Content -LiteralPath $h2RequestPath -Raw | ConvertFrom-Json
                if ([string]::IsNullOrWhiteSpace($h2Request.id) -or $h2Request.id -eq $h2LastId) { continue }
                $h2LastId = $h2Request.id
                if ($h2Request.action -eq 'run') { $h2Next = $true }
                break
            } while ($true)
        } while ($Watch -and $h2Next)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($h2Ptr)
        @{ active = $false; running = $false } | ConvertTo-Json | Set-Content -LiteralPath $h2StatusPath -Encoding UTF8
    }
}
finally { Pop-Location }
