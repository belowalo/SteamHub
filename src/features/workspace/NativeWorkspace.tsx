import { useEffect, useState, type ReactNode } from "react";
import { version as appVersion } from "../../../package.json";
import {
  ArrowUpRight,
  Braces,
  CheckCheck,
  Download,
  FileArchive,
  FileText,
  FolderOpen,
  FolderSearch,
  HardDrive,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  EmptyState,
  FilterSelect,
  LoadingSkeleton,
  PageHeader,
  Panel,
  StatusBadge,
} from "@/components/workspace/Primitives";
import { useWorkspace } from "@/app/workspace-context";
import { useLocalLibrary } from "@/app/library-context";
import { gameHref } from "@/app/navigation";
import {
  associateFile,
  cancelWorkspace,
  createManagedFile,
  openReference,
  openWorkspaceFolder,
  readManagedFile,
  saveSettings,
  selectLibraryFolder,
  steamAction,
  type ManagedFile,
} from "@/api/workspace";
import {
  getCatalogProviderStatus,
  setCatalogApiKey,
  syncCatalog,
} from "@/api/catalog";
import type { CatalogProviderStatus } from "@/contracts";
import { BackendHealth } from "@/features/dashboard/BackendHealth";
import { SteamToolsGenerator } from "./SteamToolsGenerator";
import { RuntimeSetup } from "./RuntimeSetup";
import { GameDataSources } from "./GameDataSources";
import { StoreRegionSettings } from "@/features/store/StoreRegionSettings";
import { NonSteamShortcuts } from "@/features/library/NonSteamShortcuts";

