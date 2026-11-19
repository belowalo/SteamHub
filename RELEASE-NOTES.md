SteamHub 0.1.4 includes the November 14 SteamTools restoration and current Steam compatibility files.

- Adds reviewed compatibility data for Steam stable build 1794536281, selected by the exact steamclient64.dll and SteamUI.dll SHA-256 hashes.
- The PowerShell installer restores missing reviewed runtime DLLs and installs the matching compatibility files when Steam is closed. Existing matching DLLs are retained; different runtime DLLs are preserved and reported as conflicts.
- Keeps support for the previously reviewed Steam builds and preserves existing Lua files, provider keys, profiles and runtime configuration.
- Includes all 0.1.3 features: add-game progress/recovery, the current-price savings estimate, and reversible Lua removal.

The added metadata was validated against the installed DLLs: 34 unique hook signatures and six IPC vtable pointers/wrapper constants matched. On the repaired PC, the three missing runtime DLLs and three matching TOMLs were restored; Steam restarted with OpenSteamTool loaded and no compatibility warning dialogs. All 91 recorded Lua/config files remained unchanged. Game launches and downloads were not tested.

Metadata source is pinned to huanyuejue/steam-monitor commit c53bb228a0900122c7182548f50ec227b749f8f7. Two hook names were normalized for the reviewed moxuna v1.4.8-fix runtime, and the unused GetTopManager hook was omitted. Audit records are included in the source archive and repository compatibility folder.

Run the existing PowerShell installer command again to obtain this update. Windows 10/11 x64 and an installed Steam client are required for integration setup. Unsupported Steam hashes receive the app update with a compatibility warning. This release does not diagnose a separate bootstrap/network error on another PC; the exact error is still needed if that occurs. Builds are unsigned; corresponding runtime/application source, dependency notices and checksums are included.
