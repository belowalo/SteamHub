"""Prepare inspectable license notices and reproducible release archives after building."""
from pathlib import Path
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
import time

ROOT = Path(__file__).resolve().parent.parent

def licenses():
    metadata = json.loads(subprocess.check_output([
        "cargo", "metadata", "--manifest-path", str(ROOT / "src-tauri/Cargo.toml"),
        "--locked", "--format-version", "1", "--filter-platform", "x86_64-pc-windows-msvc",
    ], cwd=ROOT, text=True, encoding="utf-8"))
    target = ROOT / "third-party-licenses"
    target.mkdir(exist_ok=True)
    inventory = []
    def collect(ecosystem, name, version, license_name, directory, explicit=None):
        identifier = re.sub(r"[^a-zA-Z0-9._-]", "_", f"{ecosystem}-{name}-{version}")
        destination = target / identifier
        candidates = set()
        for file in directory.iterdir():
            if file.is_file() and re.match(r"(?i)^(licen[cs]e|copying|copyright|notice)([._-]|$)", file.name):
                candidates.add(file)
            elif file.is_dir() and file.name.lower() in ("licenses", "licences"):
                candidates.update(p for p in file.rglob("*") if p.is_file())
        if explicit and (directory / explicit).is_file():
            candidates.add(directory / explicit)
        saved = []
        for source in sorted(candidates):
            if source.stat().st_size > 2 * 1024 * 1024:
                continue
            relative = source.relative_to(directory)
            output = destination / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, output)
            saved.append(output.relative_to(ROOT).as_posix())
        inventory.append({"ecosystem": ecosystem, "name": name, "version": version,
                          "license": license_name, "notices": saved})
    for package in metadata["packages"]:
        if package["name"] == "steamhub":
            continue
        directory = Path(package["manifest_path"]).parent
        collect("cargo", package["name"], package["version"], package.get("license"), directory, package.get("license_file"))
        if "MPL-2.0" in (package.get("license") or ""):
            source_archive=directory.parents[2]/"cache"/directory.parent.name/f'{package["name"]}-{package["version"]}.crate'
            if source_archive.is_file():
                archive_target=target/"source-archives"/source_archive.name
                archive_target.parent.mkdir(exist_ok=True)
                shutil.copy2(source_archive,archive_target)
    lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
    for path, package in lock["packages"].items():
        if not path or not (ROOT / path).is_dir():
            continue
        manifest = ROOT / path / "package.json"
        if not manifest.exists():
            continue
        data = json.loads(manifest.read_text(encoding="utf-8"))
        collect("npm", data.get("name", path), data.get("version", "unknown"), data.get("license", package.get("license")), ROOT / path)
    (target / "inventory.json").write_text(json.dumps(inventory, indent=2), encoding="utf-8")
    lines = ["# Third-party notices", "", "SteamHub original application code follows the LICENSE file. Dependency licenses remain with their authors.",
             "This inventory includes resolved Windows Rust packages and installed JavaScript packages, including build/test tooling. It is intentionally broader than the shipped runtime.",
             "License and notice texts are in `third-party-licenses/`. Dependency source is available from the exact package versions in Cargo.lock and package-lock.json through crates.io and npm.",
             "OpenSteamTool v1.4.8-fix by moxuna is bundled separately under GPL-3.0. Its license and corresponding source archive are in third-party-licenses/OpenSteamTool-v1.4.8-fix/. Other ecosystem tools are not bundled.", "",
             "| Ecosystem | Package | Version | License expression |", "|---|---|---|---|"]
    for item in inventory:
        lines.append(f'| {item["ecosystem"]} | {item["name"]} | {item["version"]} | {item["license"] or "See package notices"} |')
    (ROOT / "THIRD_PARTY_NOTICES.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Collected notices for {len(inventory)} dependency packages")

def package():
    output = ROOT / "release"
    output.mkdir(exist_ok=True)
    try:
        shutil.copy2(ROOT / "src-tauri/target/release/steamhub.exe", output / "SteamHub.exe")
    except PermissionError:
        # Preserve a running build without closing the user's window.
        previous = ROOT.parent / f"{ROOT.name}-archive" / "previous-releases"
        previous.mkdir(parents=True, exist_ok=True)
        (output / "SteamHub.exe").rename(previous / f"SteamHub-{time.time_ns()}.exe")
        shutil.copy2(ROOT / "src-tauri/target/release/steamhub.exe", output / "SteamHub.exe")
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    installer = f"SteamHub_{version}_x64-setup.exe"
    shutil.copy2(ROOT / "src-tauri/target/release/bundle/nsis" / installer, output / installer)
    signature = ROOT / "src-tauri/target/release/bundle/nsis" / (installer + ".sig")
    if signature.exists():
        shutil.copy2(signature, output / signature.name)
        subprocess.run(["python", str(ROOT / "scripts/publish-app-update.py")], cwd=ROOT, check=True)
    for name in ("README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"):
        shutil.copy2(ROOT / name, output / name)
    source = output / "SteamHub-source.zip"
    allowed = {"src", "src-tauri", "contracts", "db", "docs", "fixtures", "scripts", "installer", ".github", "third-party-licenses", "compatibility"}
    root_files = [p for p in ROOT.iterdir() if p.is_file() and (p.suffix in (".json", ".toml", ".md", ".html", ".js", ".ts") and not p.name.endswith(".tsbuildinfo") or p.name in ("LICENSE", ".gitignore", ".prettierrc.json", ".editorconfig", ".gitattributes"))]
    with zipfile.ZipFile(source, "w", zipfile.ZIP_DEFLATED, strict_timestamps=False) as archive:
        files = list(root_files)
        for folder in allowed:
            files.extend(p for p in (ROOT / folder).rglob("*") if p.is_file() and not p.is_symlink() and not {"target", "gen", "__pycache__"}.intersection(p.relative_to(ROOT / folder).parts))
        for file in sorted(set(files)):
            archive.write(file, Path("SteamHub") / file.relative_to(ROOT))
    portable = output / "SteamHub-portable.zip"
    with zipfile.ZipFile(portable, "w", zipfile.ZIP_DEFLATED, strict_timestamps=False) as archive:
        for file in (output / "SteamHub.exe", output / "README.md", output / "LICENSE", output / "THIRD_PARTY_NOTICES.md"):
            archive.write(file, file.name)
        for file in (ROOT / "third-party-licenses").rglob("*"):
            if file.is_file():
                archive.write(file, file.relative_to(ROOT))
    sums = []
    for file in sorted(output.iterdir()):
        if file.suffix in (".zip", ".exe"):
            sums.append(f"{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}")
    (output / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n", encoding="utf-8")
    print("\n".join(sums))

if __name__ == "__main__":
    import sys
    if "--licenses" in sys.argv:
        licenses()
    else:
        package()
