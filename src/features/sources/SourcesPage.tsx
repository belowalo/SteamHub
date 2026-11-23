import { useState } from "react";
import { FlaskConical, Search, Waypoints } from "lucide-react";
import { useDemo } from "@/app/demo-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  EmptyState,
  InspectDialog,
  PageHeader,
  Panel,
  SimulateAction,
  StatusBadge,
} from "@/components/workspace/Primitives";

export function SourcesPage() {
  const { providers, toggleProvider } = useDemo();
  const [query, setQuery] = useState("");
  const matches = providers.filter((provider) =>
    provider.displayName.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <PageHeader
        title="Source Providers"
        description="Know where every piece of information comes from."
        actions={
          <SimulateAction
            label="Preview health check"
            kind="Provider health preview"
          />
        }
      />
      <div className="notice-box">
        <FlaskConical />
        All providers are fixtures. Enabling a source affects only this demo
        session; no network connections are made.
      </div>
      <div className="catalog-toolbar">
        <div className="search-field">
          <Search />
          <Input
            aria-label="Filter source providers"
            placeholder="Find a sample source…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <StatusBadge tone="blue">
          {providers.filter((provider) => provider.enabled).length} demo sources
          enabled
        </StatusBadge>
      </div>
      {matches.length ? (
        <div className="provider-list">
          {matches.map((provider) => (
            <Panel key={provider.id}>
              <div className="provider-header">
                <div className="provider-icon">
                  <Waypoints />
                </div>
                <div>
                  <h2>{provider.displayName}</h2>
                  <p>Offline fixture · {provider.id}</p>
                </div>
                <Switch
                  aria-label={`Enable ${provider.displayName}`}
                  checked={provider.enabled}
                  onCheckedChange={() => toggleProvider(provider.id)}
                />
              </div>
              <div className="tag-row">
                <StatusBadge
                  tone={provider.health === "healthy" ? "green" : "amber"}
                >
                  Demo {provider.health}
                </StatusBadge>
                {provider.capabilities.map((capability) => (
                  <StatusBadge key={capability}>
                    {capability.replaceAll("_", " ")}
                  </StatusBadge>
                ))}
              </div>
              <div className="provider-footer">
                <span>Documentation / permissions: not supplied</span>
                <InspectDialog
                  trigger={
                    <Button size="sm" variant="outline">
                      Source details
                    </Button>
                  }
                  title={provider.displayName}
                  description="Fixture provider details. These are not verified API capabilities."
                >
                  <dl className="facts">
                    <div>
                      <dt>Type</dt>
                      <dd>Offline fixture</dd>
                    </div>
                    <div>
                      <dt>Terms / API permission</dt>
                      <dd>Not established</dd>
                    </div>
                    <div>
                      <dt>Network access</dt>
                      <dd>None</dd>
                    </div>
                    <div>
                      <dt>Trust status</dt>
                      <dd>Sample only</dd>
                    </div>
                  </dl>
                  <p className="body-copy">
                    A future provider must have an explicit source, permission,
                    timeout, and provenance policy before it can be connected.
                  </p>
                </InspectDialog>
              </div>
            </Panel>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No sample sources match"
          description="Try a different provider name."
          action={
            <Button variant="outline" onClick={() => setQuery("")}>
              Clear filter
            </Button>
          }
        />
      )}
    </>
  );
}
