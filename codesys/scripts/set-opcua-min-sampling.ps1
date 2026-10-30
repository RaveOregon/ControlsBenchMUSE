param(
    [ValidateRange(1, 1000)]
    [int]$Milliseconds = 20
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdministrator) {
    throw 'Run this script from a PowerShell window opened with Run as administrator.'
}

$configPath = Join-Path $env:WINDIR 'System32\config\systemprofile\AppData\Roaming\CODESYS\CODESYSControlWinV3x64\26DDB80B\CODESYSControl.cfg'
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "Active Control Win configuration was not found at $configPath"
}

$content = [IO.File]::ReadAllText($configPath)
$sectionMatch = [regex]::Match($content, '(?m)^\[CmpOPCUAServer\]\s*$')
if (-not $sectionMatch.Success) {
    throw 'The active configuration does not contain a [CmpOPCUAServer] section.'
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = "$configPath.controlsbench-$timestamp.bak"
Copy-Item -LiteralPath $configPath -Destination $backupPath -ErrorAction Stop

$lineBreak = if ($content.Contains("`r`n")) { "`r`n" } else { "`n" }
$settingPattern = '(?m)^\s*ItemMinSamplingRate\s*=.*$'
$replacement = "ItemMinSamplingRate=$Milliseconds ; ControlsBench measured connector experiment"

if ([regex]::IsMatch($content, $settingPattern)) {
    $updated = [regex]::Replace($content, $settingPattern, $replacement, 1)
}
else {
    $sectionLineEnd = $content.IndexOf("`n", $sectionMatch.Index)
    if ($sectionLineEnd -lt 0) {
        $updated = $content + $lineBreak + $replacement + $lineBreak
    }
    else {
        $insertAt = $sectionLineEnd + 1
        $updated = $content.Insert($insertAt, $replacement + $lineBreak)
    }
}

$utf8WithoutBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($configPath, $updated, $utf8WithoutBom)

$written = [IO.File]::ReadAllText($configPath)
if ($written -notmatch "(?m)^ItemMinSamplingRate=$Milliseconds(?:\s|$)") {
    Copy-Item -LiteralPath $backupPath -Destination $configPath -Force
    throw 'Verification failed; the original configuration was restored.'
}

Write-Host "Set CmpOPCUAServer.ItemMinSamplingRate to $Milliseconds ms."
Write-Host "Backup: $backupPath"
Write-Host 'Start Control Win, then rerun the M0 OPC UA probe to measure the revised interval.'