const dateText = (value: string) => {
  const n = /^\d+$/.test(value) ? Number(value) : NaN;
  const d = new Date(Number.isNaN(n) ? value : n);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
};
const fileSize = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KiB`
      : `${(n / 1048576).toFixed(1)} MiB`;

export function WorkspaceNotice() {
  const { error, message, busy, dismiss, perform } = useWorkspace();
  if (!error && !message && !busy) return null;
  return (
    <div className="native-notice" aria-live="polite">
      {busy && (
        <div role="status" className="notice-box">
          <RefreshCw className="animate-spin" />
          <span>
            Workspace operation in progress. Completed items are saved as they
            finish.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void perform(
                cancelWorkspace,
                "Cancellation requested; the worker will stop at the next file boundary.",
              );
            }}
          >
            Cancel operation
          </Button>
        </div>
      )}
      {error && (
        <div role="alert" className="notice-box native-error">
          <span className="whitespace-pre-wrap">{error}</span>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Dismiss message"
            onClick={dismiss}
          >
            <X />
          </Button>
        </div>
      )}
      {message && !busy && (
        <div role="status" className="notice-box">
          <CheckCheck />
          <span>{message}</span>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Dismiss message"
            onClick={dismiss}
          >
            <X />
          </Button>
        </div>
      )}
    </div>
  );
}
export function ReferenceButton({
  url,
  children,
}: {
  url: string;
  children: ReactNode;
}) {
  const { perform } = useWorkspace();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        void perform(
          () => openReference(url),
          "Opened in your default browser.",
        );
      }}
    >
      {children}
      <ArrowUpRight />
    </Button>
  );
}
export function SteamButtons({ appId }: { appId: string }) {
  const { perform } = useWorkspace();
  return (
    <div className="inline-controls">
      <Button
        onClick={() => {
          void perform(
            () => steamAction(appId, "launch"),
            "Launch request sent to Steam.",
          );
        }}
      >
        Launch in Steam
      </Button>
      <Button
        variant="outline"
        onClick={() => {
          void perform(
            () => steamAction(appId, "properties"),
            "Opened game properties in Steam.",
          );
        }}
      >
        Steam properties
      </Button>
    </div>
  );
}
export function NativeDashboard() {
  const { snapshot, scan, scanning, error } = useLocalLibrary();
  const { snapshot: workspace, run, busy } = useWorkspace();
  const verified =
    snapshot?.games.filter((g) => g.installStatus === "verified_local") ?? [];
  return (
    <>
      <PageHeader
        title="Your library, connected"
        description="Your installed Steam games, configuration vault, and everyday tools in one desktop workspace."
        actions={
          <Button
            disabled={scanning}
            onClick={() => {
              void scan();
            }}
          >
            <FolderSearch />
            {scanning ? "Scanning…" : "Scan Steam libraries"}
          </Button>
        }
      />
      <div className="native-hero">
        <div>
          <p className="eyebrow">STEAMHUB DESKTOP</p>
          <h2>A home for your game library.</h2>
          <p>
            Discover what’s installed. Keep configurations organized. Back up
            your workspace and pick up where you left off.
          </p>
          <div className="inline-controls">
            <Button asChild>
              <a href="#/library">
                Explore your library <ArrowUpRight />
              </a>
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                void run("import");
              }}
            >
              <Upload />
              Import files
            </Button>
          </div>
        </div>
        <HardDrive aria-hidden="true" />
      </div>
      {error && (
        <div role="alert" className="notice-box">
          {error.message}
        </div>
      )}
      <div className="native-metrics">
        {[
          ["Verified games", verified.length],
          ["Library roots", snapshot?.roots.length ?? 0],
          ["Managed files", workspace?.files.length ?? 0],
          [
            "Managed storage",
            fileSize(
              workspace?.files.reduce((size, file) => size + file.size, 0) ?? 0,
            ),
          ],
        ].map(([label, count]) => (
          <Panel key={label}>
            <p className="eyebrow">{label}</p>
            <strong className="metric-value">{count}</strong>
          </Panel>
        ))}
      </div>
      <div className="native-two-columns">
        <Panel
          title="Installed on this PC"
          action={
            <Button asChild variant="ghost" size="sm">
              <a href="#/library">
                View all <ArrowUpRight />
              </a>
            </Button>
          }
        >
          {verified.length ? (
            <div className="native-list">
              {verified.slice(0, 6).map((g) => (
                <a key={g.appId} href={gameHref(g.appId, "local")}>
                  <span className="native-file-icon">
                    <HardDrive />
                  </span>
                  <span>
                    <strong>{g.name ?? g.appId}</strong>
                    <small>AppID {g.appId}</small>
                  </span>
                  <ArrowUpRight />
                </a>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Start with a library scan"
              description="SteamHub reads Steam’s local library records. Scan to discover your installed games."
            />
          )}
        </Panel>
        <div className="native-stack">
          <Panel title="Your workspace">
            <div className="native-list">
              {[
                [
                  "lua",
                  "Lua Studio",
                  "Import, inspect, and version configurations",
                ],
                [
                  "manifests",
                  "Manifest Manager",
                  "Organize local metadata and depot manifests",
                ],
                [
                  "tools",
                  "Backup & integrity",
                  "Protect and verify your managed files",
                ],
              ].map(([page, title, desc]) => (
                <a key={page} href={`#/${page}`}>
                  <span className="native-file-icon">
                    <FileText />
                  </span>
                  <span>
                    <strong>{title}</strong>
                    <small>{desc}</small>
                  </span>
                  <ArrowUpRight />
                </a>
              ))}
            </div>
          </Panel>
          <BackendHealth />
        </div>
      </div>
    </>
  );
}

