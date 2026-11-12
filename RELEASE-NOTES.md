SteamHub 0.1.2 replaces the uneven utility-page card grids with a consistent section layout.

- Settings and Tools use full-width rows, with section labels aligned on the left and controls on the right. Narrow windows stack labels above controls.
- Consistent spacing, dividers and content widths replace disconnected cards and unused grid gaps.
- Storage and log paths are left-aligned with safe wrapping. Library paths use a compact list, and last-scan dates use a readable local format.
- Application health uses the same section layout with a compact status and service summary. Shortcut actions follow the same content alignment.
- Catalog maintenance follows the same section layout. Game artwork grids remain available for browsing the library.

Includes the November 11 Steam compatibility repair and the existing PowerShell installer/updater. Run the same installer command again to obtain this release. Local profiles, provider keys and Lua files remain on each PC.

Validation: all 93 frontend tests, TypeScript production build, lint and formatting passed. Windows NSIS packaging completed. Settings and Tools were visually checked in the desktop app, and the 960px browser preview showed equal section widths without horizontal overflow. Gameplay and downloads were not tested. No runtime behavior changed in this UI update.

Windows 10/11 x64 is required. Builds are unsigned. Runtime setup requires an installed, supported Steam build. Unknown Steam builds receive the app update with a compatibility warning. Dependencies and the reviewed runtime are included in the update and production packages; corresponding source and licenses are included with the release.
