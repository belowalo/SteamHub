SteamHub 0.1.1 includes the current application changes and the November 11 Steam compatibility repair for build 1794424036.

- New PowerShell installer/updater: downloads the latest stable release without GitHub sign-in, checks GitHub's SHA-256 digest and all payload files, installs missing Microsoft prerequisites, and creates a desktop shortcut.
- Installs the reviewed bundled OpenSteamTool runtime only for Steam DLL hashes with reviewed compatibility data. Existing runtime conflicts stop installation; unknown Steam builds receive the app update with a warning.
- Preserves each PC's profile, provider keys, Lua files and runtime configuration. File updates have verified backups and guarded rollback.
- Includes the current UI, library artwork and filters, provider fallback, per-game status, guided fix ZIP handling, and region-aware Steam prices. Store region defaults to USA and is configured in Settings.

Windows 10/11 x64 is required. Steam must already be installed for runtime setup. No account keys, local profiles or personal Lua files are included. Microsoft installers may request administrator approval. SteamHub builds are unsigned. Existing SteamHub installations are retained; the new desktop shortcut points to the updater-managed copy.

Validation: 93 frontend tests and 66 Rust tests passed. The updater's Windows PowerShell 5.1 fixture tests cover fresh install, repeat update, preservation, rollback, changed-file protection, runtime conflicts, unsupported Steam hashes, tampered payloads and archive traversal. The current compatibility metadata was validated against the installed DLLs; Steam reopened its library without the three warning dialogs. Downloads, gameplay and a separate physical PC were not tested.

Use **Install-SteamHub.ps1** for online setup, **SteamHub-update.zip** for the updater payload, or **steamhubproduction.zip** for the full manual package. **SteamHub-source.zip** includes corresponding application source and dependency notices. SHA-256 checksums are in **SHA256SUMS.txt**.

The updater runs when invoked. It does not run in the background or generate compatibility data for unknown Steam builds. Future updates require publishing a new reviewed release.
