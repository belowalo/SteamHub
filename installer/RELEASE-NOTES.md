SteamHub 0.1.5 adds independent automatic app and Steam compatibility updates.

On launch, SteamHub checks for a newer signed app installer and downloads it in the background. Restart and update installs it immediately; closing the app also installs a pending update when workspace operations are idle. The old executable is backed up. Updates use the running app directory, including PowerShell-managed installations.

Steam metadata comes from a separate signed feed. Packages must match the installed Steam DLL hashes and reviewed runtime. Every executable hook signature and IPC pointer/constant is checked against the local DLLs before installation. Matching metadata is staged while Steam runs, then applied after Steam closes. Originals and a recovery journal protect interrupted updates. Unknown builds wait for compatible upstream data.

Includes the Online Fixes nested-folder repair and OneDrive Desktop installer correction. Slay the Spire 2 launch and multiplayer lobby hosting were verified. A second player's connection remains untested. OnlineFix.ini can change during game launch and trigger the strict fix-file verifier. How to Fish's original game failed to launch with Steam error 54, so its multiplayer remains unverified.

Includes a small app-version label in Settings. This is the bootstrap release for automatic updates: existing users must update once with the PowerShell installer or this release. The signed compatibility feed is checked on launch; upstream matching metadata must exist before a Steam update can be repaired. Runtime DLL replacements and incompatible upstream schema changes still require review.
