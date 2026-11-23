#requires -Version 5.1
param([string]$InstallerDirectory=$PSScriptRoot)
$ErrorActionPreference='Stop'
. ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $InstallerDirectory 'Install-SteamHub.ps1'))))
$workspace=Join-Path ([IO.Path]::GetTempPath()) ('SteamHub-updater-tests-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($workspace) | Out-Null
$results=New-Object System.Collections.ArrayList
function Assert([bool]$Value,[string]$Message) { if (-not $Value) { throw $Message } }
function Refuses([scriptblock]$Action,[string]$Message) {
    $refused=$false
    try { & $Action | Out-Null } catch { $refused=$true }
    Assert $refused $Message
    [void]$results.Add($Message)
}
try {
    $root=Split-Path $InstallerDirectory -Parent
    $payload=Join-Path $workspace 'payload'; [IO.Directory]::CreateDirectory((Join-Path $payload 'app')) | Out-Null
    [IO.File]::WriteAllText((Join-Path $payload 'app/SteamHub.exe'),'INERT APP FIXTURE - NEVER EXECUTED')
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $root 'src-tauri/runtime-bundle.zip'),(Join-Path $payload 'runtime'))
    $files=@(Get-ChildItem -LiteralPath $payload -Recurse -File | ForEach-Object { @{path=$_.FullName.Substring($payload.Length+1).Replace('\','/');sha256=(Get-SHHash $_.FullName);bytes=$_.Length} })
    $supported=Get-Content -LiteralPath (Join-Path $InstallerDirectory 'compatibility/supported.json') -Raw | ConvertFrom-Json
    $supported=@(foreach ($s in $supported) { @{steamBuild=$s.steamBuild;steamclientSha256=$s.steamclientSha256;steamuiSha256=$s.steamuiSha256} })
    $manifest=@{schemaVersion=1;product='SteamHub';architecture='x64';version='v1.2.3';compatibility=$supported;files=$files}
    $manifest|ConvertTo-Json -Depth 7|Set-Content -LiteralPath (Join-Path $payload 'update-manifest.json') -Encoding UTF8
    $verified=Test-SHPackage $payload
    [void]$results.Add('Verifies every packaged file and required compatibility metadata.')
    [IO.File]::AppendAllText((Join-Path $payload 'app/SteamHub.exe'),'tampered')
    Refuses { Test-SHPackage $payload } 'Rejects altered payloads before any installation.'
    [IO.File]::WriteAllText((Join-Path $payload 'app/SteamHub.exe'),'INERT APP FIXTURE - NEVER EXECUTED')
    $steam=Join-Path $workspace 'Steam'; [IO.Directory]::CreateDirectory((Join-Path $steam 'config/lua'))|Out-Null
    [IO.File]::WriteAllText((Join-Path $steam 'steam.exe'),'INERT STEAM FIXTURE - NEVER EXECUTED')
    [IO.File]::WriteAllText((Join-Path $steam 'config/lua/user.lua'),'keep this user file')
    [IO.File]::WriteAllText((Join-Path $steam 'opensteamtool.toml'),'# custom user settings')
    $liveSteam=Find-SHSteam $env:STEAMHUB_TEST_STEAM_ROOT
    if (-not $liveSteam) { throw 'Set STEAMHUB_TEST_STEAM_ROOT to a supported Steam DLL fixture directory.' }
    foreach ($name in @('steamclient64.dll','steamui.dll')) { [IO.File]::Copy((Join-Path $liveSteam $name),(Join-Path $steam $name)) }
    $install=Join-Path $workspace 'install'
    $first=Install-SHVerifiedPackage $payload $verified $install $steam -NoShortcut
    Assert $first.runtimeReady 'Expected exact current Steam hashes to qualify.'
    Assert ((Get-Content -LiteralPath (Join-Path $steam 'opensteamtool.toml') -Raw) -eq '# custom user settings') 'Changed existing runtime config.'
    Assert ((Get-Content -LiteralPath (Join-Path $steam 'config/lua/user.lua') -Raw) -eq 'keep this user file') 'Changed Lua file.'
    [void]$results.Add('Fresh install places app/runtime files and preserves existing config and Lua.')
    $second=Install-SHVerifiedPackage $payload $verified $install $steam -NoShortcut
    Assert $second.runtimeReady 'Repeat install must recognize matching runtime.'
    [void]$results.Add('Repeat update safely accepts existing matching runtime files.')
    Restore-SHBackup $install $second.backup
    Restore-SHBackup $install $first.backup
    Assert (-not (Test-Path -LiteralPath $first.executable)) 'Rollback retained a new app executable.'
    Assert (-not (Test-Path -LiteralPath (Join-Path $steam 'OpenSteamTool.dll'))) 'Rollback retained new runtime DLL.'
    Assert (Test-Path -LiteralPath (Join-Path $steam 'config/lua/user.lua')) 'Rollback removed user Lua.'
    [void]$results.Add('Rollback restores originals and retires only new files; user files survive.')
    $third=Install-SHVerifiedPackage $payload $verified $install $steam -NoShortcut
    [IO.File]::AppendAllText($third.executable,'user edit')
    Refuses { Restore-SHBackup $install $third.backup } 'Rollback refuses to overwrite files modified after installation.'
    [IO.File]::WriteAllBytes($third.executable,[IO.File]::ReadAllBytes((Join-Path $payload 'app/SteamHub.exe')))
    Restore-SHBackup $install $third.backup
    [IO.File]::WriteAllText((Join-Path $steam 'OpenSteamTool.dll'),'another runtime')
    Refuses { Install-SHVerifiedPackage $payload $verified $install $steam -NoShortcut } 'Conflicting runtime DLLs stop the whole transaction without overwriting them.'
    Assert (-not (Test-Path -LiteralPath $first.executable)) 'Conflict installed part of the app.'
    Remove-Item -LiteralPath (Join-Path $steam 'OpenSteamTool.dll')
    [IO.File]::WriteAllText((Join-Path $steam 'steamui.dll'),'unsupported build')
    $unknown=Install-SHVerifiedPackage $payload $verified $install $steam -NoShortcut
    Assert (-not $unknown.runtimeReady) 'Unknown build was reported supported.'
    Assert (-not (Test-Path -LiteralPath (Join-Path $steam 'OpenSteamTool.dll'))) 'Unknown build received runtime files.'
    [void]$results.Add('Unknown Steam builds receive the app but no unverified runtime installation.')
    Restore-SHBackup $install $unknown.backup

    $desktop=Join-Path $workspace 'Desktop'
    $linkedDesktop=Join-Path $workspace 'OneDriveDesktop'
    [IO.Directory]::CreateDirectory($desktop) | Out-Null
    New-Item -ItemType Junction -Path $linkedDesktop -Target $desktop | Out-Null
    try {
        $desktopShortcut=Join-Path $linkedDesktop 'SteamHub.lnk'
        function Get-SHDesktopShortcutPath { $desktopShortcut }
        $package=Join-Path $workspace 'fixture.zip'
        [IO.Compression.ZipFile]::CreateFromDirectory($payload,$package)
        $linked=Invoke-SteamHubUpdate -PackagePath $package -InstallDirectory $install -SteamPath $steam -SkipDependencies -SkipRuntime -NoLaunch
        Assert (Test-Path -LiteralPath $linked.executable -PathType Leaf) 'A linked Desktop blocked installation.'
        Assert (-not (Test-Path -LiteralPath $desktopShortcut)) 'Wrote a shortcut through a linked Desktop.'
        Invoke-SteamHubUpdate -InstallDirectory $install -RestoreBackup $linked.backup
        Assert (-not (Test-Path -LiteralPath $linked.executable)) 'Rollback failed with a linked Desktop.'
        [void]$results.Add('Public updater entry point installs and rolls back with a linked Desktop.')
        Refuses { Invoke-SteamHubUpdate -PackagePath $package -InstallDirectory (Join-Path $linkedDesktop 'install') -SkipDependencies -SkipRuntime -NoLaunch } 'Still refuses a linked application install path.'
    } finally {
        [IO.Directory]::Delete($linkedDesktop)
    }
    $desktopShortcut=Join-Path $desktop 'SteamHub.lnk'
    $normal=Install-SHVerifiedPackage $payload $verified $install $steam -SkipRuntime
    Assert (Test-Path -LiteralPath $desktopShortcut -PathType Leaf) 'A normal Desktop did not receive a shortcut.'
    Restore-SHBackup $install $normal.backup
    Assert (-not (Test-Path -LiteralPath $desktopShortcut)) 'Rollback retained a newly created shortcut.'
    [void]$results.Add('Normal Desktop shortcuts still install and roll back.')

    $bad=Join-Path $workspace 'traversal.zip'
    $z=[IO.Compression.ZipFile]::Open($bad,[IO.Compression.ZipArchiveMode]::Create)
    $e=$z.CreateEntry('../outside.txt'); $w=New-Object IO.StreamWriter($e.Open()); $w.Write('bad'); $w.Dispose(); $z.Dispose()
    Refuses { Expand-SHPackage $bad (Join-Path $workspace 'extracted') } 'Rejects archive traversal before extraction.'
    Assert (-not (Test-Path -LiteralPath (Join-Path $workspace 'outside.txt'))) 'Archive traversal wrote outside staging.'
    $report=Join-Path $root 'test-results/updater-tests.json'
    [IO.Directory]::CreateDirectory((Split-Path $report))|Out-Null
    @{passed=$true;powerShell=$PSVersionTable.PSVersion.ToString();checks=$results}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $report -Encoding UTF8
    $results
} finally {
    $tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    $resolved=[IO.Path]::GetFullPath($workspace)
    if ($resolved.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -match '^SteamHub-updater-tests-[a-f0-9]{32}$') { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
