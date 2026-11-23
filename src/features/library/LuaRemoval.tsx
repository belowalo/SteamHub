import { useCallback, useEffect, useState } from "react";
import { luaRemoval, type LuaRemovalPlan } from "@/api/workspace";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Game = { appId: string; name: string | null };
const readable = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/^[A-Z_]+:\s*/, "");
export function LuaRemoval({
  game,
  onClose,
  onChanged,
}: {
  game: Game | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [plan, setPlan] = useState<LuaRemovalPlan | null>(null);
  const [history, setHistory] = useState<LuaRemovalPlan[]>([]);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadedPreviewKey, setLoadedPreviewKey] = useState("");
  const [notice, setNotice] = useState("");
  const app = game?.appId;
  const name = game?.name ?? app;
  const reload = useCallback(async () => {
    try {
      const entries = await luaRemoval("history");
      setHistory(entries);
      setHistoryError("");
    } catch (e) {
      setHistoryError(readable(e));
    }
  }, []);
  useEffect(() => {
    let active = true;
    void luaRemoval("history").then(
      (entries) => {
        if (active) setHistory(entries);
      },
      (e) => {
        if (active) setHistoryError(readable(e));
      },
    );
    return () => {
      active = false;
    };
  }, []);
  const [previewVersion, setPreviewVersion] = useState(0);
  const previewKey = `${app ?? ""}:${name ?? ""}:${previewVersion}`;
  const loading = !!app && loadedPreviewKey !== previewKey;
  useEffect(() => {
    if (!app) return;
    let active = true;
    void luaRemoval("preview", app, name).then(
      (plans) => {
        if (active) {
          setPlan(plans[0] ?? null);
          setError("");
          setLoadedPreviewKey(previewKey);
        }
      },
      (e) => {
        if (active) {
          setError(readable(e));
          setPlan(null);
          setLoadedPreviewKey(previewKey);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [app, name, previewKey]);
  async function change(action: "apply" | "undo", selected: LuaRemovalPlan) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await luaRemoval(action, null, null, selected.id);
      setNotice(
        action === "apply"
          ? `${selected.name}: Lua entry removed and backed up. Restart Steam to apply the change. Owned games and downloaded game files are kept.`
          : `${selected.name}: Lua files restored. Restart Steam to load the entry again.`,
      );
      if (action === "apply") onClose();
      await onChanged().catch(() =>
        setError(
          "Lua files were updated, but the library could not refresh. Reopen Game Library.",
        ),
      );
    } catch (e) {
      setError(readable(e));
    } finally {
      await reload();
      setBusy(false);
    }
  }
  return (
    <>
      {notice && (
        <p className="notice-box" role="status">
          {notice}
        </p>
      )}
      {!game && error && (
        <p className="notice-box" role="alert">
          {error}
        </p>
      )}
      {(history.length > 0 || historyError) && (
        <details className="lua-removal-history">
          <summary>Removed Lua entries ({history.length})</summary>
          {historyError && <p role="alert">{historyError}</p>}
          {history.map((item) => (
            <div className="lua-removal-history-row" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <p>
                  AppID {item.app} · {item.files.length} Lua files backed up
                </p>
                {item.blocked.map((reason) => (
                  <p key={reason}>{reason}</p>
                ))}
              </div>
              <Button
                variant="outline"
                disabled={busy || !item.canUndo}
                onClick={() => {
                  void change("undo", item);
                }}
              >
                Undo removal
              </Button>
            </div>
          ))}
        </details>
      )}
      <Dialog
        open={!!game}
        onOpenChange={(open) => {
          if (!open && !busy) onClose();
        }}
      >
        <DialogContent
          className="lua-removal-dialog"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Remove Lua entry for {game?.name ?? app}?</DialogTitle>
            <DialogDescription>
              Close Steam first. Only the Lua files listed below will be
              disabled, with backups for undo. Downloaded game files, manifests
              and runtime files are kept. Restart Steam afterward; games you own
              remain in your Steam library.
            </DialogDescription>
          </DialogHeader>
          {loading && <p role="status">Finding matching Lua files…</p>}
          {error && !loading && <p role="alert">{error}</p>}
          {!loading && plan && plan.app === app && (
            <>
              {!plan.files.length && !plan.blocked.length && (
                <p>No active Lua files were found for this game.</p>
              )}
              <ul className="lua-removal-files">
                {plan.files.map((file) => (
                  <li key={file.path}>
                    <code>{file.path}</code>
                    <small>{file.size.toLocaleString()} bytes</small>
                  </li>
                ))}
              </ul>
              {plan.blocked.map((reason) => (
                <p className="notice-box" role="alert" key={reason}>
                  {reason}
                </p>
              ))}
              {!!plan.files.length && !plan.blocked.length && (
                <p className="field-help">
                  {plan.files.length} Lua files will be backed up and disabled.
                  You can undo from Removed Lua entries in Game Library.
                </p>
              )}
            </>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={onClose}>
              Keep game
            </Button>
            <Button
              variant="outline"
              disabled={busy || loading}
              onClick={() => setPreviewVersion((value) => value + 1)}
            >
              Refresh preview
            </Button>
            <Button
              variant="destructive"
              disabled={
                busy ||
                loading ||
                plan?.app !== app ||
                !plan?.files.length ||
                !!plan.blocked.length
              }
              onClick={() => {
                if (plan) void change("apply", plan);
              }}
            >
              {busy ? "Removing…" : "Remove Lua entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
