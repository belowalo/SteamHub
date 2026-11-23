import { useRef, useState } from "react";
import { ClipboardCheck, RefreshCw } from "lucide-react";
import {
  getGameStatus,
  openReference,
  saveLaunchReport,
  type GameStatus,
  type GameStatusSummary,
  type LaunchResult,
} from "@/api/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FilterSelect, StatusBadge } from "@/components/workspace/Primitives";
import { compatibilityLabel } from "./game-status-label";

const resultLabels: Record<LaunchResult, string> = {
  untested: "Untested",
  launched: "Launched successfully",
  failed: "Doesn’t launch",
};
const formatDate = (time: number) => new Date(time * 1000).toLocaleString();
const readable = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function GameStatusButton({
  appId,
  name,
  summary,
  onChange,
}: {
  appId: string;
  name: string;
  summary?: GameStatusSummary;
  onChange?: (value: GameStatusSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<GameStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<LaunchResult>("untested");
  const [note, setNote] = useState("");
  const generation = useRef(0);
  async function load(refresh: boolean) {
    const current = ++generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await getGameStatus(appId, refresh);
      if (current !== generation.current) return;
      setData(value);
      setResult(value.personal.result);
      setNote(value.personal.note);
      onChange?.(value);
    } catch (e) {
      if (current === generation.current) setError(readable(e));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  async function save() {
    if (!data) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const personal = await saveLaunchReport(appId, result, note);
      const value = { ...data, personal, reportOutdated: false };
      setData(value);
      onChange?.(value);
      setNotice("Your launch result was saved on this PC.");
    } catch (e) {
      setError(readable(e));
    } finally {
      setBusy(false);
    }
  }
  const current = data ?? summary;
  const label = compatibilityLabel(current);
  const restricted = !!current?.compatibility.requirements.length;
  const triggerLabel =
    summary && compatibilityLabel(summary) !== "Unknown / untested"
      ? compatibilityLabel(summary)
      : "Game status";
  const personalLabel =
    summary?.personal.result && summary.personal.result !== "untested"
      ? `Your test: ${resultLabels[summary.personal.result]}`
      : "";
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) void load(false);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="game-status-trigger"
          aria-label={`Game status for ${name}${triggerLabel !== "Game status" ? `: ${triggerLabel}` : ""}${personalLabel ? `. ${personalLabel}` : ""}`}
        >
          <ClipboardCheck />
          <span>{triggerLabel}</span>
          {summary?.personal.result !== undefined &&
            summary.personal.result !== "untested" && (
              <span className="game-status-personal">
                Your test: {resultLabels[summary.personal.result]}
              </span>
            )}
        </Button>
      </DialogTrigger>
      <DialogContent className="game-status-dialog">
        <DialogHeader>
          <DialogTitle>{name} — Game status</DialogTitle>
          <DialogDescription>
            Setup checks and launch compatibility
          </DialogDescription>
        </DialogHeader>
        <div className="game-status-toolbar">
          <span className="body-copy">AppID {appId}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void load(true)}
          >
            <RefreshCw />
            Refresh status
          </Button>
        </div>
        {busy && <p role="status">Checking game status…</p>}
        {error && (
          <p role="alert" className="notice-box native-error">
            {error}
          </p>
        )}
        {data && (
          <div className="game-status-content">
            <section aria-label="Setup status">
              <h3>Setup</h3>
              <dl className="game-status-checks">
                <div>
                  <dt>Lua configuration</dt>
                  <dd>
                    {data.lua ? "Detected" : "Not detected"}
                    {!data.lua && (
                      <a href="#/dashboard" onClick={() => setOpen(false)}>
                        Add a game
                      </a>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Game installation</dt>
                  <dd>
                    {data.installation === "verified_local"
                      ? "Verified at last scan"
                      : data.installation === "absent"
                        ? "Missing at last scan"
                        : data.installation === "scan_failed"
                          ? "Scan failed"
                          : "Not verified"}
                    {data.installation !== "verified_local" && (
                      <a href="#/library" onClick={() => setOpen(false)}>
                        Scan libraries
                      </a>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Steam integration</dt>
                  <dd>
                    {data.runtime === null
                      ? "Not checked"
                      : data.runtime
                        ? "Detected"
                        : "Not detected"}
                    {data.runtime !== true && (
                      <a href="#/settings" onClick={() => setOpen(false)}>
                        Steam settings
                      </a>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Online fix</dt>
                  <dd>
                    {
                      {
                        verified: "Files verified",
                        changed: "Files changed or missing",
                        not_applied: "Not applied by SteamHub",
                        not_checked: "Not checked",
                      }[data.fix]
                    }
                    {["verified", "changed"].includes(data.fix) && (
                      <a href="#/online-fixes" onClick={() => setOpen(false)}>
                        Manage fix
                      </a>
                    )}
                  </dd>
                </div>
              </dl>
            </section>
            <section aria-label="Compatibility status">
              <h3>Compatibility</h3>
              <StatusBadge tone={restricted ? "amber" : "neutral"}>
                {label}
              </StatusBadge>
              {data.compatibility.requirements.map((requirement, index) => (
                <div
                  className="game-status-requirement"
                  key={`${requirement.kind}:${index}`}
                >
                  <p>{requirement.detail}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void openReference(requirement.source).catch((error) =>
                        setError(readable(error)),
                      );
                    }}
                  >
                    View source
                  </Button>
                </div>
              ))}
              {!data.compatibility.complete && (
                <p className="body-copy">
                  Steam’s requirements could not be fully checked. Compatibility
                  remains unknown.
                </p>
              )}
              {data.stale && data.compatibility.checkedAt && (
                <p className="body-copy">
                  Saved requirements are out of date. Refresh when connected.
                </p>
              )}
              {data.compatibility.checkedAt && (
                <p className="body-copy">
                  Steam requirements checked{" "}
                  {formatDate(data.compatibility.checkedAt)}
                </p>
              )}
              <p className="body-copy">
                File checks do not confirm that a game launches. Separate
                launchers may require their own account or entitlement.
              </p>
            </section>
            <section aria-label="Your launch result">
              <h3>Your launch result</h3>
              <FilterSelect
                label="Launch result"
                value={result}
                onChange={(value) => setResult(value as LaunchResult)}
                options={Object.entries(resultLabels).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
              <label>
                Launch note (optional)
                <Input
                  maxLength={500}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="What happened when you tried it?"
                />
              </label>
              {data.personal.updatedAt && (
                <p className="body-copy">
                  Your last report: {resultLabels[data.personal.result]} ·{" "}
                  {formatDate(data.personal.updatedAt)}
                </p>
              )}
              {data.reportOutdated && (
                <p className="notice-box">
                  The installation changed since your report. Test this version
                  again.
                </p>
              )}
              <Button
                disabled={
                  busy ||
                  (data.installation !== "verified_local" &&
                    result !== "untested")
                }
                onClick={() => void save()}
              >
                Save my result
              </Button>
              {notice && <p role="status">{notice}</p>}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
