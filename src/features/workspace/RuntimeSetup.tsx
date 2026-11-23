import { useState } from "react";
import { Button } from "@/components/ui/button";
import { selectLibraryFolder, steamRuntime } from "@/api/workspace";

type Props = {
  root?: string;
  compact?: boolean;
  onReady?: (root: string) => Promise<void>;
};
export function RuntimeSetup({ root, compact = false, onReady }: Props) {
  const [location, setLocation] = useState(root);
  const [status, setStatus] = useState<{
    installed: boolean;
    canUndo: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  async function run(action: "status" | "install" | "undo", choose = false) {
    setBusy(true);
    setFailed(false);
    try {
      const selected = choose ? await selectLibraryFolder() : location;
      if (choose && !selected) return;
      const result = await steamRuntime(action, selected ?? undefined);
      setLocation(result.steamRoot);
      setStatus(result);
      setMessage(
        action === "undo"
          ? "Runtime setup undone. Game files and configurations were kept."
          : result.installed
            ? "Runtime files are installed. Restart Steam to load them."
            : "Steam runtime is missing or incomplete.",
      );
      if (action === "install" && result.installed && onReady)
        await onReady(result.steamRoot);
    } catch (e) {
      setFailed(true);
      setMessage(
        (e instanceof Error ? e.message : String(e)).replace(
          /^[A-Z_]+:\s*/,
          "",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="runtime-controls">
      {!compact && location && <p className="field-help">{location}</p>}
      <div className="inline-controls">
        {!compact && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void run("status");
            }}
          >
            Check status
          </Button>
        )}
        {!compact && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void run("status", true);
            }}
          >
            Change Steam folder
          </Button>
        )}
        {(compact || status?.installed === false) && (
          <Button
            disabled={busy}
            onClick={() => {
              void run("install");
            }}
          >
            {busy ? "Setting up..." : "Set up Steam"}
          </Button>
        )}
        {!compact && status?.canUndo && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void run("undo");
            }}
          >
            Undo setup
          </Button>
        )}
      </div>
      {message && (
        <p className="field-help" role={failed ? "alert" : "status"}>
          {message}
        </p>
      )}
    </div>
  );
}
