import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  loadWorkspace,
  runWorkspace,
  type WorkspaceAction,
  type WorkspaceSnapshot,
} from "@/api/workspace";
import { WorkspaceContext } from "./workspace-context";
import { useLocalLibrary } from "./library-context";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { dataMode, snapshot: librarySnapshot } = useLocalLibrary();
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const running = useRef(false);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    try {
      const data = await loadWorkspace();
      if (alive.current) {
        setSnapshot(data);
        setLoading(false);
      }
    } catch (e) {
      if (alive.current) {
        setError(String(e instanceof Error ? e.message : e));
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    let active = true;
    void loadWorkspace().then(
      (data) => {
        if (active && alive.current) {
          setSnapshot(data);
          setLoading(false);
        }
      },
      (e) => {
        if (active && alive.current) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
      alive.current = false;
    };
  }, [librarySnapshot]);
  const theme = snapshot?.settings.theme;
  useEffect(() => {
    if (theme && dataMode === "real") {
      document.documentElement.classList.toggle("dark", theme === "dark");
      document.documentElement.classList.toggle("light", theme === "light");
      document.documentElement.style.colorScheme = theme;
    }
  }, [theme, dataMode]);
  const perform = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      try {
        await action();
        if (alive.current) {
          setError("");
          setMessage(success);
        }
        await refresh();
        return true;
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [refresh],
  );
  const run = useCallback(
    async (
      action: WorkspaceAction,
      ids: string[] = [],
      paths: string[] = [],
    ) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setError("");
      setMessage("");
      const poll = setInterval(() => {
        void refresh();
      }, 1500);
      try {
        const result = await runWorkspace(action, ids, paths);
        if (alive.current) {
          setMessage(
            `${result.cancelled ? "Cancelled. " : ""}${result.processed} processed · ${result.skipped} duplicates skipped${result.output ? ` · Saved to ${result.output}` : ""}`,
          );
          setError(result.errors.join("\n"));
        }
        return result;
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        clearInterval(poll);
        running.current = false;
        if (alive.current) setBusy(false);
        await refresh();
      }
    },
    [refresh],
  );
  useEffect(() => {
    if (!isTauri() || dataMode !== "real") return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop" && event.payload.paths.length)
          void run("import", [], event.payload.paths);
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((e) => {
        if (!disposed) setError(`Drag-and-drop unavailable: ${String(e)}`);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [run, dataMode]);
  return (
    <WorkspaceContext.Provider
      value={{
        snapshot,
        loading,
        busy: busy || !!snapshot?.busy,
        error,
        message,
        refresh,
        run,
        perform,
        dismiss: () => {
          setError("");
          setMessage("");
        },
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
