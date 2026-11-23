# Automatic updates

SteamHub checks on launch and downloads a newer signed Windows installer in the background. It installs on app exit or when the user selects Restart and update. An active workspace operation defers installation. The current executable is backed up in the profile's updates directory. The installer targets the running executable's directory, including PowerShell-managed version directories.

Compatibility updates use a separate signed JSON feed under compatibility/updates in belowalo/SteamHub. They are limited to the reviewed OpenSteamTool runtime and the exact Steam DLL hashes. Before installing, SteamHub checks all 34 executable signatures for a unique match and validates the six IPC method pointers, argument counts, and wrapper constants. It applies only the three metadata files after Steam closes. A durable journal preserves the originals and recovers interrupted writes. A signed cached package can be used offline. Unknown builds wait for matching upstream data.

## Release setup

The public key is pinned in src-tauri/update-public-key.txt and tauri.conf.json. The private key was generated outside the project in the current user's LocalAppData/SteamHub-signing/updater.key. Keep a secure backup of that key. Never put it in source archives or app resources.

For local signed builds, set TAURI_SIGNING_PRIVATE_KEY to the contents of that private key file and TAURI_SIGNING_PRIVATE_KEY_PASSWORD to an empty string, then run npm run desktop:package. Run python scripts/publish-app-update.py afterward. Upload latest.json and its referenced installer to the same versioned GitHub release, alongside the existing PowerShell update assets. Make the release latest only after verifying every uploaded file. Future app releases must increment the application version.

The GitHub workflows are prepared locally. When publishing them, the repository must contain their source inputs (package.json, package-lock.json, scripts, src-tauri, and installer/compatibility/expected-hooks.json). The existing public installer repository currently distributes full source as a release ZIP, so publishing workflow YAML alone is insufficient. Publish the corresponding source tree with the workflows or use a source repository with these build inputs.

Add the private key contents as the TAURI_SIGNING_PRIVATE_KEY GitHub Actions secret in that source repository. The compatibility workflow runs every six hours and on manual dispatch. It pins upstream reads to one commit, requires the known hook and IPC schemas, normalizes the two known aliases, signs new stable-build metadata, and commits it to compatibility/updates. SteamHub independently performs DLL-level validation on each PC. Schema changes fail the workflow for review.

The app-update workflow builds signed artifacts for release review. The normal packaging scripts continue to provide source, dependency notices, the PowerShell update archive, and the production package. No provider keys, account profiles, game files, or downloaded online-fix packages belong in either feed.

Existing installations need one release containing this updater before they can update themselves. The GitHub feeds and workflows are not activated merely by creating local files. New runtime DLL versions still require an app release and review.
