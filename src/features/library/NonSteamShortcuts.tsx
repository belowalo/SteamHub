import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel, StatusBadge } from "@/components/workspace/Primitives";
import { getShortcuts, type shortcutsSchema } from "@/api/workspace";
import type { z } from "zod";

export function NonSteamShortcuts() {
  const [result, setResult] = useState<z.infer<typeof shortcutsSchema> | null>(
    null,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function scan() {
    setLoading(true);
    setError("");
    try {
      setResult(await getShortcuts());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <Panel
      title="Non-Steam shortcuts"
      description="Separate user-added shortcuts from Steam installation records. Shortcut targets are displayed as text and never executed by this scanner."
    >
      <p className="body-copy">Inspect shortcuts added outside Steam.</p>
      <Button
        size="sm"
        variant="outline"
        disabled={loading}
        onClick={() => {
          void scan();
        }}
      >
        {loading ? "Reading…" : "Read local shortcuts"}
      </Button>

      {error && <p role="alert">{error}</p>}
      {result ? (
        <>
          <p className="body-copy">
            {result.shortcuts.length} shortcuts found.
          </p>
          {result.shortcuts.map((s, i) => (
            <details
              key={`${s.sourceFile}:${i}`}
              className="local-installation"
            >
              <summary>
                {s.name} <StatusBadge>Non-Steam shortcut</StatusBadge>
              </summary>
              <dl className="facts">
                <div>
                  <dt>Target</dt>
                  <dd>{s.executable}</dd>
                </div>
                <div>
                  <dt>Start directory</dt>
                  <dd>{s.startDirectory}</dd>
                </div>
                <div>
                  <dt>Local user ID</dt>
                  <dd>{s.userId}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{s.sourceFile}</dd>
                </div>
              </dl>
            </details>
          ))}
          {result.diagnostics.map((d) => (
            <p key={d} className="body-copy">
              {d}
            </p>
          ))}
        </>
      ) : null}
    </Panel>
  );
}
