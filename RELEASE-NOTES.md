SteamHub 0.1.3 bundles the new add-game progress, savings estimate and reversible Lua removal features.

- Add-game progress shows price checking, live provider attempts, skipped credentials, failures, file installation and Steam restart guidance. Failed adds offer retry, source configuration and file import. Installed-file details and warnings are available after success.
- Money saved appears below Add a game. It estimates the current discounted Steam value of detected Lua-added apps in the selected store country. Each AppID is counted once, currencies stay separate, and unavailable prices are excluded with pricing coverage shown. This is not a historical purchase-price or lifetime-savings record.
- Remove Lua entry is available for Lua-added games in grid and table views. It previews matching files, requires confirmation and Steam to be closed, preserves inactive backups, and provides persistent undo history. Shared/custom scripts that cannot be safely classified are blocked. Edited backups and occupied restore paths stop undo.
- Game installations, manifests and runtime files are retained during Lua removal. Restart Steam to apply removal or restoration; games you own remain available.

Includes the prior UI layout update, reviewed runtime and November Steam compatibility repair. Run the same PowerShell updater command to get this release. Local profiles, keys and existing Lua files are not included in the release.

Validation covers frontend tests and Rust tests, including temporary removal/undo fixtures, edit conflicts, shared scripts and damaged history records. Live read-only checks verified pricing coverage and failed-provider recovery. No real game was removed for testing. Full search/add/restart/remove/undo behavior in Steam has not been tested end to end.

Windows 10/11 x64 is required. Builds are unsigned. The updater installs runtime files only for reviewed Steam DLL hashes. Removal backups require a filesystem supporting same-directory hard links. Corresponding application/runtime source, licenses, dependencies and checksums are included.
