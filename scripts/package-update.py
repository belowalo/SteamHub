"""Build the updater payload from allowlisted release files; never read user profiles."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parent.parent
release = ROOT / "release"
version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
files = {}
for name in ["SteamHub.exe", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]:
    files["app/" + name] = (release / name).read_bytes()
for p in (ROOT / "third-party-licenses").rglob("*"):
    if p.is_file():
        files["app/" + p.relative_to(ROOT).as_posix()] = p.read_bytes()
with zipfile.ZipFile(ROOT / "src-tauri/runtime-bundle.zip") as runtime:
    for name in runtime.namelist():
        files["runtime/" + name] = runtime.read(name)
sources = json.loads((release / "production-dependencies/DOWNLOADS.json").read_text(encoding="utf-8"))
for name in ["MicrosoftEdgeWebView2RuntimeInstallerX64.exe", "vc_redist.x64.exe"]:
    p = release / "production-dependencies" / name
    source = next(s for s in sources if s["name"] == name)
    data = p.read_bytes()
    assert hashlib.sha256(data).hexdigest() == source["sha256"], name
    files["dependencies/" + name] = data
assert not any(Path(n).suffix.lower() in {".lua", ".sqlite", ".sqlite3", ".db", ".log", ".key", ".pem"} for n in files)
manifest = {
    "schemaVersion": 1, "product": "SteamHub", "version": "v" + version, "architecture": "x64",
    "compatibility": json.loads((ROOT / "installer/compatibility/supported.json").read_text(encoding="utf-8")),
    "files": [{"path": n, "bytes": len(b), "sha256": hashlib.sha256(b).hexdigest()} for n, b in sorted(files.items())],
}
files["update-manifest.json"] = json.dumps(manifest, indent=2).encode()
output = release / "SteamHub-update.zip"
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in sorted(files.items()):
        z.writestr(name, data)
with zipfile.ZipFile(output) as z:
    assert z.testzip() is None
    assert len(z.namelist()) == len(files)
    for f in manifest["files"]:
        assert hashlib.sha256(z.read(f["path"])).hexdigest() == f["sha256"]
(release / "Install-SteamHub.ps1").write_bytes((ROOT / "installer/Install-SteamHub.ps1").read_bytes())
assets = ["Install-SteamHub.ps1", "SteamHub-update.zip", "steamhubproduction.zip", "SteamHub-source.zip", "SteamHub-portable.zip", f"SteamHub_{version}_x64-setup.exe"]
for name in ["latest.json", f"SteamHub_{version}_x64-setup.exe.sig"]:
    if (release / name).is_file():
        assets.append(name)
(release / "SHA256SUMS.txt").write_text("".join(f"{hashlib.sha256((release / n).read_bytes()).hexdigest()}  {n}\n" for n in assets), encoding="utf-8")
print(f"Verified {len(files)} files, {output.stat().st_size} bytes: {output}")
