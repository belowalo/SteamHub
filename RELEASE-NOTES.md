SteamHub 0.1.5 repairs Online Fixes installation for games with nested executable folders.

- Matches the fix package's binary paths against installed game folders and shows the detected destination during review.
- Backs up the original DLL in the correct folder. Ambiguous destinations and locations changed after review are rejected.
- Detects legacy wrong-folder installations while retaining Undo recovery.
- Includes the PowerShell installer fix for linked/OneDrive Desktops. An unsupported desktop shortcut is skipped so installation can continue.

Validation: six Rust fix-install tests and five Online Fixes UI tests passed, along with TypeScript, production frontend build, and targeted ESLint. The real Slay the Spire 2 fix was installed through SteamHub on build 26655341 / game version 0.111.1. The game loaded all four fix DLLs and successfully created a standard multiplayer lobby. Joining from a second PC was not tested. All unrelated original game-file hashes matched the baseline.

How to Fish installation, module loading, and Undo were tested. Its original game also failed to launch with Steam error 54, so multiplayer for that game remains unverified. Some fix packages rewrite OnlineFix.ini at launch; the strict file verifier can consequently report changed files and Undo may need manual review of that configuration.

Includes the reviewed runtime compatibility data from 0.1.4. Provider keys, profiles, game files, and downloaded third-party fix packages are excluded. Windows builds are unsigned. Rerun the existing PowerShell command to install this release.
