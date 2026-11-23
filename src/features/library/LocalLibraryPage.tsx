import { useEffect, useState, type FormEvent } from "react";
import {
  FolderSearch,
  Grid2X2,
  List,
  Search,
  LoaderCircle,
} from "lucide-react";
import { useWorkspace } from "@/app/workspace-context";
import { useLocalLibrary } from "@/app/library-context";
import { gameHref } from "@/app/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  FilterSelect,
  LoadingSkeleton,
  PageHeader,
  StatusBadge,
} from "@/components/workspace/Primitives";
import type { InstallStatus } from "@/contracts";
import {
  getLuaLibrary,
  selectLibraryFolder,
  getGameStatusSummaries,
  type GameStatusSummary,
} from "@/api/workspace";
import { GameStatusButton } from "@/features/game/GameStatus";
import { GameArtwork } from "./GameArtwork";
import { LuaRemoval } from "./LuaRemoval";

const labels: Record<InstallStatus, string> = {
  verified_local: "Verified at last scan",
  absent: "Absent at last scan",
  not_checked: "Not verified",
  scan_failed: "Verification failed",
};
export function InstallationStatus({ status }: { status: InstallStatus }) {
  return (
    <StatusBadge
      tone={
        status === "verified_local"
          ? "green"
          : status === "scan_failed"
            ? "red"
            : "amber"
      }
    >
      {labels[status]}
    </StatusBadge>
  );
}
function AddRoot() {
  const { scan, scanning } = useLocalLibrary();
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^[a-z]:[\\/]/i.test(path.trim())) {
      setError(
        "Enter an absolute local Windows folder, for example G:\\Steam. Network paths are unsupported.",
      );
      return;
    }
    setOpen(false);
    void scan({ rootPaths: [path.trim()] });
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={scanning}>
          Select library root
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Scan a local library root</DialogTitle>
            <DialogDescription>
              Choose the Steam or SteamLibrary folder containing steamapps. Only
              libraryfolders.vdf and appmanifest records are read. Discovered
              library roots are remembered in SteamHub’s own database.
            </DialogDescription>
          </DialogHeader>
          <label className="field-label mt-5" htmlFor="library-root">
            Local Steam library folder
          </label>
          <Input
            id="library-root"
            value={path}
            onChange={(event) => {
              setPath(event.target.value);
              setError("");
            }}
            placeholder="G:\Steam"
            aria-invalid={!!error}
            aria-describedby={error ? "root-error" : undefined}
          />
          {error && (
            <p role="alert" className="form-error" id="root-error">
              {error}
            </p>
          )}
          <DialogFooter className="mt-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void selectLibraryFolder().then(
                  (folder) => {
                    if (folder) {
                      setPath(folder);
                      setError("");
                    }
                  },
                  (e) => setError(e instanceof Error ? e.message : String(e)),
                );
              }}
            >
              Browse folders…
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Scan selected root</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function LocalLibraryPage({
  initialQuery = "",
}: {
  initialQuery?: string;
}) {
  const { snapshot, loading, scanning, error, scan, scanMessage } =
    useLocalLibrary();
  const { snapshot: workspace, refresh: refreshWorkspace } = useWorkspace();
  const [removeGame, setRemoveGame] = useState<{
    appId: string;
    name: string | null;
  } | null>(null);
  const luaApps = new Set(workspace?.luaApps ?? []);
  const [luaTitles, setLuaTitles] = useState<
    Array<{ appId: string; name: string | null }>
  >([]);
  const [luaLoadedKey, setLuaLoadedKey] = useState("");
  const [luaError, setLuaError] = useState("");
  const luaKey = [...luaApps].sort().join(",");
  useEffect(() => {
    if (!luaKey) return;
    let active = true;
    void getLuaLibrary().then(
      (games) => {
        if (active) {
          setLuaTitles(games);
          setLuaLoadedKey(luaKey);
          setLuaError("");
        }
      },
      (e) => {
        if (active) {
          setLuaLoadedKey(luaKey);
          setLuaError(e instanceof Error ? e.message : String(e));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [luaKey]);
  type Entry = {
    appId: string;
    name: string | null;
    installStatus: InstallStatus;
    installationCount: number;
    configurationOnly: boolean;
  };
  const entries = new Map<string, Entry>(
    (snapshot?.games ?? []).map((game) => [
      game.appId,
      { ...game, configurationOnly: false },
    ]),
  );
  for (const game of luaTitles) {
    if (luaApps.has(game.appId) && !entries.has(game.appId))
      entries.set(game.appId, {
        ...game,
        installStatus: "not_checked",
        installationCount: 0,
        configurationOnly: true,
      });
  }
  const [summaries, setSummaries] = useState<Record<string, GameStatusSummary>>(
    {},
  );
  const statusKey = [...entries.keys()].sort().join(",");
  useEffect(() => {
    if (!statusKey) return;
    let active = true;
    const ids = statusKey.split(",");
    const batches = [];
    for (let i = 0; i < ids.length; i += 500)
      batches.push(getGameStatusSummaries(ids.slice(i, i + 500)));
    void Promise.all(batches).then(
      (values) => {
        if (active)
          setSummaries(
            Object.fromEntries(
              values.flat().map((value) => [value.appId, value]),
            ),
          );
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [statusKey]);
  const updateStatus = (value: GameStatusSummary) =>
    setSummaries((previous) => ({ ...previous, [value.appId]: value }));
  const [method, setMethod] = useState("all");
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("name");
  const [view, setView] = useState("grid");
  const games = [...entries.values()]
    .sort((a, b) => {
      const names = (a.name ?? a.appId).localeCompare(b.name ?? b.appId);
      if (sort === "installed")
        return (
          Number(b.installStatus === "verified_local") -
            Number(a.installStatus === "verified_local") || names
        );
      return sort === "reverse" ? -names : names;
    })
    .filter(
      (game) =>
        `${game.name ?? ""} ${game.appId}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()) &&
        (status === "all" || game.installStatus === status) &&
        (method === "all" ||
          (method === "lua"
            ? luaApps.has(game.appId)
            : !luaApps.has(game.appId))),
    );
  return (
    <>
      <PageHeader
        title="Game Library"
        description="Real local Steam installation records. No ownership or entitlement is inferred."
        actions={
          <Button
            onClick={() => {
              void scan();
            }}
            disabled={scanning || loading}
          >
            {scanning ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <FolderSearch />
            )}
            {scanning ? "Scanning libraries…" : "Scan local libraries"}
          </Button>
        }
      />
      <div className="catalog-toolbar">
        <AddRoot />
        <span className="source-attribution">
          Last scan:{" "}
          {snapshot?.lastScanAt
            ? new Date(snapshot.lastScanAt).toLocaleString()
            : "Not scanned"}
        </span>
      </div>
      <LuaRemoval
        game={removeGame}
        onClose={() => setRemoveGame(null)}
        onChanged={refreshWorkspace}
      />
      {scanning && (
        <p role="status" className="notice-box" aria-live="polite">
          Scanning Steam libraries…
        </p>
      )}
      {scanMessage && (
        <p role="status" className="notice-box" data-testid="scan-result">
          {scanMessage}
        </p>
      )}
      {error && (
        <div role="alert" className="notice-box">
          <div>
            <strong>
              {error.code === "NO_STEAM_INSTALLATION"
                ? "Steam installation not found"
                : "Local library operation failed"}
            </strong>
            <p>{error.message}</p>
          </div>
        </div>
      )}
      {luaError && method === "lua" && <p role="alert">{luaError}</p>}
      {loading ? (
        <LoadingSkeleton />
      ) : (
        <>
          <div className="catalog-toolbar library-filters">
            <div className="search-field">
              <Search />
              <Input
                aria-label="Filter local library"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search your games…"
              />
            </div>
            <FilterSelect
              label="Added method"
              value={method}
              onChange={setMethod}
              options={[
                { value: "all", label: "All games" },
                { value: "lua", label: "Added through Lua" },
                { value: "other", label: "Other games" },
              ]}
            />
            <FilterSelect
              label="Local installation status"
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "Any install status" },
                ...Object.entries(labels).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
            />
            <FilterSelect
              label="Sort games"
              value={sort}
              onChange={setSort}
              options={[
                { value: "name", label: "Name A–Z" },
                { value: "reverse", label: "Name Z–A" },
                { value: "installed", label: "Installed first" },
              ]}
            />
            <div className="view-toggle">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Grid view"
                aria-pressed={view === "grid"}
                onClick={() => setView("grid")}
              >
                <Grid2X2 />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Table view"
                aria-pressed={view === "table"}
                onClick={() => setView("table")}
              >
                <List />
              </Button>
            </div>
          </div>
          <p className="source-attribution">{games.length} games</p>
          {method === "lua" && luaKey && luaLoadedKey !== luaKey && (
            <p role="status" className="field-help">
              Loading Lua game titles...
            </p>
          )}
          {games.length ? (
            view === "grid" ? (
              <div className="game-grid">
                {games.map((game) => (
                  <article
                    className="game-card library-game-card"
                    key={game.appId}
                  >
                    <a
                      href={gameHref(
                        game.appId,
                        game.configurationOnly ? "catalog" : "local",
                      )}
                    >
                      <GameArtwork appId={game.appId} />
                      <div className="game-card-body">
                        <div className="game-card-title">
                          <h2 className="text-sm font-semibold">
                            {game.name ?? `AppID ${game.appId}`}
                          </h2>
                        </div>
                        <p>AppID {game.appId}</p>
                        <div className="game-card-footer">
                          {game.configurationOnly ? (
                            <StatusBadge tone="amber">
                              Lua configured
                            </StatusBadge>
                          ) : (
                            <InstallationStatus status={game.installStatus} />
                          )}
                          {!game.configurationOnly &&
                            luaApps.has(game.appId) && (
                              <StatusBadge tone="blue">Lua</StatusBadge>
                            )}
                        </div>
                      </div>
                    </a>
                    <div className="library-game-status">
                      <GameStatusButton
                        appId={game.appId}
                        name={game.name ?? `AppID ${game.appId}`}
                        summary={summaries[game.appId]}
                        onChange={updateStatus}
                      />
                      {luaApps.has(game.appId) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove Lua entry for ${game.name ?? game.appId}`}
                          onClick={() => setRemoveGame(game)}
                        >
                          Remove Lua entry
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="table-surface">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Game</TableHead>
                      <TableHead>AppID</TableHead>
                      <TableHead>Installations</TableHead>
                      <TableHead>Verification</TableHead>
                      <TableHead>Game status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {games.map((game) => (
                      <TableRow key={game.appId}>
                        <TableCell>
                          <a
                            className="library-table-game font-semibold"
                            href={gameHref(
                              game.appId,
                              game.configurationOnly ? "catalog" : "local",
                            )}
                          >
                            <GameArtwork appId={game.appId} thumbnail />
                            {game.name ?? `AppID ${game.appId}`}
                          </a>
                        </TableCell>
                        <TableCell>{game.appId}</TableCell>
                        <TableCell>{game.installationCount}</TableCell>
                        <TableCell>
                          {game.configurationOnly ? (
                            <StatusBadge tone="amber">
                              Lua configured
                            </StatusBadge>
                          ) : (
                            <InstallationStatus status={game.installStatus} />
                          )}
                        </TableCell>
                        <TableCell>
                          <GameStatusButton
                            appId={game.appId}
                            name={game.name ?? `AppID ${game.appId}`}
                            summary={summaries[game.appId]}
                            onChange={updateStatus}
                          />
                          {luaApps.has(game.appId) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Remove Lua entry for ${game.name ?? game.appId}`}
                              onClick={() => setRemoveGame(game)}
                            >
                              Remove Lua entry
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          ) : (
            <EmptyState
              title={
                snapshot?.lastScanAt
                  ? "No local records match"
                  : "Your local library has not been scanned"
              }
              description={
                snapshot?.lastScanAt
                  ? "Adjust the filters or scan the libraries again. An empty successful scan does not indicate ownership or entitlement."
                  : "Scan automatically detected Steam folders or select a library root. Demo records are available separately in Data mode."
              }
              action={
                <Button
                  variant="outline"
                  disabled={scanning}
                  onClick={() => {
                    setQuery("");
                    setStatus("all");
                    if (!snapshot?.lastScanAt) void scan();
                  }}
                >
                  {snapshot?.lastScanAt
                    ? "Clear filters"
                    : "Scan detected roots"}
                </Button>
              }
            />
          )}
        </>
      )}
      {!!snapshot?.roots.length && (
        <details className="library-folder-details">
          <summary>
            Library folders <span>{snapshot.roots.length}</span>
          </summary>
          <div className="local-root-list">
            {snapshot.roots.map((root) => (
              <details key={root.path}>
                <summary>
                  <span>{root.path}</span>
                  <StatusBadge
                    tone={root.status === "complete" ? "green" : "amber"}
                  >
                    {root.status} · {root.diagnostics.length} diagnostics
                  </StatusBadge>
                </summary>
                <p className="body-copy">
                  {root.source} · last attempt{" "}
                  {root.attemptedAt ?? "not checked"}
                </p>
                {root.diagnostics.map((diagnostic, i) => (
                  <div key={i} className="notice-box">
                    <div>
                      <strong>{diagnostic.code}</strong>
                      <p className="break-all">{diagnostic.path}</p>
                      <p>{diagnostic.message}</p>
                    </div>
                  </div>
                ))}
              </details>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