function FileEditor({
  file,
  close,
}: {
  file?: ManagedFile;
  close: () => void;
}) {
  const { perform, busy } = useWorkspace();
  const [name, setName] = useState(file?.name ?? "configuration.lua");
  const [text, setText] = useState(
    file ? "" : "-- My configuration\nreturn {}\n",
  );
  const [app, setApp] = useState(file?.appId ?? "");
  const [source, setSource] = useState(file?.source ?? "Authored in SteamHub");
  const [version, setVersion] = useState(
    file ? `${file.version} edited` : "v1",
  );
  const [loading, setLoading] = useState(!!file);
  const [readError, setReadError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!file) return;
    let active = true;
    void readManagedFile(file.id).then(
      (s) => {
        if (active) {
          setText(s);
          setLoading(false);
        }
      },
      (e) => {
        if (active) {
          setReadError(String(e));
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [file]);
  const editable =
    !file || (file.extension !== "manifest" && file.size <= 256 * 1024);
  return (
    <DialogContent className="native-editor-dialog">
      <DialogHeader>
        <DialogTitle>
          {file ? "Inspect configuration" : "New Lua configuration"}
        </DialogTitle>
        <DialogDescription>
          Text is never executed. Saving creates a validated file version in
          your vault. Original versions remain available.
        </DialogDescription>
      </DialogHeader>
      {loading ? (
        <LoadingSkeleton />
      ) : readError ? (
        <div role="alert">{readError}</div>
      ) : (
        <>
          <div className="native-form-grid">
            <label>
              Filename
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!editable}
                maxLength={240}
              />
            </label>
            <label>
              AppID (optional)
              <Input
                value={app}
                onChange={(e) => setApp(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <label>
              Source
              <Input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                maxLength={1024}
              />
            </label>
            <label>
              Version
              <Input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                maxLength={128}
              />
            </label>
          </div>
          {file && (
            <div className="native-hash">
              <strong>SHA-256</strong> <code>{file.id}</code>
            </div>
          )}
          {file?.warnings.map((w) => (
            <p className="source-attribution" key={w}>
              {w}
            </p>
          ))}
          <Textarea
            aria-label="Configuration text"
            className="native-code-editor"
            value={text}
            onChange={(e) => setText(e.target.value)}
            readOnly={!editable}
            spellCheck={false}
          />
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Close
            </Button>
            {file && (
              <Button
                variant="outline"
                disabled={saving || busy}
                onClick={() => {
                  setSaving(true);
                  void perform(
                    () => associateFile(file.id, app, source, version),
                    "File metadata saved.",
                  ).then((ok) => {
                    setSaving(false);
                    if (ok) close();
                  });
                }}
              >
                <Save />
                Save metadata
              </Button>
            )}
            {editable && (
              <Button
                disabled={saving || busy}
                onClick={() => {
                  setSaving(true);
                  void perform(
                    () => createManagedFile(name, text, app, source, version),
                    "Configuration saved. Identical content reuses the existing version.",
                  ).then((ok) => {
                    setSaving(false);
                    if (ok) close();
                  });
                }}
              >
                <Save />
                Save new version
              </Button>
            )}
          </DialogFooter>
        </>
      )}
    </DialogContent>
  );
}

export function NativeFiles({
  manifests = false,
  initialQuery = "",
}: {
  manifests?: boolean;
  initialQuery?: string;
}) {
  const { snapshot, loading, busy, run } = useWorkspace();
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState<ManagedFile | "new" | null>(null);
  const [remove, setRemove] = useState(false);
  const all =
    snapshot?.files.filter((f) =>
      manifests ? f.extension !== "lua" : f.extension === "lua",
    ) ?? [];
  const files = all.filter(
    (f) =>
      `${f.name} ${f.appId ?? ""} ${f.source} ${f.version} ${f.id}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "unassigned" ? !f.appId : f.extension === filter)),
  );
  const ids = selected.filter((id) => all.some((f) => f.id === id));
  const conflicts = (f: ManagedFile) =>
    all.filter(
      (other) =>
        other.id !== f.id &&
        other.appId === f.appId &&
        other.name.toLowerCase() === f.name.toLowerCase(),
    ).length > 0;
  return (
    <>
      <PageHeader
        title={manifests ? "Manifest Manager" : "Lua Studio"}
        description={
          manifests
            ? "Keep app metadata and depot manifests organized in a separate, hashed vault."
            : "Generate, inspect, and version Lua configurations, then deploy them to your Steam runtime."
        }
        actions={
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                void run("backup");
              }}
            >
              <FileArchive />
              Back up workspace
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                void run("import");
              }}
            >
              <Upload />
              Import files
            </Button>
          </>
        }
      />
      {!manifests && <SteamToolsGenerator />}
      <div className="native-drop-zone">
        <Upload />
        <div>
          <strong>Drop files to import</strong>
        </div>
        {!manifests && (
          <Button
            variant="outline"
            onClick={() => setEditor("new")}
            disabled={busy}
          >
            <Braces />
            New configuration
          </Button>
        )}
      </div>
      <div className="catalog-toolbar">
        <div className="search-field">
          <Search />
          <Input
            aria-label="Search managed files"
            placeholder="Search filename, AppID, source, version, or SHA-256…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <FilterSelect
          label="Filter managed files"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All files" },
            { value: "unassigned", label: "No AppID" },
            ...(manifests
              ? [
                  { value: "acf", label: "App manifests" },
                  { value: "vdf", label: "VDF files" },
                  { value: "manifest", label: "Depot manifests" },
                ]
              : []),
          ]}
        />
      </div>
      <div className="native-selection">
        <span>
          {files.length} files · {ids.length} selected
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !ids.length}
          onClick={() => {
            void run("verify", ids);
          }}
        >
          <ShieldCheck />
          Verify
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !ids.length}
          onClick={() => {
            void run("export", ids);
          }}
        >
          <Download />
          Export copies
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !ids.length}
          onClick={() => setRemove(true)}
        >
          <Trash2 />
          Delete
        </Button>
      </div>
      {loading ? (
        <LoadingSkeleton />
      ) : !files.length ? (
        <EmptyState
          title={query ? "No matching files" : "Your vault is ready"}
          description="Import your own configurations to inspect, associate with AppIDs, verify, export, and back up."
        />
      ) : (
        <div className="table-wrap">
          <table className="native-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all visible files"
                    checked={
                      files.length > 0 && files.every((f) => ids.includes(f.id))
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? files.map((f) => f.id) : [],
                      )
                    }
                  />
                </th>
                <th>Configuration</th>
                <th>AppID</th>
                <th>Source / version</th>
                <th>Size</th>
                <th>Imported</th>
                <th>Inspect</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${f.name}`}
                      checked={ids.includes(f.id)}
                      onChange={(e) =>
                        setSelected((v) =>
                          e.target.checked
                            ? [...v, f.id]
                            : v.filter((id) => id !== f.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    <strong>{f.name}</strong>
                    <small className="native-hash">{f.id.slice(0, 16)}…</small>
                    {f.appId && conflicts(f) && (
                      <StatusBadge tone="amber">
                        Conflicting versions
                      </StatusBadge>
                    )}
                  </td>
                  <td>
                    {f.appId ? (
                      <a href={`#/search?q=${f.appId}`}>{f.appId}</a>
                    ) : (
                      "Unassigned"
                    )}
                  </td>
                  <td>
                    {f.source}
                    <small>{f.version}</small>
                  </td>
                  <td>{fileSize(f.size)}</td>
                  <td>{dateText(f.importedAt)}</td>
                  <td>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditor(f)}
                    >
                      Inspect
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={editor !== null}
        onOpenChange={(v) => {
          if (!v) setEditor(null);
        }}
      >
        {editor !== null && (
          <FileEditor
            key={editor === "new" ? "new" : editor.id}
            file={editor === "new" ? undefined : editor}
            close={() => setEditor(null)}
          />
        )}
      </Dialog>
      <Dialog open={remove} onOpenChange={setRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {ids.length} vault files?</DialogTitle>
            <DialogDescription>
              This removes SteamHub’s managed copies and metadata. Your original
              files and Steam installation are preserved. Back up first if you
              need these versions.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemove(false)}>
              Keep files
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setRemove(false);
                void run("delete", ids).then(() => setSelected([]));
              }}
            >
              Delete selected copies
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NativeActivity({
  initialQuery = "",
}: {
  initialQuery?: string;
}) {
  const { snapshot, refresh, loading, busy } = useWorkspace();
  const [query, setQuery] = useState(initialQuery);
  const events =
    snapshot?.activity.filter((e) =>
      `${e.kind} ${e.status} ${e.message}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  return (
    <>
      <PageHeader
        title="Activity & Downloads"
        description="Persistent history of native workspace operations and requests sent to Steam. Downloads remain managed by Steam."
        actions={
          <Button
            variant="outline"
            onClick={() => {
              void refresh();
            }}
          >
            <RefreshCw />
            Refresh
          </Button>
        }
      />
      <Input
        aria-label="Search activity"
        placeholder="Filter activity…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {busy && (
        <p role="status" className="body-copy">
          A native operation is running. Cancel it using the workspace status
          above.
        </p>
      )}
      {loading ? (
        <LoadingSkeleton />
      ) : events.length ? (
        <div className="native-stack mt-5">
          {events.map((e) => (
            <Panel key={e.id}>
              <div className="native-event-title">
                <strong>{e.kind}</strong>
                <StatusBadge
                  tone={
                    e.status === "completed"
                      ? "green"
                      : e.status === "failed"
                        ? "red"
                        : "amber"
                  }
                >
                  {e.status.replaceAll("_", " ")}
                </StatusBadge>
                <time>{dateText(e.createdAt)}</time>
              </div>
              <p className="body-copy">{e.message}</p>
            </Panel>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No activity yet"
          description="Import files, verify your vault, or create a backup to record an operation here."
        />
      )}
    </>
  );
}

export function NativeTools() {
  const { snapshot, run, busy, perform } = useWorkspace();
  return (
    <>
      <PageHeader
        title="Tools"
        description="Maintain your workspace with integrity checks, portable backups, and diagnostics."
      />
      <div className="utility-sections">
        <Panel
          title="Backup & restore"
          description="ZIP backups preserve managed files, AppIDs, sources, versions, notes, and settings."
        >
          <p className="body-copy">
            Restore merges files and notes into your workspace. Matching hashes
            are skipped. Malformed archives and paths are rejected before files
            are imported.
          </p>
          <div className="inline-controls">
            <Button
              disabled={busy}
              onClick={() => {
                void run("backup");
              }}
            >
              <FileArchive />
              Create backup
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" disabled={busy}>
                  <Upload />
                  Restore backup
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Restore a workspace backup</DialogTitle>
                  <DialogDescription>
                    Choose a SteamHub backup ZIP. Files and notes will be
                    merged; matching notes and appearance settings will be
                    updated from the backup.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    onClick={() => {
                      void run("restore");
                    }}
                  >
                    Choose backup ZIP
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </Panel>
        <Panel
          title="File integrity"
          description="Compare every managed copy with its saved SHA-256 and byte count."
        >
          <p className="body-copy">
            {snapshot?.files.length ?? 0} managed files. This verifies stored
            bytes. It does not verify provider authenticity or Steam game files.
          </p>
          <Button
            disabled={busy}
            onClick={() => {
              void run("verify");
            }}
          >
            <ShieldCheck />
            Verify entire vault
          </Button>
        </Panel>
        <Panel title="Storage & logs">
          <dl className="facts">
            <div>
              <dt>Workspace</dt>
              <dd>{snapshot?.dataDirectory ?? "Desktop backend required"}</dd>
            </div>
            <div>
              <dt>Diagnostic log</dt>
              <dd>{snapshot?.logFile ?? "Desktop backend required"}</dd>
            </div>
          </dl>
          <div className="inline-controls">
            <Button
              variant="outline"
              onClick={() => {
                void perform(
                  () => openWorkspaceFolder(),
                  "Opened workspace folder.",
                );
              }}
            >
              <FolderOpen />
              Open data folder
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void perform(
                  () => openWorkspaceFolder(true),
                  "Opened log folder.",
                );
              }}
            >
              Open logs
            </Button>
          </div>
        </Panel>
        <Panel
          title="Diagnostic report"
          description="Export a JSON snapshot for troubleshooting."
        >
          <p className="body-copy">
            Reports include local game names, file metadata, activity,
            compatibility notes, and folder paths. Review before sharing.
          </p>
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => {
              void run("report");
            }}
          >
            <Download />
            Export diagnostic report
          </Button>
        </Panel>
        <BackendHealth />
        <NonSteamShortcuts />
      </div>
    </>
  );
}

export function NativeSettings() {
  const { snapshot, perform } = useWorkspace();
  const { snapshot: library, scan, scanning } = useLocalLibrary();
  return (
    <>
      <PageHeader
        title="Settings"
        description="Preferences are saved in your local SQLite database and survive application restarts."
      />
      <div className="utility-sections">
        <Panel title="Appearance">
          <label className="field-label" htmlFor="native-theme">
            Color theme
          </label>
          <select
            id="native-theme"
            className="native-select"
            value={snapshot?.settings.theme ?? "dark"}
            disabled={!snapshot}
            onChange={(e) => {
              if (snapshot)
                void perform(
                  () =>
                    saveSettings({
                      ...snapshot.settings,
                      theme: e.target.value as "dark" | "light",
                    }),
                  "Appearance saved.",
                );
            }}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </Panel>
        <Panel title="Steam store">
          <StoreRegionSettings />
        </Panel>
        <Panel title="Steam library">
          <label className="native-check">
            <input
              type="checkbox"
              checked={snapshot?.settings.scanOnStart ?? false}
              disabled={!snapshot}
              onChange={(e) => {
                if (snapshot)
                  void perform(
                    () =>
                      saveSettings({
                        ...snapshot.settings,
                        scanOnStart: e.target.checked,
                      }),
                    "Startup preference saved.",
                  );
              }}
            />
            Scan Steam libraries on startup
          </label>
          <p className="body-copy">
            Last scan:{" "}
            {library?.lastScanAt
              ? dateText(library.lastScanAt)
              : "Not scanned yet"}
          </p>
          <div className="inline-controls">
            <Button
              disabled={scanning}
              onClick={() => {
                void scan();
              }}
            >
              <RefreshCw />
              Rescan
            </Button>
            <Button
              variant="outline"
              disabled={scanning}
              onClick={() => {
                void perform(async () => {
                  const path = await selectLibraryFolder();
                  if (path) await scan({ rootPaths: [path] });
                }, "Folder selection finished.");
              }}
            >
              <FolderOpen />
              Choose library folder
            </Button>
          </div>
          {!!library?.roots.length && (
            <div className="library-root-paths">
              {library.roots.map((r) => (
                <code key={r.path}>{r.path}</code>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Steam integration">
          <RuntimeSetup />
        </Panel>
        <Panel title="Storage">
          <Button
            variant="outline"
            onClick={() => {
              void perform(
                () => openWorkspaceFolder(),
                "Opened workspace folder.",
              );
            }}
          >
            Open local storage
          </Button>
        </Panel>
      </div>
      <p className="app-version">SteamHub v{appVersion}</p>
    </>
  );
}

export function NativeSources() {
  const { perform } = useWorkspace();
  const [providers, setProviders] = useState<CatalogProviderStatus[]>([]);
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState("");
  async function reload() {
    const r = await getCatalogProviderStatus();
    if (r.ok) {
      setProviders(r.data);
      setError("");
    } else setError(r.error.message);
    setLoading(false);
  }
  useEffect(() => {
    let active = true;
    void getCatalogProviderStatus().then((r) => {
      if (active) {
        if (r.ok) setProviders(r.data);
        else setError(r.error.message);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);
  async function sync() {
    setSyncing(true);
    const r = await syncCatalog({ resume: true });
    if (r.ok) setResult(`${r.data.processed} entries · ${r.data.message}`);
    else setError(r.error.message);
    setSyncing(false);
    await reload();
  }
  return (
    <>
      <PageHeader
        title="Source Providers"
        description="Steam catalog sources and optional session credentials. All local file tools are built into SteamHub."
        actions={
          <Button
            variant="outline"
            onClick={() => {
              void reload();
            }}
          >
            <RefreshCw />
            Refresh status
          </Button>
        }
      />
      <GameDataSources />
      <details className="configuration-details advanced-catalog">
        <summary>Catalog settings</summary>
        {error && (
          <p role="alert" className="notice-box native-error">
            {error}
          </p>
        )}
        {loading ? (
          <LoadingSkeleton />
        ) : (
          <div className="utility-sections">
            {providers.map((p) => (
              <Panel
                key={p.id}
                title={p.displayName}
                description={p.capabilities.join(" · ")}
              >
                <StatusBadge tone={p.setupNeeded ? "amber" : "green"}>
                  {p.status.replaceAll("_", " ")}
                </StatusBadge>
                <p className="body-copy">
                  {p.id === "steam-storefront"
                    ? "Uses Steam storefront endpoints. These endpoints are unofficial and can change; saved catalog data is available as a fallback."
                    : "Official Steam Web API catalog index. An authorized Steam Web API key is required for sync."}
                </p>
                {p.documentationUrl && (
                  <ReferenceButton url={p.documentationUrl}>
                    Documentation
                  </ReferenceButton>
                )}
              </Panel>
            ))}
          </div>
        )}
        <Panel
          title="Optional Steam Web API key"
          description="Used only for the official catalog index. Search works without a key. Keys are held in memory and cleared when the app closes."
        >
          <div className="inline-controls">
            <Input
              type="password"
              aria-label="Steam Web API key"
              placeholder="Paste your Steam Web API key"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              maxLength={128}
            />
            <Button
              onClick={() => {
                void perform(async () => {
                  const r = await setCatalogApiKey(key);
                  if (!r.ok) throw new Error(r.error.message);
                  setKey("");
                  await reload();
                }, "Session API key updated.");
              }}
            >
              Set session key
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void perform(async () => {
                  const r = await setCatalogApiKey("");
                  if (!r.ok) throw new Error(r.error.message);
                  setKey("");
                  await reload();
                }, "Session API key cleared.");
              }}
            >
              Clear key
            </Button>
            <Button
              variant="outline"
              disabled={
                syncing ||
                !providers.some(
                  (p) => p.id === "steam-official" && !p.setupNeeded,
                )
              }
              onClick={() => {
                void sync();
              }}
            >
              {syncing ? "Syncing…" : "Sync / resume index"}
            </Button>
          </div>
          {result && <p role="status">{result}</p>}
        </Panel>
      </details>
    </>
  );
}
