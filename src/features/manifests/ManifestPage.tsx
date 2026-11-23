import { useState } from "react";
import { Database, Search } from "lucide-react";
import { demoManifests, manifestSample } from "@/api/demo/fixtures";
import { useDemo } from "@/app/demo-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  FilePreview,
  FilterSelect,
  InspectDialog,
  PageHeader,
  Panel,
  SimulateAction,
  StatusBadge,
} from "@/components/workspace/Primitives";

export function ManifestPage({ initialQuery }: { initialQuery: string }) {
  const { games } = useDemo();
  const [query, setQuery] = useState(initialQuery);
  const [kind, setKind] = useState("all");
  const [compare, setCompare] = useState(false);
  const matches = demoManifests.filter(
    (file) =>
      `${file.originalPath} ${games.find((game) => game.appId === file.appId)?.name}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (kind === "all" || file.kind === kind),
  );
  return (
    <>
      <PageHeader
        title="Manifest Manager"
        description="Browse sample records and explore the local inspection workflow."
        actions={
          <SimulateAction
            label="Preview manifest import"
            kind="Manifest import preview"
          />
        }
      />
      <div className="stats-grid three">
        <div className="stat-card">
          <span>Sample records</span>
          <strong>{demoManifests.length.toString().padStart(2, "0")}</strong>
          <small>Synthetic paths only</small>
        </div>
        <div className="stat-card">
          <span>Known sample format</span>
          <strong>ACF</strong>
          <small>Inspection preview</small>
        </div>
        <div className="stat-card">
          <span>Live files accessed</span>
          <strong>00</strong>
          <small>Read-only UI demonstration</small>
        </div>
      </div>
      <div className="catalog-toolbar">
        <div className="search-field">
          <Search />
          <Input
            aria-label="Filter manifests"
            placeholder="Filter by game, AppID, or path…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <FilterSelect
          label="Manifest format"
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: "All formats" },
            { value: "appmanifest_acf", label: "App manifest (ACF)" },
            { value: "unknown", label: "Unsupported format" },
          ]}
        />
        <Button
          variant="outline"
          onClick={() => setCompare(!compare)}
          aria-pressed={compare}
        >
          {compare ? "Hide comparison" : "Compare example versions"}
        </Button>
      </div>
      {compare && (
        <Panel
          title="Example version comparison"
          description="Illustrative diff only. No files were read or compared."
        >
          <div className="diff-viewer">
            <code className="diff-removed">− "buildid" "demo-build-1041"</code>
            <code className="diff-added">+ "buildid" "demo-build-1042"</code>
          </div>
        </Panel>
      )}
      {matches.length ? (
        <div className="table-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sample manifest</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Bytes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matches.map((file) => (
                <TableRow key={file.id}>
                  <TableCell>
                    <div className="table-game">
                      <Database className="size-5 text-primary" />
                      <span>
                        <strong>
                          {
                            games.find((game) => game.appId === file.appId)
                              ?.name
                          }
                        </strong>
                        <small>appmanifest_{file.appId}.acf · fixture</small>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>ACF</TableCell>
                  <TableCell>{file.bytes} B</TableCell>
                  <TableCell>
                    <StatusBadge tone="amber">
                      Not inspected locally
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    <InspectDialog
                      trigger={
                        <Button size="sm" variant="outline">
                          Inspect sample
                        </Button>
                      }
                      title="Manifest inspection preview"
                      description="All paths, hashes, and metadata below are synthetic."
                    >
                      <FilePreview
                        title={file.originalPath}
                        content={manifestSample
                          .replaceAll("999999991", file.appId ?? "")
                          .replaceAll(
                            "Aether Drift",
                            games.find((game) => game.appId === file.appId)
                              ?.name ?? "",
                          )}
                      />
                      <dl className="facts">
                        <div>
                          <dt>Example SHA-256</dt>
                          <dd className="break-all font-mono text-xs">
                            {file.sha256}
                          </dd>
                        </div>
                        <div>
                          <dt>Source</dt>
                          <dd>Fixture · no hash calculated</dd>
                        </div>
                      </dl>
                      <SimulateAction
                        label="Preview managed copy"
                        kind="Manifest copy preview"
                        appId={file.appId ?? undefined}
                      />
                    </InspectDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          title={
            kind === "unknown"
              ? "Unsupported formats stay opaque"
              : "No sample manifests match"
          }
          description={
            kind === "unknown"
              ? "Binary parsing is not connected. Unknown manifests will be displayed as opaque files in a future phase."
              : "Adjust the filter to browse the sample records."
          }
          action={
            <Button
              variant="outline"
              onClick={() => {
                setQuery("");
                setKind("all");
              }}
            >
              Reset filters
            </Button>
          }
        />
      )}
      <p className="notice-box">
        Manifest inspection, hashing, and managed copies are not connected to
        real files. Steam-managed records remain untouched.
      </p>
    </>
  );
}
