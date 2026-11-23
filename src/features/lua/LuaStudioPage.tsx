import { useState } from "react";
import { Braces, RotateCcw } from "lucide-react";
import { useDemo } from "@/app/demo-context";
import { luaSample } from "@/api/demo/fixtures";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmptyState,
  FilePreview,
  FilterSelect,
  PageHeader,
  Panel,
  SimulateAction,
  StatusBadge,
} from "@/components/workspace/Primitives";

export function LuaStudioPage({ appId }: { appId: string }) {
  const { games, jobs, notify } = useDemo();
  const [selected, setSelected] = useState(
    games.some((game) => game.appId === appId)
      ? appId
      : (games[0]?.appId ?? ""),
  );
  const game = games.find((item) => item.appId === selected);
  const sample = game
    ? luaSample
        .replaceAll("999999991", game.appId)
        .replaceAll("Aether Drift", game.name ?? "")
    : "";
  const [code, setCode] = useState(() => sample);
  const chooseGame = (id: string) => {
    setSelected(id);
    const next = games.find((item) => item.appId === id);
    setCode(
      next
        ? luaSample
            .replaceAll("999999991", next.appId)
            .replaceAll("Aether Drift", next.name ?? "")
        : "",
    );
  };
  return (
    <>
      <PageHeader
        title="Lua Studio"
        description="A focused space to explore document editing and preview workflows."
        actions={
          <StatusBadge tone="amber">
            Editor preview · no Lua execution
          </StatusBadge>
        }
      />
      <div className="catalog-toolbar">
        <FilterSelect
          label="Lua game"
          value={selected}
          onChange={chooseGame}
          options={[
            { value: "", label: "Select a sample game" },
            ...games.map((item) => ({
              value: item.appId,
              label: item.name ?? item.appId,
            })),
          ]}
        />
        <StatusBadge>Metadata template</StatusBadge>
        <span className="muted text-sm">
          Changes stay in this page until you leave.
        </span>
      </div>
      {!game ? (
        <EmptyState
          title="Select a game to begin"
          description="Choose a fictional game above to load its sample document."
        />
      ) : (
        <>
          <div className="editor-toolbar">
            <div>
              <Braces className="size-4" />
              <strong>
                {game.name?.toLowerCase().replaceAll(" ", "-")}.lua
              </strong>
              <StatusBadge tone="amber">Unsaved demo buffer</StatusBadge>
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                setCode(sample);
                notify("Sample template restored in the editor.");
              }}
            >
              <RotateCcw />
              Restore sample
            </Button>
          </div>
          <Tabs defaultValue="editor">
            <TabsList aria-label="Lua workspace sections">
              <TabsTrigger value="editor">Editor</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="history">Demo history</TabsTrigger>
            </TabsList>
            <TabsContent value="editor">
              <label className="sr-only" htmlFor="lua-editor">
                Lua document editor
              </label>
              <Textarea
                id="lua-editor"
                aria-describedby="lua-scope"
                className="code-editor"
                spellCheck={false}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <div className="editor-status">
                <span>{code.split("\n").length} lines</span>
                <span>UTF-8 · Lua text preview</span>
              </div>
            </TabsContent>
            <TabsContent value="preview">
              {code.trim() ? (
                <FilePreview
                  title="Current editor buffer — not executed"
                  content={code}
                />
              ) : (
                <EmptyState description="The editor is empty. Add text or restore the sample template." />
              )}
            </TabsContent>
            <TabsContent value="history">
              <Panel title="Document activity">
                {jobs.filter(
                  (job) => job.appId === selected && job.kind.startsWith("Lua"),
                ).length ? (
                  jobs
                    .filter(
                      (job) =>
                        job.appId === selected && job.kind.startsWith("Lua"),
                    )
                    .map((job) => (
                      <div className="list-row" key={job.id}>
                        <div>
                          <strong>{job.kind}</strong>
                          <small>Simulation only</small>
                        </div>
                        <StatusBadge>{job.status}</StatusBadge>
                      </div>
                    ))
                ) : (
                  <EmptyState description="No simulated document actions yet." />
                )}
              </Panel>
            </TabsContent>
          </Tabs>
          <div className="quick-actions">
            <SimulateAction
              label="Preview validation"
              kind="Lua validation preview"
              appId={selected}
            />
            <SimulateAction
              label="Preview export"
              kind="Lua export preview"
              appId={selected}
            />
            <SimulateAction
              label="Preview import"
              kind="Lua import preview"
              appId={selected}
            />
          </div>
          <p className="notice-box" id="lua-scope">
            The editor changes text in memory only. Validation, import, and
            export are simulated workflows; no real parser, file picker, file
            write, or Lua runtime is connected.
          </p>
        </>
      )}
    </>
  );
}
