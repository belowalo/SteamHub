import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";

type Status = {
  app: string;
  compatibility: string;
  restartReady: boolean;
  compatibilityPending: boolean;
};
export function AutomaticUpdates() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    const request = async (action: "check" | "status") => {
      try {
        const result = await invoke<Status>("automatic_updates", { action });
        if (active) {
          setStatus(result);
          setError("");
        }
      } catch {
        if (active)
          setError("Automatic update check failed. Restart SteamHub to retry.");
      }
    };
    void request("check");
    const timer = setInterval(() => void request("status"), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  if (
    !error &&
    !status?.restartReady &&
    !status?.compatibilityPending &&
    !status?.compatibility.startsWith("Compatibility update stopped")
  )
    return null;
  return (
    <div className="notice-box" role="status" aria-live="polite">
      {error && <p>{error}</p>}
      {status?.restartReady && <p>{status.app}</p>}
      {(status?.compatibilityPending ||
        status?.compatibility.startsWith("Compatibility update stopped")) && (
        <p>{status.compatibility}</p>
      )}
      {status?.restartReady && (
        <Button
          onClick={() => {
            void invoke("automatic_updates", { action: "install" }).catch(() =>
              setError(
                "Update installation failed. Your current version is still available. Restart SteamHub to retry.",
              ),
            );
          }}
        >
          Restart and update
        </Button>
      )}
    </div>
  );
}
