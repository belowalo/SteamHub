import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getAppHealth } from "@/api/client";
import type { ApiResult, HealthResult } from "@/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/workspace/Primitives";

export function BackendHealth() {
  const [result, setResult] = useState<ApiResult<HealthResult> | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    void getAppHealth().then((next) => {
      if (active) {
        setResult(next);
        setChecking(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setChecking(true);
    const next = await getAppHealth();
    setResult(next);
    setChecking(false);
  }, []);

  const ready = result?.ok === true && result.data.databaseReady;
  const label = checking ? "Checking" : ready ? "Connected" : "Unavailable";

  return (
    <Panel title="Application health">
      <div className="inline-controls">
        <Badge
          variant={ready && !checking ? "default" : "secondary"}
          data-testid="health-status"
          role="status"
          aria-live="polite"
        >
          {label}
        </Badge>
        <Button
          variant="outline"
          onClick={() => {
            void refresh();
          }}
          disabled={checking}
        >
          <RefreshCw
            aria-hidden="true"
            className={checking ? "animate-spin" : ""}
          />
          Check again
        </Button>
      </div>
      {!ready && (
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="body-copy"
        >
          {checking
            ? "Checking desktop services…"
            : result?.ok
              ? "Database readiness could not be verified."
              : result?.error.message}
        </p>
      )}
      <dl className="health-facts">
        <div>
          <dt className="text-muted-foreground">Desktop bridge</dt>
          <dd className="mt-2 font-medium" data-testid="bridge-status">
            {checking ? "Checking…" : result?.ok ? "Connected" : "Unavailable"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">SQLite database</dt>
          <dd className="mt-2 font-medium" data-testid="database-status">
            {checking ? "Checking…" : ready ? "Ready" : "Unverified"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">App / API version</dt>
          <dd className="mt-2 font-mono text-xs">
            {result?.ok
              ? `${result.data.appVersion} / v${result.data.apiVersion}`
              : "—"}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}
