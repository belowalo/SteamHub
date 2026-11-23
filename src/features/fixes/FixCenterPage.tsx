import { useState } from "react";
import { ShieldCheck, Search, LockKeyhole } from "lucide-react";
import { demoFixes } from "@/api/demo/fixtures";
import { useDemo } from "@/app/demo-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  FilterSelect,
  InspectDialog,
  PageHeader,
  Panel,
  SimulateAction,
  StatusBadge,
} from "@/components/workspace/Primitives";

export function FixCenterPage({ initialQuery }: { initialQuery: string }) {
  const { games } = useDemo();
  const [query, setQuery] = useState(initialQuery);
  const [approval, setApproval] = useState("all");
  const matches = demoFixes.filter(
    (fix) =>
      `${fix.title} ${fix.appId} ${games.find((game) => game.appId === fix.appId)?.name}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (approval === "all" || fix.approval === approval),
  );
  return (
    <>
      <PageHeader
        title="Fix Center"
        description="Compatibility information with clear sources and careful boundaries."
        actions={
          <SimulateAction
            label="Preview compatibility check"
            kind="Compatibility check preview"
          />
        }
      />
      <div className="trust-banner">
        <ShieldCheck />
        <div>
          <h2>Review first. Stay in control.</h2>
          <p>
            These are fictional references. Authorization, signatures, and
            compatibility are unverified. Installation is unavailable.
          </p>
        </div>
        <StatusBadge tone="amber">Reference only</StatusBadge>
      </div>
      <div className="catalog-toolbar">
        <div className="search-field">
          <Search />
          <Input
            aria-label="Search fix references"
            placeholder="Search sample references or AppID…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <FilterSelect
          label="Fix approval"
          value={approval}
          onChange={setApproval}
          options={[
            { value: "all", label: "All references" },
            { value: "manual_reference_only", label: "Manual reference" },
            { value: "unverified", label: "Unverified" },
          ]}
        />
      </div>
      {matches.length ? (
        <div className="reference-grid">
          {matches.map((fix) => (
            <Panel key={fix.id}>
              <div className="fix-card-icon">
                <ShieldCheck />
              </div>
              <div className="tag-row">
                <StatusBadge tone="amber">
                  {fix.approval === "manual_reference_only"
                    ? "Manual reference only"
                    : "Unverified source"}
                </StatusBadge>
              </div>
              <h2>{fix.title}</h2>
              <p className="body-copy">
                {games.find((game) => game.appId === fix.appId)?.name} · sample
                v{fix.version}
              </p>
              <dl className="facts">
                <div>
                  <dt>Compatibility</dt>
                  <dd>Unknown</dd>
                </div>
                <div>
                  <dt>Provider</dt>
                  <dd>Synthetic reference</dd>
                </div>
                <div>
                  <dt>Automatic application</dt>
                  <dd>Unavailable</dd>
                </div>
              </dl>
              <InspectDialog
                trigger={<Button variant="outline">Review reference</Button>}
                title="Fix review plan"
                description="Fictional plan preview — no download or installation is permitted."
              >
                <div className="notice-box">
                  <LockKeyhole />
                  Application blocked: source rights, publisher identity, and
                  target build have not been verified.
                </div>
                <dl className="facts">
                  <div>
                    <dt>Expected writes</dt>
                    <dd>None</dd>
                  </div>
                  <div>
                    <dt>Backup plan</dt>
                    <dd>Not available</dd>
                  </div>
                  <div>
                    <dt>Signature</dt>
                    <dd>Unverified</dd>
                  </div>
                  <div>
                    <dt>Package origin</dt>
                    <dd>No URL supplied</dd>
                  </div>
                </dl>
                <SimulateAction
                  label="Simulate compatibility review"
                  kind="Compatibility review preview"
                  appId={fix.appId}
                />
              </InspectDialog>
            </Panel>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No supported fixes found"
          description="No sample references match. This does not mean no real-world fixes exist; real provider availability is unknown."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setQuery("");
                setApproval("all");
              }}
            >
              Reset filters
            </Button>
          }
        />
      )}
    </>
  );
}
