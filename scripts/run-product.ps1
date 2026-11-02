param(
    [ValidateSet('preview', 'recorded', 'm8', 'wonder')][string]$Mode = 'preview',
    [int]$Port = 5190,
    [int]$HmiPort = 5191,
    [string]$OpcUser = 'PLC',
    [switch]$SkipBuild,
    [switch]$HeadedHmi
)
$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
$cbOldBrowser = $env:CONTROLSBENCH_HMI_BROWSER
$cbOldWonderModule = $env:CONTROLSBENCH_WONDER_PROCESS_MODULE
$cbPasswordPointer = [IntPtr]::Zero
try {
    if (-not $env:CONTROLSBENCH_HMI_BROWSER -and (Test-Path -LiteralPath 'C:\Program Files\Google\Chrome\Application\chrome.exe')) {
        $env:CONTROLSBENCH_HMI_BROWSER = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
    }
    if (-not (Test-Path -LiteralPath 'node_modules/typescript')) { throw 'Install root dependencies first: npm ci' }
    if (-not (Test-Path -LiteralPath 'ui/node_modules/vite')) { throw 'Install UI dependencies first: npm --prefix ui ci' }
    if (-not $SkipBuild) {
        & npm.cmd --prefix ui run build
        if ($LASTEXITCODE -ne 0) { throw 'UI build failed; application not started.' }
    }
    if (-not (Test-Path -LiteralPath 'ui/dist/index.html')) { throw 'Build the UI first: npm --prefix ui run build' }
    if ($Mode -eq 'wonder') {
        if (-not $env:CONTROLSBENCH_WONDER_PROCESS_MODULE) {
            $env:CONTROLSBENCH_WONDER_PROCESS_MODULE = Join-Path $PSScriptRoot '../src/live/wonder-process/index.ts'
        }
        foreach ($cbName in @('CONTROLSBENCH_WONDER_PROCESS_MODULE', 'CONTROLSBENCH_WONDER_PROCESS_COMMIT', 'CONTROLSBENCH_WONDER_HANDOFF', 'CONTROLSBENCH_WONDER_HANDOFF_SHA256', 'CONTROLSBENCH_WONDER_PRICING_REVIEWED', 'MODEL_API_KEY')) {
            if (-not [Environment]::GetEnvironmentVariable($cbName)) { throw "Live Wonder requires the reviewed isolated adapter handoff and private model configuration; missing $cbName. No PLC connection made." }
        }
    }
    $cbNodeArgs = @((Join-Path $PSScriptRoot 'run-hmi-portal.js'), '--portal-port', "$Port", '--hmi-port', "$HmiPort")
    if (-not $HeadedHmi) { $cbNodeArgs += '--hmi-headless' }
    if ($Mode -eq 'preview' -or $Mode -eq 'recorded') {
        $cbCampaign = if ($Mode -eq 'recorded') { 'wonder-recorded' } else { 'fixture-adaptive' }
        $cbNodeArgs += @('--fixture', 'm10-final-held', '--campaign', $cbCampaign)
    } else {
        $cbSecret = Read-Host "ControlsBench $Mode : PLC password for '$OpcUser' (masked)" -AsSecureString
        $cbPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($cbSecret)
        $env:OPC_USER = $OpcUser
        $env:OPC_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($cbPasswordPointer)
        $cbNodeArgs += @('--live', '--campaign', $Mode, '--commands', 'disabled')
    }
    Write-Host "ControlsBench $Mode : http://127.0.0.1:$Port/"
    Write-Host 'Opening the application does not start a campaign. Use Start Campaign in the portal. Ctrl+C stops the services.'
    if ($Mode -eq 'preview') { Write-Host 'Preview uses an explicit fake connector/provider and a recorded HMI fixture. No PLC or paid model connection.' }
    if ($Mode -eq 'recorded') { Write-Host 'Recorded review uses historical M10 measurements and a deterministic provider fixture. No new PLC or paid model connection.' }
    & node @cbNodeArgs
    if ($LASTEXITCODE -ne 0) { throw "ControlsBench service exited with code $LASTEXITCODE" }
} finally {
    if ($cbPasswordPointer -ne [IntPtr]::Zero) {
        Remove-Item Env:OPC_PASSWORD -ErrorAction SilentlyContinue
        Remove-Item Env:OPC_USER -ErrorAction SilentlyContinue
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($cbPasswordPointer)
    }
    if ($null -eq $cbOldBrowser) { Remove-Item Env:CONTROLSBENCH_HMI_BROWSER -ErrorAction SilentlyContinue }
    else { $env:CONTROLSBENCH_HMI_BROWSER = $cbOldBrowser }
    if ($null -eq $cbOldWonderModule) { Remove-Item Env:CONTROLSBENCH_WONDER_PROCESS_MODULE -ErrorAction SilentlyContinue }
    else { $env:CONTROLSBENCH_WONDER_PROCESS_MODULE = $cbOldWonderModule }
    Pop-Location
}
