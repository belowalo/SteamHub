import { useEffect, useRef, useState, type ReactNode } from "react";
import { LibraryContext } from "./library-context";
import { listLibrary, scanLibrary } from "@/api/library";
import { loadWorkspace } from "@/api/workspace";
import type {
  LibrarySnapshot,
  AppError,
  LibraryScanRequest,
} from "@/contracts";

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [dataMode, setDataMode] = useState<"real" | "demo">("real");
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const id = ++generation.current;
    void (async () => {
      const [saved, settings] = await Promise.all([
        listLibrary(),
        loadWorkspace().catch(() => null),
      ]);
      if (
        settings?.settings.scanOnStart &&
        alive.current &&
        id === generation.current
      ) {
        setScanning(true);
        const scanned = await scanLibrary();
        if (alive.current && id === generation.current) setScanning(false);
        return scanned.ok
          ? { ok: true as const, data: scanned.data.snapshot }
          : scanned;
      }
      return saved;
    })().then((result) => {
      if (!alive.current || id !== generation.current) return;
      if (result.ok) setSnapshot(result.data);
      else setError(result.error);
      setLoading(false);
    });
    return () => {
      alive.current = false;
    };
  }, []);
  async function refresh() {
    const id = ++generation.current;
    setLoading(true);
    const result = await listLibrary();
    if (!alive.current || id !== generation.current) return;
    if (result.ok) {
      setSnapshot(result.data);
      setError(null);
    } else setError(result.error);
    setLoading(false);
  }
  async function scan(request?: LibraryScanRequest) {
    const id = ++generation.current;
    setScanning(true);
    setError(null);
    setScanMessage(null);
    const result = await scanLibrary(request);
    if (!alive.current || id !== generation.current) return;
    if (result.ok) {
      setSnapshot(result.data.snapshot);
      setScanMessage(
        `Scan completed: ${result.data.verifiedInstallations} verified installation records, ${result.data.observedInstallations} observed records, ${result.data.diagnosticCount} diagnostics. Steam files were read only.`,
      );
    } else {
      setError(result.error);
      const saved = await listLibrary();
      if (!alive.current || id !== generation.current) return;
      if (saved.ok) setSnapshot(saved.data);
    }
    setLoading(false);
    setScanning(false);
  }
  return (
    <LibraryContext.Provider
      value={{
        dataMode,
        setDataMode,
        snapshot,
        loading,
        scanning,
        error,
        scanMessage,
        refresh,
        scan,
      }}
    >
      {children}
    </LibraryContext.Provider>
  );
}
