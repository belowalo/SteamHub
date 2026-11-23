"""Refresh the reviewed production archive without reading any user profile or keys."""
from pathlib import Path
import zipfile, hashlib, os, json
ROOT = Path(__file__).resolve().parent.parent
release = ROOT / "release"
source = release / "steamhubproduction.zip"
target = release / "steamhubproduction-updated.zip"
with zipfile.ZipFile(source) as old:
    files = {name: old.read(name) for name in old.namelist() if not name.endswith("/")}
files["SteamHub.exe"] = (release / "SteamHub.exe").read_bytes()
version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
files = {n: data for n, data in files.items() if not n.startswith("installers/SteamHub_")}
files[f"installers/SteamHub_{version}_x64-setup.exe"] = (release / f"SteamHub_{version}_x64-setup.exe").read_bytes()
with zipfile.ZipFile(ROOT / "src-tauri/runtime-bundle.zip") as runtime:
    for name in runtime.namelist():
        files["fixed-steamtools/Steam-root/" + name] = runtime.read(name)
files["Install-SteamHub.ps1"] = (ROOT / "installer/Install-SteamHub.ps1").read_bytes()
files["THIRD_PARTY_NOTICES.md"] = (ROOT / "THIRD_PARTY_NOTICES.md").read_bytes()
for file in (ROOT / "third-party-licenses/OpenSteamTool-v1.4.8-fix").rglob("*"):
    if file.is_file(): files[file.relative_to(ROOT).as_posix()] = file.read_bytes()
files["README.txt"] = (ROOT / "README.md").read_bytes()
files.pop("SHA256SUMS.txt",None)
assert not any(Path(name).suffix.lower() in (".lua", ".sqlite3", ".log") for name in files)
assert not any("stbase.dll" in name or "SteamTools-Setup" in name for name in files)
files["SHA256SUMS.txt"] = ("\n".join(f"{hashlib.sha256(data).hexdigest()}  {name}" for name,data in sorted(files.items()))+"\n").encode()
with zipfile.ZipFile(target,"w",zipfile.ZIP_DEFLATED,strict_timestamps=False) as out:
    for name,data in sorted(files.items()): out.writestr(name,data)
with zipfile.ZipFile(target) as verify:
    assert verify.testzip() is None
    for name,data in files.items(): assert hashlib.sha256(verify.read(name)).digest()==hashlib.sha256(data).digest()
os.replace(target,source)
sums = release / "SHA256SUMS.txt"
lines = [line for line in sums.read_text().splitlines() if not line.endswith("  steamhubproduction.zip")] if sums.exists() else []
lines.append(hashlib.sha256(source.read_bytes()).hexdigest()+"  steamhubproduction.zip")
sums.write_text("\n".join(lines)+"\n",encoding="utf-8")
print(f"Verified {len(files)} files, {source.stat().st_size} bytes: {source}")
