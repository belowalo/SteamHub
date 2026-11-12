#requires -Version 5.1
<#
Installs or updates the published SteamHub Windows x64 release.
No GitHub account, provider key, Node.js, Rust or PowerShell 7 is required.
#>
[CmdletBinding()]
param(
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'SteamHub'),
    [string]$SteamPath,
    [string]$PackagePath,
    [string]$RestoreBackup,
    [switch]$CheckOnly,
    [switch]$NoLaunch,
    [switch]$SkipDependencies,
    [switch]$SkipRuntime,
    [switch]$NonInteractive
)
$ErrorActionPreference = 'Stop'

function Get-SHHash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Get-SHChild([string]$Root, [string]$Relative) {
    if ([IO.Path]::IsPathRooted($Relative) -or $Relative -match '(^|[\\/])\.\.([\\/]|$)|:') { throw 'Unsafe package path.' }
    $full = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
    if (-not $full.StartsWith($Root.TrimEnd('\')+'\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Path leaves its destination.' }
    return $full
}
function Assert-SHPath([string]$Path) {
    $p = [IO.Path]::GetFullPath($Path)
    while ($p) {
        if (Test-Path -LiteralPath $p) {
            if ((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked paths are unsupported: $p" }
        }
        $parent = Split-Path $p -Parent
        if ($parent -eq $p) { break }; $p = $parent
    }
}
function Write-SHAtomic([string]$Path, [byte[]]$Bytes) {
    Assert-SHPath $Path
    $parent = Split-Path $Path -Parent
    [IO.Directory]::CreateDirectory($parent) | Out-Null
    $temp = Join-Path $parent ('.steamhub-'+[guid]::NewGuid().ToString('N')+'.tmp')
    try {
        [IO.File]::WriteAllBytes($temp,$Bytes)
        # Windows PowerShell 5.1 binds $null to an empty string for this overload.
        if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temp,$Path,($temp+'.previous')) }
        else { [IO.File]::Move($temp,$Path) }
    } finally {
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp }
        if (Test-Path -LiteralPath ($temp+'.previous')) { Remove-Item -LiteralPath ($temp+'.previous') }
    }
}
function Find-SHSteam([string]$Explicit) {
    if ($Explicit) {
        $p = [IO.Path]::GetFullPath($Explicit).TrimEnd('\')
        if (-not (Test-Path -LiteralPath (Join-Path $p 'steam.exe'))) { throw 'SteamPath must contain steam.exe.' }
        Assert-SHPath $p; return $p
    }
    foreach ($key in @('HKCU:\Software\Valve\Steam','HKLM:\Software\WOW6432Node\Valve\Steam','HKLM:\Software\Valve\Steam')) {
        $v = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
        foreach ($p in @($v.SteamPath,$v.InstallPath)) {
            if ($p -and (Test-Path -LiteralPath (Join-Path $p 'steam.exe'))) { Assert-SHPath $p; return [IO.Path]::GetFullPath($p).TrimEnd('\') }
        }
    }
    return $null
}
function Test-SHSteamRunning([string]$Root) {
    return @((Get-Process -Name steam -ErrorAction SilentlyContinue) | Where-Object { -not $_.Path -or [IO.Path]::GetFullPath($_.Path) -eq (Join-Path $Root 'steam.exe') }).Count -gt 0
}
function Get-SHDownload([string]$Url,[string]$OutFile) {
    $u = [uri]$Url
    if ($u.Scheme -ne 'https' -or $u.Host -notin @('github.com','api.github.com','raw.githubusercontent.com')) { throw 'Unexpected download source.' }
    $oldProgress = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
    try {
        for ($attempt=1;$attempt -le 3;$attempt++) {
            try { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile -Headers @{'User-Agent'='SteamHub-Updater'} -TimeoutSec 900; return }
            catch { if ($attempt -eq 3) { throw }; Start-Sleep -Seconds 2 }
        }
    } finally { $ProgressPreference = $oldProgress }
}
function Expand-SHPackage([string]$Archive,[string]$Destination) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        $names = @{}; [long]$size=0
        foreach ($e in $z.Entries) {
            if ($e.FullName.EndsWith('/')) { continue }
            if ($names.ContainsKey($e.FullName)) { throw 'Duplicate archive path.' }
            $names[$e.FullName] = $true
            $out = Get-SHChild $Destination $e.FullName
            $size += $e.Length
            if ($size -gt 800MB -or $e.Length -gt 400MB -or $names.Count -gt 10000) { throw 'Package exceeds supported limits.' }
            Assert-SHPath $out
        }
        foreach ($e in $z.Entries) {
            if ($e.FullName.EndsWith('/')) { continue }
            $out = Get-SHChild $Destination $e.FullName
            [IO.Directory]::CreateDirectory((Split-Path $out -Parent)) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($e,$out,$false)
        }
    } finally { $z.Dispose() }
}
function Test-SHPackage([string]$Root) {
    $m = Get-Content -LiteralPath (Join-Path $Root 'update-manifest.json') -Raw | ConvertFrom-Json
    if ($m.schemaVersion -ne 1 -or $m.version -notmatch '^v\d+\.\d+\.\d+$' -or $m.product -ne 'SteamHub' -or $m.architecture -ne 'x64') { throw 'Unsupported release manifest.' }
    $seen = @{}
    foreach ($f in $m.files) {
        if ($f.path -notmatch '^(app|runtime|dependencies)/' -or $f.sha256 -notmatch '^[a-f0-9]{64}$' -or $seen.ContainsKey($f.path)) { throw 'Invalid release file record.' }
        $seen[$f.path]=$true
        $p = Get-SHChild $Root $f.path
        if (-not (Test-Path -LiteralPath $p -PathType Leaf) -or (Get-SHHash $p) -ne $f.sha256 -or (Get-Item -LiteralPath $p).Length -ne $f.bytes) { throw "Package checksum mismatch: $($f.path)" }
        if ($f.path.StartsWith('runtime/')) {
            $n=$f.path.Substring(8)
            if ($n -notin @('OpenSteamTool.dll','dwmapi.dll','xinput1_4.dll','opensteamtool.toml') -and $n -notmatch '^opensteamtool/(pattern/(steamclient|steamui)|ipc/steamclient)/[a-f0-9]{64}\.toml$') { throw 'Unexpected runtime path.' }
        } elseif ($f.path.StartsWith('app/')) {
            if ($f.path -notin @('app/SteamHub.exe','app/LICENSE','app/README.md','app/THIRD_PARTY_NOTICES.md') -and -not $f.path.StartsWith('app/third-party-licenses/')) { throw 'Unexpected application path.' }
        } elseif ($f.path -notin @('dependencies/MicrosoftEdgeWebView2RuntimeInstallerX64.exe','dependencies/vc_redist.x64.exe')) { throw 'Unexpected dependency.' }
    }
    $actual = @(Get-ChildItem -LiteralPath $Root -Recurse -File)
    if ($actual.Count -ne $seen.Count+1 -or -not $seen.ContainsKey('app/SteamHub.exe')) { throw 'Unexpected or missing package files.' }
    foreach ($p in $actual) {
        $rel=$p.FullName.Substring($Root.TrimEnd('\').Length+1).Replace('\','/')
        if ($rel -ne 'update-manifest.json' -and -not $seen.ContainsKey($rel)) { throw 'Unlisted package file.' }
    }
    foreach ($c in $m.compatibility) {
        if ($c.steamclientSha256 -notmatch '^[a-f0-9]{64}$' -or $c.steamuiSha256 -notmatch '^[a-f0-9]{64}$') { throw "Invalid compatibility record: $($c | ConvertTo-Json -Compress -Depth 3)" }
        foreach ($n in @("runtime/opensteamtool/pattern/steamclient/$($c.steamclientSha256).toml","runtime/opensteamtool/pattern/steamui/$($c.steamuiSha256).toml","runtime/opensteamtool/ipc/steamclient/$($c.steamclientSha256).toml")) {
            if (-not $seen.ContainsKey($n)) { throw 'Incomplete compatibility data.' }
        }
    }
    return $m
}
function Install-SHDependencies([string]$Root) {
    $wv = $false
    foreach ($base in @('HKCU:\Software\Microsoft\EdgeUpdate\Clients','HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients','HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients')) {
        foreach ($key in @(Get-ChildItem -LiteralPath $base -ErrorAction SilentlyContinue)) {
            $v=Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
            if ($v.name -like '*WebView2*' -and $v.pv -and $v.pv -ne '0.0.0.0') { $wv=$true }
        }
    }
    $vc=Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64' -ErrorAction SilentlyContinue
    $needed=@()
    if (-not $wv) { $needed+=@{name='MicrosoftEdgeWebView2RuntimeInstallerX64.exe';args='/silent /install'} }
    if (-not $vc -or $vc.Installed -ne 1 -or $vc.Minor -lt 40) { $needed+=@{name='vc_redist.x64.exe';args='/install /quiet /norestart'} }
    foreach ($d in $needed) {
        $p=Join-Path $Root ('dependencies/'+$d.name)
        $sig=Get-AuthenticodeSignature -LiteralPath $p
        if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch '(^|, )CN=Microsoft Corporation(,|$)') { throw "Microsoft signature verification failed: $($d.name)" }
        Write-Host "Installing Microsoft dependency: $($d.name)"
        $process=Start-Process -FilePath $p -ArgumentList $d.args -Wait -PassThru -WindowStyle Hidden
        if ($process.ExitCode -notin @(0,1638,3010)) { throw "Dependency installation failed ($($process.ExitCode)): $($d.name)" }
        if ($process.ExitCode -eq 3010) { Write-Warning 'Windows needs a restart to complete dependency installation.' }
    }
}
function Restore-SHBackup([string]$Root,[string]$Backup) {
    $container=Get-SHChild $Root 'backups'
    $backupRoot=[IO.Path]::GetFullPath($Backup).TrimEnd('\')
    if (-not $backupRoot.StartsWith($container+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Backup is outside this installation.' }
    Assert-SHPath $backupRoot
    $state=Get-Content -LiteralPath (Join-Path $backupRoot 'transaction.json') -Raw | ConvertFrom-Json
    if ($state.installRoot -ne $Root -or $state.schemaVersion -ne 1) { throw 'Backup belongs to another installation.' }
    if ($state.steamRoot -and (Test-SHSteamRunning $state.steamRoot)) { throw 'Exit Steam completely before restoring.' }
    $seen=@{}
    foreach ($r in $state.records) {
        $path=[IO.Path]::GetFullPath($r.target)
        $appRoot=Get-SHChild $Root 'versions'
        $desktop=Join-Path ([Environment]::GetFolderPath('Desktop')) 'SteamHub.lnk'
        $valid=$path.StartsWith($appRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or $path -eq (Get-SHChild $Root 'installed.json') -or $path -eq $desktop
        if (-not $valid -and $state.steamRoot) {
            $prefix=$state.steamRoot.TrimEnd('\')+'\'
            if ($path.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) {
                $n=$path.Substring($prefix.Length).Replace('\','/')
                $valid=$n -in @('OpenSteamTool.dll','dwmapi.dll','xinput1_4.dll','opensteamtool.toml') -or $n -match '^opensteamtool/(pattern/(steamclient|steamui)|ipc/steamclient)/[a-f0-9]{64}\.toml$'
            }
        }
        if (-not $valid -or $seen.ContainsKey($path) -or $r.original -notmatch '^originals/\d+\.bin$') { throw 'Invalid rollback target.' }
        $seen[$path]=$true; Assert-SHPath $path
        if ($r.existed -and (Get-SHHash (Get-SHChild $backupRoot $r.original)) -ne $r.originalHash) { throw 'Original backup checksum mismatch.' }
        if (Test-Path -LiteralPath $path) {
            $h=Get-SHHash $path
            if ($h -ne $r.installedHash -and (-not $r.existed -or $h -ne $r.originalHash)) { throw "File changed after update; rollback preserved it: $path" }
        }
        if ((Get-Process -Name steamhub -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $path })) { throw 'Close SteamHub before restoring.' }
    }
    foreach ($r in $state.records) {
        if ($r.existed) { Write-SHAtomic $r.target ([IO.File]::ReadAllBytes((Get-SHChild $backupRoot $r.original))) }
        elseif (Test-Path -LiteralPath $r.target) { [IO.File]::Move($r.target,(Get-SHChild $backupRoot ('retired-'+[guid]::NewGuid().ToString('N')+'.bin'))) }
    }
    Write-Host "Restored files from $backupRoot. Dependencies and user profiles were retained."
}
function Install-SHVerifiedPackage([string]$Root,$Manifest,[string]$InstallRoot,[string]$SteamRoot,[switch]$NoShortcut,[switch]$SkipRuntime) {
    Assert-SHPath $InstallRoot
    $versionRoot=Get-SHChild $InstallRoot ('versions/'+$Manifest.version)
    $runtimeReady=$false; $runtimeMessage='Steam not found. Install Steam, then run this updater again.'
    if ($SteamRoot -and -not $SkipRuntime) {
        if (Test-SHSteamRunning $SteamRoot) { throw 'Exit Steam completely before installing the runtime.' }
        $client=Join-Path $SteamRoot 'steamclient64.dll'; $ui=Join-Path $SteamRoot 'steamui.dll'
        if ((Test-Path -LiteralPath $client) -and (Test-Path -LiteralPath $ui)) {
            $ch=Get-SHHash $client; $uh=Get-SHHash $ui
            $runtimeReady=@($Manifest.compatibility | Where-Object { $_.steamclientSha256 -eq $ch -and $_.steamuiSha256 -eq $uh }).Count -gt 0
        }
        if (-not $runtimeReady) { $runtimeMessage='No reviewed compatibility data for this Steam build. Steam files were preserved; rerun after a newer release is published.' }
        if ($runtimeReady -and (Test-Path -LiteralPath (Join-Path $SteamRoot 'stbase.dll'))) { throw 'Another SteamTools runtime (stbase.dll) is present. It was preserved. Resolve the runtime conflict before retrying.' }
    } elseif ($SkipRuntime) { $runtimeMessage='Runtime installation was skipped.' }
    $plan=New-Object System.Collections.ArrayList
    foreach ($f in $Manifest.files) {
        $target=$null
        if ($f.path.StartsWith('app/')) { $target=Get-SHChild $versionRoot $f.path.Substring(4) }
        elseif ($f.path.StartsWith('runtime/') -and $runtimeReady) {
            $target=Get-SHChild $SteamRoot $f.path.Substring(8)
            if (Test-Path -LiteralPath $target) {
                $h=Get-SHHash $target
                if ($h -eq $f.sha256) { continue }
                if ($target.EndsWith('opensteamtool.toml',[StringComparison]::OrdinalIgnoreCase)) { continue }
                if ($target.EndsWith('.dll',[StringComparison]::OrdinalIgnoreCase)) { throw "A different runtime DLL already exists; preserved it: $target" }
            }
        }
        if ($target) {
            Assert-SHPath $target
            if ((Test-Path -LiteralPath $target) -and (Get-SHHash $target) -eq $f.sha256) { continue }
            if (Get-Process -Name steamhub -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $target }) { throw 'Close SteamHub before updating this version.' }
            [void]$plan.Add(@{target=$target;bytes=[IO.File]::ReadAllBytes((Get-SHChild $Root $f.path))})
        }
    }
    if ($SteamRoot -and $runtimeReady -and (Test-SHSteamRunning $SteamRoot)) { throw 'Steam reopened during preparation; close it and retry.' }
    if (-not $NoShortcut) {
        $desktop=[Environment]::GetFolderPath('Desktop')
        if ($desktop) {
            $tempLink=Join-Path $Root 'SteamHub.lnk'
            $shell=New-Object -ComObject WScript.Shell
            $link=$shell.CreateShortcut($tempLink); $link.TargetPath=Join-Path $versionRoot 'SteamHub.exe'; $link.WorkingDirectory=$versionRoot; $link.Description='SteamHub'; $link.Save()
            [void]$plan.Add(@{target=(Join-Path $desktop 'SteamHub.lnk');bytes=[IO.File]::ReadAllBytes($tempLink)})
        }
    }
    $installed=@{version=$Manifest.version;executable=(Join-Path $versionRoot 'SteamHub.exe');steamRoot=$SteamRoot;updatedAt=[DateTime]::UtcNow.ToString('o')}
    [void]$plan.Add(@{target=(Get-SHChild $InstallRoot 'installed.json');bytes=[Text.Encoding]::UTF8.GetBytes(($installed|ConvertTo-Json))})
    $backupRoot=Get-SHChild $InstallRoot ('backups/'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'-'+[guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory((Join-Path $backupRoot 'originals')) | Out-Null
    $records=@(); $i=0
    foreach ($p in $plan) {
        Assert-SHPath $p.target
        $exists=Test-Path -LiteralPath $p.target; $original='originals/'+$i+'.bin'; $oldHash=$null
        if ($exists) { $oldHash=Get-SHHash $p.target; [IO.File]::Copy($p.target,(Join-Path $backupRoot $original)); if ((Get-SHHash (Join-Path $backupRoot $original)) -ne $oldHash) { throw 'Backup verification failed.' } }
        $sha=[Security.Cryptography.SHA256]::Create()
        try { $newHash=([BitConverter]::ToString($sha.ComputeHash($p.bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
        $records+=@{target=$p.target;existed=$exists;original=$original;originalHash=$oldHash;installedHash=$newHash}; $i++
    }
    $state=@{schemaVersion=1;installRoot=$InstallRoot;steamRoot=$SteamRoot;records=$records}
    Write-SHAtomic (Join-Path $backupRoot 'transaction.json') ([Text.Encoding]::UTF8.GetBytes(($state|ConvertTo-Json -Depth 6)))
    try {
        for ($i=0;$i -lt $plan.Count;$i++) {
            Write-SHAtomic $plan[$i].target $plan[$i].bytes
            if ((Get-SHHash $plan[$i].target) -ne $records[$i].installedHash) { throw 'Installed file checksum mismatch.' }
        }
    } catch {
        $failure=$_
        try { Restore-SHBackup $InstallRoot $backupRoot } catch { Write-Warning "Rollback requires attention: $_. Backup: $backupRoot" }
        throw $failure
    }
    if ($runtimeReady) { Write-Host 'Steam runtime and matching compatibility files are ready.' } else { Write-Warning $runtimeMessage }
    Write-Host "Installed $($Manifest.version): $($installed.executable)"
    Write-Host "Backup: $backupRoot"
    return [pscustomobject]@{version=$Manifest.version;executable=$installed.executable;backup=$backupRoot;runtimeReady=$runtimeReady}
}
function Invoke-SteamHubUpdate {
    [CmdletBinding()]
    param([string]$InstallDirectory=(Join-Path $env:LOCALAPPDATA 'SteamHub'),[string]$SteamPath,[string]$PackagePath,[string]$RestoreBackup,[switch]$CheckOnly,[switch]$NoLaunch,[switch]$SkipDependencies,[switch]$SkipRuntime,[switch]$NonInteractive)
    if (-not [Environment]::Is64BitOperatingSystem -or -not [Environment]::Is64BitProcess) { throw 'Run the 64-bit Windows PowerShell app on Windows x64.' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $installRoot=[IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\'); Assert-SHPath $installRoot
    if ($RestoreBackup) {
        [IO.Directory]::CreateDirectory($installRoot) | Out-Null
        $restoreLock=[IO.File]::Open((Join-Path $installRoot '.update-lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        try { Restore-SHBackup $installRoot $RestoreBackup } finally { $restoreLock.Dispose() }
        return
    }
    $work=Join-Path ([IO.Path]::GetTempPath()) ('SteamHub-update-'+[guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($work) | Out-Null
    $lock=$null
    try {
        [IO.Directory]::CreateDirectory($installRoot) | Out-Null
        $lock=[IO.File]::Open((Join-Path $installRoot '.update-lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        $release=$null
        if (-not $PackagePath) {
            Write-Host 'Checking the latest published SteamHub release...'
            $release=Invoke-RestMethod -Uri 'https://api.github.com/repos/belowalo/SteamHub/releases/latest' -Headers @{'User-Agent'='SteamHub-Updater';Accept='application/vnd.github+json'} -TimeoutSec 60
            if ($release.draft -or $release.prerelease) { throw 'Latest stable release is unavailable.' }
            $asset=@($release.assets | Where-Object { $_.name -eq 'SteamHub-update.zip' })
            if ($asset.Count -ne 1 -or $asset[0].size -gt 400MB) { throw 'Release is missing its supported update package.' }
            $prefix='https://github.com/belowalo/SteamHub/releases/download/'+$release.tag_name+'/'
            if (-not $asset[0].browser_download_url.StartsWith($prefix,[StringComparison]::Ordinal)) { throw 'Unexpected release URL.' }
            $digest=$asset[0].digest
            if ($digest -notmatch '^sha256:[a-f0-9]{64}$') { throw 'GitHub did not supply a SHA-256 digest. Retry later.' }
            $PackagePath=Join-Path $work 'release.zip'
            Write-Host "Downloading $($release.tag_name) ($([Math]::Round($asset[0].size/1MB)) MB)..."
            Get-SHDownload $asset[0].browser_download_url $PackagePath
            if ((Get-Item -LiteralPath $PackagePath).Length -ne $asset[0].size -or (Get-SHHash $PackagePath) -ne $digest.Substring(7)) { throw 'Release download checksum mismatch. Nothing installed.' }
        }
        $payload=Join-Path $work 'payload'; [IO.Directory]::CreateDirectory($payload) | Out-Null
        Expand-SHPackage ([IO.Path]::GetFullPath($PackagePath)) $payload
        $m=Test-SHPackage $payload
        if ($release -and $release.tag_name -ne $m.version) { throw 'Release version and package disagree.' }
        if ($CheckOnly) { Write-Host "Verified $($m.version), $(@($m.files).Count) files. No app or Steam files changed."; return }
        $steam=Find-SHSteam $SteamPath
        while ($steam -and -not $SkipRuntime -and (Test-SHSteamRunning $steam)) {
            if ($NonInteractive) { throw 'Steam is running. Exit Steam and rerun, or use -SkipRuntime.' }
            Write-Host 'Exit Steam using Steam > Exit. Your games will not be force-closed.'
            [void](Read-Host 'Press Enter after Steam has completely closed')
        }
        if (-not $SkipDependencies) { Install-SHDependencies $payload }
        $result=Install-SHVerifiedPackage $payload $m $installRoot $steam -SkipRuntime:$SkipRuntime
        Write-Host 'Provider keys, website logins, app profiles and existing Lua files were not copied or changed.'
        if (-not $NoLaunch) { Start-Process -FilePath $result.executable -WorkingDirectory (Split-Path $result.executable) -WindowStyle Hidden }
        return $result
    } finally {
        if ($lock) { $lock.Dispose() }
        # Only remove this invocation's fresh temporary workspace; keep durable backups.
        $tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
        $resolved=[IO.Path]::GetFullPath($work)
        if ($resolved.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -match '^SteamHub-update-[a-f0-9]{32}$') {
            Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
if ($MyInvocation.InvocationName -ne '.') { Invoke-SteamHubUpdate @PSBoundParameters }
