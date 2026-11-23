"""Normalize allowlisted upstream metadata and sign the independent compatibility feed."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import tomllib
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
UPSTREAM = "huanyuejue/steam-monitor"

def github(path):
    request = urllib.request.Request("https://api.github.com/" + path, headers={"User-Agent": "SteamHub-compatibility", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)

def contents(path, commit):
    record = github(f"repos/{UPSTREAM}/contents/{path}?ref={commit}")
    return base64.b64decode(record["content"]).decode("utf-8")

def normalize(text, expected):
    data = tomllib.loads(text)
    found = {}
    for entry in data.values():
        name = {"KeyValues_FindOrCreateKey": "FindOrCreateKey", "KeyValues_ReadAsBinary": "ReadAsBinary"}.get(entry["name"], entry["name"])
        if name == "GetTopManager":
            continue
        if name not in expected.values() or name in found:
            raise ValueError("Unexpected or duplicated upstream hook")
        if not re.fullmatch(r"0x[0-9a-fA-F]+", entry["rva"]):
            raise ValueError("Invalid upstream hook address")
        if not re.fullmatch(r"(?:[0-9a-fA-F]{2}|\?{1,2})(?: (?:[0-9a-fA-F]{2}|\?{1,2})){15,511}", entry["sig"]):
            raise ValueError("Invalid upstream signature")
        found[name] = {"name": name, "rva": entry["rva"], "sig": entry["sig"]}
    if set(found) != set(expected.values()):
        raise ValueError("Upstream changed the required hook set")
    return "\n".join(f'[{key}]\nname = {json.dumps(name)}\nrva = {json.dumps(found[name]["rva"])}\nsig = {json.dumps(found[name]["sig"])}\n' for key, name in expected.items())

def sign(payload, key):
    with tempfile.TemporaryDirectory() as folder:
        file = Path(folder) / "compatibility.json"
        file.write_bytes(payload)
        command = ["npx", "tauri", "signer", "sign", "-f", str(key), "-p", "", str(file)]
        if os.name == "nt":
            command[0] = "npx.cmd"
        subprocess.run(command, cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
        return file.with_suffix(".json.sig").read_text().strip()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--key", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "compatibility/updates")
    args = parser.parse_args()
    expected = json.loads((ROOT / "installer/compatibility/expected-hooks.json").read_text())
    commit = github(f"repos/{UPSTREAM}/commits/main")["sha"]
    readme = contents("README.md", commit)
    pairs = []
    for line in readme.splitlines():
        if "| Stable |" in line:
            hashes = re.findall(r"(?:pattern/steamclient|pattern/steamui)/([a-f0-9]{64})\.toml", line)
            if len(hashes) == 2 and hashes not in pairs:
                pairs.append(hashes)
    if not pairs:
        raise ValueError("No stable upstream build pairs found")
    args.output.mkdir(parents=True, exist_ok=True)
    for client, ui in pairs:
        target = args.output / f"{client}-{ui}.json"
        if target.exists():
            continue
        ipc = contents(f"ipc/steamclient/{client}.toml", commit)
        parsed = tomllib.loads(ipc)
        interfaces = {"IClientUser": (1, {"GetSteamID": 0, "GetAppOwnershipTicketExtendedData": 2, "RequestEncryptedAppTicket": 2, "GetEncryptedAppTicket": 1}), "IClientUtils": (4, {"GetAppID": 0, "GetAPICallResult": 3})}
        if set(parsed) != set(interfaces):
            raise ValueError("Unexpected IPC interface set")
        for name, (iid, methods) in interfaces.items():
            interface = parsed[name]
            if interface["interface_id"] != iid or set(interface) != set(methods) | {"interface_id", "vtable_rva"}:
                raise ValueError("Changed IPC schema")
            for method, argc in methods.items():
                if set(interface[method]) != {"method_index", "funcHash", "wrapper_rva", "fencepost", "argc"}:
                    raise ValueError("Changed IPC method schema")
                if interface[method]["argc"] != argc:
                    raise ValueError("Changed IPC argument count")
        package = {"schema": 1, "runtimeSha256": expected["runtimeSha256"], "clientSha256": client, "uiSha256": ui, "clientPattern": normalize(contents(f"pattern/steamclient/{client}.toml", commit), expected["steamclient"]), "uiPattern": normalize(contents(f"pattern/steamui/{ui}.toml", commit), expected["steamui"]), "ipc": ipc}
        payload = json.dumps(package, sort_keys=True).encode()
        envelope = {"payload": base64.b64encode(payload).decode(), "signature": sign(payload, args.key)}
        target.write_text(json.dumps(envelope, indent=2) + "\n")
        print(f"Prepared {client[:12]} / {ui[:12]} from pinned upstream commit {commit}")
    # Each client independently validates executable signatures and IPC pointers
    # against its exact installed DLLs before any Steam files can be changed.

if __name__ == "__main__":
    main()
