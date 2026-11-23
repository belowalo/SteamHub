import { useState } from "react";
import { Braces, Database, FileJson, Search, ShieldCheck } from "lucide-react";
import { useDemo } from "@/app/demo-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  PageHeader,
  Panel,
  SimulateAction,
  StatusBadge,
} from "@/components/workspace/Primitives";
import { BackendHealth } from "@/features/dashboard/BackendHealth";

export function ToolsPage() {
  const { notify } = useDemo();
  const [query, setQuery] = useState("");
  const [json, setJson] = useState('{"workspace":"demo","network":false}');
  const [error, setError] = useState("");
  const tools = [
    {
      title: "Lua inspection",
      description: "Preview the static document workflow.",
      kind: "Lua inspection preview",
      icon: Braces,
    },
    {
      title: "Manifest inspection",
      description: "Explore the sample metadata workflow.",
      kind: "Manifest inspection preview",
      icon: Database,
    },
    {
      title: "Integrity check",
      description: "Preview hash verification feedback.",
      kind: "Integrity check preview",
      icon: ShieldCheck,
    },
  ].filter((tool) =>
    tool.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <PageHeader
        title="Tools"
        description="Small utilities and diagnostics for your game workspace."
        actions={<StatusBadge>Local interface tools</StatusBadge>}
      />
      <div className="catalog-toolbar">
        <div className="search-field">
          <Search />
          <Input
            aria-label="Filter tools"
            placeholder="Find a workflow preview…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      {tools.length ? (
        <div className="tool-grid">
          {tools.map(({ title, description, kind, icon: Icon }) => (
            <Panel key={title}>
              <Icon className="tool-icon" />
              <h2>{title}</h2>
              <p className="body-copy">{description}</p>
              <StatusBadge tone="amber">Simulation</StatusBadge>
              <SimulateAction label="Open preview" kind={kind} />
            </Panel>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No workflow previews match"
          description="Try another tool name."
          action={
            <Button variant="outline" onClick={() => setQuery("")}>
              Clear filter
            </Button>
          }
        />
      )}
      <Panel
        title="JSON scratchpad"
        description="A working text formatter in this interface. No files are read or saved."
        action={<FileJson className="size-5 text-primary" />}
      >
        <label htmlFor="json-scratchpad" className="field-label">
          JSON text
        </label>
        <Textarea
          id="json-scratchpad"
          className="code-editor compact"
          value={json}
          onChange={(event) => {
            setJson(event.target.value);
            setError("");
          }}
          aria-invalid={!!error}
          aria-describedby={error ? "json-error" : undefined}
        />
        {error && (
          <p role="alert" id="json-error" className="form-error">
            {error}
          </p>
        )}
        <Button
          variant="outline"
          onClick={() => {
            try {
              setJson(JSON.stringify(JSON.parse(json), null, 2));
              setError("");
              notify("JSON formatted in the scratchpad. Nothing was saved.");
            } catch {
              setError(
                "This text is not valid JSON. Check quotes, commas, and brackets.",
              );
            }
          }}
        >
          Format JSON
        </Button>
      </Panel>
      <div className="section-heading">
        <div>
          <h2>Desktop diagnostics</h2>
          <p>Live Rust and database connection — not simulated</p>
        </div>
        <StatusBadge tone="green">Real backend</StatusBadge>
      </div>
      <BackendHealth />
    </>
  );
}
