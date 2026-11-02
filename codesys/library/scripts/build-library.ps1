param(
    [string]$CodesysExe = 'C:\Program Files\CODESYS 3.5.22.30\CODESYS\Common\CODESYS.exe',
    [string]$Profile = 'CODESYS V3.5 SP22 Patch 3',
    [int]$TimeoutSeconds = 900
)
# Offline library build in a dedicated hidden --noUI CODESYS process. Records the
# Git commit and any uncommitted library paths so a result can be tied to source.
# No PLC login, download or online operation is performed.
$ErrorActionPreference = 'Stop'
$cbLibraryRoot = Split-Path $PSScriptRoot -Parent
$cbRepo = (git -C $cbLibraryRoot rev-parse --show-toplevel).Trim()
$cbCommit = (git -C $cbRepo rev-parse HEAD).Trim()
$cbBranch = (git -C $cbRepo rev-parse --abbrev-ref HEAD).Trim()
$cbDirty = @(git -C $cbRepo status --porcelain --untracked-files=all -- codesys/library docs/plc-adapter-standard.md | Where-Object { $_ })
$cbPlugin = Join-Path (Split-Path (Split-Path $CodesysExe -Parent) -Parent) 'PlugIns\f3f46134-4002-4515-a365-46c6903804cf\1.0.0.0\FileBasedStorage.plugin.dll'
$cbFbsVersion = if (Test-Path -LiteralPath $cbPlugin) { (Get-Item -LiteralPath $cbPlugin).VersionInfo.FileVersion } else { $null }
$cbStamp = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH-mm-ss-fffZ')
$cbRequestDir = Join-Path $cbLibraryRoot 'artifacts\requests'
New-Item -ItemType Directory -Force -Path $cbRequestDir | Out-Null
$cbRequestPath = Join-Path $cbRequestDir "$cbStamp.json"
$cbRequest = [ordered]@{
    requestedUtc = [DateTime]::UtcNow.ToString('o')
    gitCommit = $cbCommit
    gitBranch = $cbBranch
    dirtyPaths = @($cbDirty | ForEach-Object { $_.Substring(3) })
    codesysExecutable = $CodesysExe
    profile = $Profile
    fbsPlugin = $cbFbsVersion
}
[IO.File]::WriteAllText($cbRequestPath, ($cbRequest | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
if ($cbDirty.Count) { Write-Host "Development build from a dirty tree ($($cbDirty.Count) paths); it cannot be promoted." }
$env:CB_BUILD_REQUEST = $cbRequestPath
& (Join-Path $PSScriptRoot 'invoke-headless.ps1') -Script (Join-Path $PSScriptRoot 'build-library.py') -ResultPointer 'artifacts\latest.json' -TimeoutSeconds $TimeoutSeconds -CodesysExe $CodesysExe -Profile $Profile
exit $LASTEXITCODE
