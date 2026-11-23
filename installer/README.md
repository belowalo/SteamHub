# Install or update SteamHub

Windows 10/11 x64. Open the regular **Windows PowerShell** app and paste:

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/belowalo/SteamHub/main/Install-SteamHub.ps1')))
```

This executes the published installer script. [Read the script first](https://github.com/belowalo/SteamHub/blob/main/Install-SteamHub.ps1). No execution-policy or antivirus changes are required. Run the same command again to get the latest published stable release. GitHub sign-in is not needed.

The updater downloads `SteamHub-update.zip`, verifies GitHub's SHA-256 digest and every payload file, installs Microsoft WebView2 / Visual C++ x64 only if needed, and places SteamHub in `%LOCALAPPDATA%\SteamHub\versions\<version>`. It creates a desktop shortcut. Microsoft installers may request administrator approval; a required reboot is reported.

Steam must already be installed. The updater finds it in the registry, waits for you to exit it, and installs the reviewed bundled OpenSteamTool runtime plus hash-matched compatibility metadata. Another runtime DLL stops installation rather than being overwritten. A Steam build with no reviewed metadata receives the app update only, with a warning. Provider keys, profiles, Lua files and website logins stay on each PC. No provider key is included.

Existing NSIS/portable installations are retained; the new desktop shortcut opens the updater-managed copy. Both use the same current-user SteamHub profile. The updater never imports another PC's profile or keychain. This is an on-demand updater, not a background service. Future fixes require publishing a new reviewed release; this cannot manufacture unknown Steam compatibility data.

## Options

Download `Install-SteamHub.ps1` from the release if you want a local copy. On systems allowing local scripts:

```powershell
.\Install-SteamHub.ps1 -CheckOnly
.\Install-SteamHub.ps1 -SteamPath 'D:\Steam' -NoLaunch
.\Install-SteamHub.ps1 -SkipRuntime
.\Install-SteamHub.ps1 -PackagePath 'D:\Downloads\SteamHub-update.zip'
.\Install-SteamHub.ps1 -RestoreBackup '<backup folder printed after installation>'
```

`-CheckOnly` downloads/extracts/verifies without installing dependencies, app files or runtime files. `-SkipDependencies` is available for managed PCs where prerequisites are already provisioned. `-NonInteractive` fails if Steam is running instead of waiting. A custom `-InstallDirectory` must be supplied again for later updates and rollback. Local `-PackagePath` packages must come from a trusted release: only the online path checks GitHub's published digest.

Backups are stored under `%LOCALAPPDATA%\SteamHub\backups`. Rollback validates all originals and refuses to overwrite later edits. New files are moved into the backup rather than permanently deleted. Dependency installations, empty directories and app profiles are retained on rollback. No game launch or download is performed by this installer.

## Publishing another version

Keep app, Tauri and Cargo versions in sync; update `installer/compatibility/supported.json` only after validating metadata against the exact DLLs. Run the normal app checks, `installer/Test-Updater.ps1`, build the NSIS package, then:

```powershell
python scripts/package-release.py
python scripts/refresh-production.py
python scripts/package-update.py
```

Publish the installer script, update ZIP, production ZIP, source ZIP, NSIS installer and checksums as a stable GitHub release with a matching `v<version>` tag. Publish all assets in a draft first, then make it latest. Never upload app-data folders, credential exports, logs or personal Lua files. The public release repository stores the installer; full corresponding app source is included as `SteamHub-source.zip` with every release.

SteamHub builds are unsigned. Checksums establish download integrity relative to the GitHub publisher; they are not an independent malware audit. OpenSteamTool's GPL license and corresponding source are included with the application. New Steam releases may require different metadata or runtime code.
