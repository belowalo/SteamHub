import { useEffect, useState } from "react";
import {
  gameDataSources,
  setGameDataCredential,
  openReference,
  type GameDataSource,
} from "@/api/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/workspace/Primitives";

const providers: Record<
  string,
  { url: string; note: string; key?: boolean; manual?: boolean }
> = {
  hubcap: {
    url: "https://hubcapmanifest.com/",
    note: "Downloads game-data ZIPs using your Hubcap API key.",
    key: true,
  },
  ryuu: {
    url: "https://generator.ryuu.lol/api",
    note: "Downloads game-data ZIPs using your Ryuu auth key.",
    key: true,
  },
  manifestdex: {
    url: "https://manifestdex.com/developer/cli",
    note: "Fetches depot keys. Developer API access currently requires ManifestDeX Pro.",
    key: true,
  },
  catmisteam: {
    url: "https://catmisteam.com/",
    note: "Public Lua feed. Access restrictions or missing entries trigger fallback.",
  },
  openlua: {
    url: "https://openlua.cloud/",
    note: "Download on the website, complete its verification, then import the Lua file.",
    manual: true,
  },
  luatools: {
    url: "https://lua.tools/",
    note: "Sign in on the website, download a Lua/ZIP file, then import it.",
    manual: true,
  },
  manifesthub: {
    url: "https://manifesthub2.filegear-sg.me/",
    note: "Fetches missing manifest files after another source supplies keys and manifest IDs.",
    key: true,
  },
};

export function GameDataSources() {
  const [sources, setSources] = useState<GameDataSource[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [keys, setKeys] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    void gameDataSources()
      .then(
        (value) => {
          if (active) setSources(value);
        },
        (e) => {
          if (active) {
            setMessage(String(e));
            setFailed(true);
          }
        },
      )
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const change = (index: number, value: Partial<GameDataSource>) => {
    setSources((previous) =>
      previous.map((source, i) =>
        i === index ? { ...source, ...value } : source,
      ),
    );
    setMessage("");
  };
  const move = (index: number, step: number) =>
    setSources((previous) => {
      const next = [...previous];
      [next[index], next[index + step]] = [next[index + step], next[index]];
      return next;
    });
  const save = async () => {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      setSources(await gameDataSources(sources));
      setMessage("Game-data sources saved.");
    } catch (e) {
      setMessage(String(e));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const saveKey = async (kind: string, remove = false) => {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      await setGameDataCredential(kind, remove ? null : keys[kind] || "");
      setKeys((previous) => ({ ...previous, [kind]: "" }));
      const current = await gameDataSources();
      setSources((previous) =>
        previous.map((source) => ({
          ...source,
          hasCredential:
            current.find((s) => s.kind === source.kind)?.hasCredential || false,
        })),
      );
      setMessage(
        remove
          ? "API key removed."
          : "API key saved in Windows Credential Manager.",
      );
    } catch (e) {
      setMessage(String(e));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const website = (url: string) => {
    void openReference(url).catch((e) => {
      setMessage(String(e));
      setFailed(true);
    });
  };
  return (
    <Panel title="Game data">
      <p className="body-copy">
        Add to Steam tries enabled sources in order. Sources without a saved API
        key are skipped.
      </p>
      {sources.map((source, index) => (
        <fieldset
          className="game-data-source"
          key={source.kind === "custom" ? `custom-${index}` : source.kind}
          disabled={busy}
        >
          <legend className="sr-only">Game data source {index + 1}</legend>
          {source.kind !== "custom" && providers[source.kind] ? (
            <>
              <div className="inline-controls">
                <strong>{source.name}</strong>
                <span className="body-copy">
                  {providers[source.kind].manual
                    ? "Website / import"
                    : providers[source.kind].key
                      ? source.hasCredential
                        ? "Key saved"
                        : "API key needed"
                      : "Public feed"}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => website(providers[source.kind].url)}
                >
                  Open website
                </Button>
              </div>
              <p className="body-copy">{providers[source.kind].note}</p>
              {providers[source.kind].key && (
                <div className="inline-controls provider-key-controls">
                  <label className="provider-key-field">
                    {source.name} API key
                    <Input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={2048}
                      value={keys[source.kind] || ""}
                      placeholder={
                        source.hasCredential
                          ? "Enter a replacement key"
                          : "Enter your API key"
                      }
                      onChange={(e) =>
                        setKeys((previous) => ({
                          ...previous,
                          [source.kind]: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <Button
                    variant="outline"
                    disabled={!keys[source.kind]?.trim()}
                    onClick={() => {
                      void saveKey(source.kind);
                    }}
                  >
                    Save key
                  </Button>
                  {source.hasCredential && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        void saveKey(source.kind, true);
                      }}
                    >
                      Remove key
                    </Button>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="native-form-grid">
                <label>
                  Name
                  <Input
                    value={source.name}
                    maxLength={80}
                    onChange={(e) => change(index, { name: e.target.value })}
                  />
                </label>
                <label>
                  Format
                  <select
                    value={source.format}
                    onChange={(e) =>
                      change(index, { format: e.target.value as "zip" | "lua" })
                    }
                  >
                    <option value="zip">ZIP archive</option>
                    <option value="lua">Lua data</option>
                  </select>
                </label>
              </div>
              <label>
                URL template
                <Input
                  value={source.urlTemplate}
                  placeholder="https://your-source.example/{appid}.lua"
                  maxLength={2048}
                  onChange={(e) =>
                    change(index, { urlTemplate: e.target.value })
                  }
                />
              </label>
            </>
          )}
          <div className="inline-controls">
            {!providers[source.kind]?.manual && (
              <label className="native-check">
                <input
                  type="checkbox"
                  checked={source.enabled}
                  onChange={(e) => change(index, { enabled: e.target.checked })}
                />{" "}
                Enabled
              </label>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={index === 0}
              aria-label={`Move source ${index + 1} up`}
              onClick={() => move(index, -1)}
            >
              ↑
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={index === sources.length - 1}
              aria-label={`Move source ${index + 1} down`}
              onClick={() => move(index, 1)}
            >
              ↓
            </Button>
            {source.kind === "custom" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setSources((previous) =>
                    previous.filter((_, i) => i !== index),
                  )
                }
              >
                Remove
              </Button>
            )}
          </div>
        </fieldset>
      ))}
      <div className="inline-controls">
        <Button
          variant="outline"
          disabled={busy || sources.length >= 16}
          onClick={() =>
            setSources((previous) => [
              ...previous,
              {
                name: "New source",
                urlTemplate: "",
                format: "lua",
                enabled: true,
                kind: "custom",
                hasCredential: false,
              },
            ])
          }
        >
          Add source
        </Button>
        <Button
          disabled={busy || !sources.length}
          onClick={() => {
            void save();
          }}
        >
          Save sources
        </Button>
      </div>
      {message && <p role={failed ? "alert" : "status"}>{message}</p>}
    </Panel>
  );
}
