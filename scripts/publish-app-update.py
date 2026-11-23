"""Create Tauri's signed app-update manifest from a completed Windows build."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", default="belowalo/SteamHub")
    parser.add_argument("--output", type=Path, default=ROOT / "release/latest.json")
    args = parser.parse_args()
    version = json.loads((ROOT / "package.json").read_text())["version"]
    installer = f"SteamHub_{version}_x64-setup.exe"
    artifact = ROOT / "src-tauri/target/release/bundle/nsis" / installer
    signature = artifact.with_suffix(".exe.sig").read_text().strip()
    if not artifact.is_file() or not signature:
        raise ValueError("A signed updater installer must be built first")
    manifest = {"version": version, "notes": (ROOT / "installer/RELEASE-NOTES.md").read_text(), "platforms": {"windows-x86_64": {"signature": signature, "url": f"https://github.com/{args.repository}/releases/download/v{version}/{installer}"}}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Prepared signed app update manifest for {version}")

if __name__ == "__main__":
    main()
