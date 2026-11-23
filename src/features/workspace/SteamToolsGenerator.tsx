import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  configureManifestProvider,
  generateSteamTools,
  selectLibraryFolder,
  lookupGameData,
  addGameData,
  openReference,
  type GameDataLookup,
} from "@/api/workspace";
import { useWorkspace } from "@/app/workspace-context";

export function SteamToolsGenerator() {
  const { refresh, busy } = useWorkspace();
  const [app, setApp] = useState("");
  const [lookup, setLookup] = useState<GameDataLookup | null>(null);
  const [root, setRoot] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [added, setAdded] = useState(false);
  const find = async () => {
    setWorking(true);
    setLookup(null);
    setMessage("");
    setFailed(false);
    setAdded(false);
    try {
      const result = await lookupGameData(app.trim());
      setLookup(result);
      setRoot(result.steamRoot ?? "");
    } catch (e) {
      setMessage(String(e));
      setFailed(true);
    } finally {
      setWorking(false);
    }
  };
  const add = async () => {
    if (!lookup) return;
    setWorking(true);
    setMessage("");
    setFailed(false);
    try {
      const result = await addGameData(lookup.id, root);
      setAdded(true);
      setMessage(
        `Game data added to ${result.installedPath}. Refresh Steam’s library or restart Steam to load it. This does not confirm download or launch success.`,
      );
      await refresh();
    } catch (e) {
      setMessage(String(e));
      setFailed(true);
    } finally {
      setWorking(false);
    }
  };
  return (
    <>
      <section className="configuration-panel" aria-label="Add a game to Steam">
        <div className="form-stack">
          <h2>Add a game to Steam</h2>
          <label>
            AppID
            <Input
              value={app}
              inputMode="numeric"
              placeholder="813780"
              disabled={working}
              onChange={(e) => {
                setApp(e.target.value);
                setLookup(null);
                setMessage("");
                setAdded(false);
              }}
            />
          </label>
          <Button
            disabled={working || busy || !/^\d+$/.test(app.trim())}
            onClick={() => {
              void find();
            }}
          >
            {working && !lookup ? "Finding game data…" : "Find game"}
          </Button>
          {lookup && (
            <>
              <p role="status">
                Game data found for AppID {lookup.app}:{" "}
                {lookup.generated.manifests.length} manifests ready.
              </p>
              <Button
                variant="link"
                onClick={() => {
                  void openReference(lookup.source).catch((e) => {
                    setMessage(String(e));
                    setFailed(true);
                  });
                }}
              >
                View data source
              </Button>
              <label>
                Steam folder
                <Input
                  value={root}
                  disabled={working}
                  onChange={(e) => {
                    setRoot(e.target.value);
                    setAdded(false);
                  }}
                />
              </label>
              <Button
                variant="outline"
                disabled={working}
                onClick={() => {
                  void selectLibraryFolder()
                    .then((p) => {
                      if (p) {
                        setRoot(p);
                        setAdded(false);
                      }
                    })
                    .catch((e) => {
                      setMessage(String(e));
                      setFailed(true);
                    });
                }}
              >
                Choose Steam folder
              </Button>{" "}
              <Button
                disabled={working || busy || !root || added}
                onClick={() => {
                  void add();
                }}
              >
                {added ? "Added" : working ? "Adding…" : "Add to Steam"}
              </Button>
              <details className="configuration-details">
                <summary>View generated Lua and data details</summary>
                <Textarea
                  aria-label="Online generated Lua"
                  value={lookup.generated.text}
                  readOnly
                  className="native-code-editor"
                />
                {lookup.generated.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </details>
            </>
          )}
          {message && <p role={failed ? "alert" : "status"}>{message}</p>}
        </div>
      </section>
      <details className="configuration-details">
        <summary>Advanced</summary>
        <AdvancedGenerator />
      </details>
    </>
  );
}

function AdvancedGenerator() {
  const { perform, busy } = useWorkspace();
  const [app, setApp] = useState("");
  const [depots, setDepots] = useState("");
  const [dlcs, setDlcs] = useState("");
  const [root, setRoot] = useState("");
  const [preview, setPreview] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [provider, setProvider] = useState("https://manifest.manifestdex.com/");
  const [providerPreview, setProviderPreview] = useState("");
  const [details, setDetails] = useState<string[]>([]);
  const invalidate = () => {
    setPreview("");
    setMessage("");
    setDetails([]);
  };
  const generate = async (install: boolean) => {
    setWorking(true);
    setMessage("");
    try {
      if (install) {
        await perform(async () => {
          const result = await generateSteamTools(
            app,
            depots,
            dlcs,
            root,
            true,
          );
          setMessage(
            `Installed ${result.installedPath}. The SteamTools runtime loads this file; Steam controls download completion. Refresh the library or restart Steam if needed.`,
          );
          return true;
        }, "Generated configuration saved to the vault and installed in Steam.");
      } else {
        const result = await generateSteamTools(
          app,
          depots,
          dlcs,
          root || null,
        );
        setPreview(result.text);
        setDetails([
          `${result.manifests.length} matching cached manifests will be saved to the vault with the Lua.`,
          ...result.warnings,
        ]);
      }
    } catch (e) {
      setMessage(String(e));
    } finally {
      setWorking(false);
    }
  };
  const configureProvider = async (install: boolean) => {
    setWorking(true);
    setMessage("");
    try {
      if (install) {
        await perform(async () => {
          const result = await configureManifestProvider(provider, root);
          setMessage(`Request-code adapter installed: ${result.installedPath}`);
        }, "Request-code adapter saved and installed.");
      } else {
        setProviderPreview((await configureManifestProvider(provider)).text);
      }
    } catch (e) {
      setMessage(String(e));
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="configuration-panel" aria-label="SteamTools generator">
      <div className="form-stack">
        <h2>Generate from local or supplied data</h2>
        <p>
          Leave depot data blank to use keys and manifests from a scanned local
          installation, or supply depot data below. Requires an installed
          OpenSteamTool or SteamTools runtime. Store listings cannot supply
          depot keys.
        </p>
        <div className="native-form-grid">
          <label>
            Game AppID
            <Input
              value={app}
              inputMode="numeric"
              disabled={working}
              onChange={(e) => {
                setApp(e.target.value);
                invalidate();
              }}
            />
          </label>
          <label>
            DLC AppIDs (optional)
            <Input
              value={dlcs}
              disabled={working}
              onChange={(e) => {
                setDlcs(e.target.value);
                invalidate();
              }}
            />
          </label>
          <label>
            Steam installation folder
            <Input
              value={root}
              disabled={working}
              onChange={(e) => {
                setRoot(e.target.value);
                invalidate();
              }}
            />
          </label>
          <Button
            variant="outline"
            disabled={working}
            onClick={() => {
              void selectLibraryFolder()
                .then((p) => {
                  if (p) {
                    setRoot(p);
                    invalidate();
                  }
                })
                .catch((e) => setMessage(String(e)));
            }}
          >
            Browse Steam folder
          </Button>
        </div>
        <label>
          Depots: one row per depot — ID, 64-digit key, optional manifest GID
          <Textarea
            aria-label="Depot data"
            value={depots}
            spellCheck={false}
            disabled={working}
            onChange={(e) => {
              setDepots(e.target.value);
              invalidate();
            }}
            placeholder="621, <64 hexadecimal digits>, <optional manifest GID>"
          />
        </label>
        <Button
          disabled={busy || working || !app || (!depots && !root)}
          onClick={() => {
            void generate(false);
          }}
        >
          Preview generated Lua
        </Button>{" "}
        <Button
          disabled={busy || working || !root || !preview}
          onClick={() => {
            void generate(true);
          }}
        >
          Save and add to Steam
        </Button>
        {preview && (
          <Textarea
            aria-label="Generated Lua preview"
            value={preview}
            readOnly
            className="native-code-editor"
          />
        )}
        {details.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <h3>Manifest request-code provider</h3>
        <p>
          Optional: keep the runtime’s current provider, or generate our adapter
          for a compatible HTTPS service returning a decimal request code.
          Existing manifest.lua files are preserved; a conflicting file must be
          backed up and removed before installing this adapter.
        </p>
        <label>
          Provider base URL
          <Input
            value={provider}
            disabled={working}
            onChange={(e) => {
              setProvider(e.target.value);
              setProviderPreview("");
            }}
          />
        </label>
        <Button
          variant="outline"
          disabled={working || busy}
          onClick={() => {
            void configureProvider(false);
          }}
        >
          Preview request-code adapter
        </Button>{" "}
        <Button
          disabled={working || busy || !root || !providerPreview}
          onClick={() => {
            void configureProvider(true);
          }}
        >
          Install request-code adapter
        </Button>
        {providerPreview && (
          <Textarea
            aria-label="Request-code adapter preview"
            value={providerPreview}
            readOnly
            className="native-code-editor"
          />
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </section>
  );
}
