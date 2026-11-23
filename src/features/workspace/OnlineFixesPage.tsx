import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterSelect } from "@/components/workspace/Primitives";
import { useLocalLibrary } from "@/app/library-context";
import { useWorkspace } from "@/app/workspace-context";
import {
  discoverOnlineFixes,
  openReference,
  onlineFixOperation,
  onlineFixStatus,
  onlineFixGames,
  type FixDiscovery,
  type FixPlan,
} from "@/api/workspace";
import { GameArtwork } from "@/features/library/GameArtwork";
const readable = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/^[A-Z_]+:\s*/, "");
export function OnlineFixesPage() {
  const library = useLocalLibrary();
  const workspace = useWorkspace();
  const [online, setOnline] = useState<string[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [checkedKey, setCheckedKey] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [eligibilityError, setEligibilityError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<FixDiscovery | null>(null);
  const [releaseId, setReleaseId] = useState("");
  const [plan, setPlan] = useState<FixPlan | null>(null);
  const [installed, setInstalled] = useState({
    installed: false,
    canUndo: false,
  });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorNotice = error && (
    <p role="alert" className="notice-box">
      {error}
    </p>
  );
  const generation = useRef(0);
  const luaApps = new Set(workspace.snapshot?.luaApps ?? []);
  const candidates = (library.snapshot?.games ?? []).filter(
    (game) => game.installed && luaApps.has(game.appId),
  );
  const candidateKey = candidates
    .map((game) => game.appId)
    .sort()
    .join(",");
  const requestKey = `${candidateKey}:${refreshVersion}`;
  const checking = candidateKey.length > 0 && checkedKey !== requestKey;
  useEffect(() => {
    if (!candidateKey) return;
    let active = true;
    void onlineFixGames(refreshVersion > 0).then(
      (data) => {
        if (active) {
          setOnline(data.apps);
          setUnknown(data.unknown);
          setCheckedKey(requestKey);
          setEligibilityError("");
        }
      },
      (e) => {
        if (active) {
          setOnline([]);
          setUnknown([]);
          setCheckedKey(requestKey);
          setEligibilityError(readable(e));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [candidateKey, requestKey, refreshVersion]);
  const games = candidates.filter((game) => online.includes(game.appId));
  async function refreshGames() {
    setEligibilityError("");
    try {
      await library.scan();
      await workspace.refresh();
      setRefreshVersion((version) => version + 1);
    } catch (e) {
      setEligibilityError(readable(e));
    }
  }
  const game = games.find((item) => item.appId === selected);
  const visible = games.filter((item) =>
    `${item.name ?? ""} ${item.appId}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const release = result?.fixes.find((fix) => fix.id === releaseId);
  async function select(app: string) {
    const current = ++generation.current;
    setSelected(app);
    setPlan(null);
    setNotice("");
    setResult(null);
    setReleaseId("");
    setInstalled({ installed: false, canUndo: false });
    setError("");
    setBusy(true);
    const [discovery, status] = await Promise.allSettled([
      discoverOnlineFixes(app),
      onlineFixStatus(app),
    ]);
    if (generation.current !== current) return;
    if (discovery.status === "fulfilled") {
      setResult(discovery.value);
      setReleaseId(discovery.value.fixes.find((fix) => fix.hasFix)?.id ?? "");
    } else setError(readable(discovery.reason));
    if (status.status === "fulfilled") setInstalled(status.value);
    else
      setError((previous) =>
        [previous, readable(status.reason)].filter(Boolean).join(" "),
      );
    setBusy(false);
  }
  async function operate(action: "preview" | "apply" | "undo") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const reviewed = await onlineFixOperation(selected, action, plan?.id);
      if (action === "preview") {
        if (reviewed) setPlan(reviewed);
      } else {
        setPlan(null);
        const status = await onlineFixStatus(selected);
        setInstalled(status);
        if (action === "apply" && !status.installed)
          throw new Error(
            "The installed files could not be verified. Use Undo fix to restore the originals.",
          );
        if (action === "undo")
          setNotice("Fix removed. Original files restored.");
      }
    } catch (e) {
      setError(readable(e));
      if (action !== "preview") {
        try {
          setInstalled(await onlineFixStatus(selected));
        } catch {
          /* Preserve the original operation error. */
        }
      }
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    try {
      await openReference(
        result?.sourceUrl ?? `https://lua.tools/fixes/${selected}`,
      );
    } catch (e) {
      setError(readable(e));
    }
  }
  return (
    <div className="fixes-page">
      <header className="fixes-header">
        <h1 data-page-heading tabIndex={-1}>
          Online Fixes
        </h1>
        {!game && (
          <Button
            variant="outline"
            disabled={busy || library.scanning || checking}
            onClick={() => {
              void refreshGames();
            }}
          >
            Refresh games
          </Button>
        )}
      </header>
      {notice && (
        <p role="status" className="notice-box">
          {notice}
        </p>
      )}
      {eligibilityError && <p role="alert">{eligibilityError}</p>}
      {unknown.length > 0 && !checking && (
        <p className="field-help">
          Online support could not be confirmed for {unknown.length} Lua
          game(s). Refresh to retry.
        </p>
      )}
      {!game ? (
        <>
          <Input
            aria-label="Filter Lua games"
            placeholder="Search online Lua games"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {workspace.error && <p role="alert">{workspace.error}</p>}
          {library.error && <p role="alert">{library.error.message}</p>}
          {workspace.loading || library.loading || checking ? (
            <p role="status">Checking online multiplayer support...</p>
          ) : visible.length === 0 ? (
            <p className="field-help">
              {query
                ? "No matching online Lua games."
                : "No installed Lua games with confirmed online multiplayer/co-op. Refresh after installing a game."}
            </p>
          ) : (
            <div className="fixes-game-list">
              {visible.map((item) => (
                <Button
                  key={item.appId}
                  variant="outline"
                  className="fixes-game"
                  onClick={() => {
                    void select(item.appId);
                  }}
                >
                  <GameArtwork appId={item.appId} thumbnail />
                  <span>
                    <strong>{item.name || `AppID ${item.appId}`}</strong>
                    <small>AppID {item.appId}</small>
                  </span>
                  <ArrowRight aria-hidden="true" />
                </Button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              generation.current++;
              setSelected("");
              setPlan(null);
              setError("");
              setNotice("");
            }}
          >
            <ArrowLeft />
            All Lua games
          </Button>
          <section
            className="fixes-detail"
            aria-label={`Fix for ${game.name || game.appId}`}
          >
            <div className="fixes-game-heading">
              <GameArtwork appId={game.appId} thumbnail />
              <div>
                <h2>{game.name || `AppID ${game.appId}`}</h2>
                <small>AppID {game.appId}</small>
              </div>
            </div>
            {installed.installed && (
              <div className="fixes-installed" role="status">
                <strong>Fix installed and verified</strong>
                <p>
                  Files match the installed package. Test multiplayer in-game.
                </p>
              </div>
            )}
            {!installed.installed && installed.canUndo && (
              <p role="status">
                Files changed since installation. Check the game version before
                applying another fix.
              </p>
            )}
            {busy && !plan && <p role="status">Checking files and fixes...</p>}
            {result?.warnings.map((warning, index) => (
              <p key={index} className="notice-box">
                {warning}
              </p>
            ))}
            {result?.providerError && (
              <p role="alert">{result.providerError}</p>
            )}
            {result && !result.providerError && result.fixes.length === 0 && (
              <p>No fixes listed on LuaTools for this game.</p>
            )}
            {!installed.installed && (
              <>
                <h3>Instructions</h3>
                {result &&
                  result.fixes.filter((fix) => fix.hasFix).length > 1 && (
                    <FilterSelect
                      label="Fix release"
                      value={releaseId}
                      onChange={(id) => {
                        setReleaseId(id);
                        setPlan(null);
                      }}
                      options={result.fixes
                        .filter((fix) => fix.hasFix)
                        .map((fix, index) => ({
                          value: fix.id,
                          label:
                            fix.title ||
                            fix.tags.map((tag) => tag.name).join(", ") ||
                            `Fix ${index + 1}`,
                        }))}
                    />
                  )}
                {release && (
                  <div className="fixes-release">
                    <strong>
                      {release.title ||
                        release.tags.map((tag) => tag.name).join(", ") ||
                        "Fix"}
                    </strong>
                    {release.description && (
                      <p className="fix-description">{release.description}</p>
                    )}
                  </div>
                )}
                <ol className="fixes-instructions">
                  <li>
                    Download the fix for your game version. Sign in on the
                    download site if asked.
                  </li>
                  <li>Close the game and Steam.</li>
                  <li>
                    Select the downloaded ZIP below, review the files, then
                    install.
                  </li>
                </ol>
                <div className="inline-controls">
                  <Button
                    disabled={busy}
                    onClick={() => {
                      void download();
                    }}
                  >
                    Download fix
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      void operate("preview");
                    }}
                  >
                    Select downloaded ZIP
                  </Button>
                </div>
                <p className="field-help">
                  ZIP packages only. Passworded archives, RAR/7z and installers
                  need the release's manual instructions.
                </p>
                {plan && (
                  <div className="fixes-review">
                    <h3>Review installation</h3>
                    <p className="field-help">
                      {plan.installPath}
                      {plan.destinationPrefix && `/${plan.destinationPrefix}`}
                    </p>
                    <ul className="fix-file-preview">
                      {plan.files.map((file) => (
                        <li key={file.name}>
                          {file.name} -{" "}
                          {file.before ? "Replace with backup" : "Add"}
                        </li>
                      ))}
                    </ul>
                    {errorNotice}
                    <Button
                      disabled={busy}
                      onClick={() => {
                        void operate("apply");
                      }}
                    >
                      Install fix
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setPlan(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </>
            )}
            {(!plan || installed.installed) && errorNotice}
            {installed.canUndo && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void operate("undo");
                }}
              >
                Undo fix
              </Button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
