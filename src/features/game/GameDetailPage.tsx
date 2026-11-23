import {
  ArrowLeft,
  ArrowRight,
  Braces,
  Database,
  FolderOpen,
} from "lucide-react";
import { useDemo } from "@/app/demo-context";
import {
  demoLua,
  demoManifests,
  luaSample,
  manifestSample,
} from "@/api/demo/fixtures";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GameArt } from "@/components/workspace/Games";
import {
  EmptyState,
  FilePreview,
  InspectDialog,
  Panel,
  SimulateAction,
  SourceAttribution,
  StatusBadge,
} from "@/components/workspace/Primitives";

export function GameDetailPage({ appId }: { appId?: string }) {
  const { games, jobs } = useDemo();
  const game = games.find((item) => item.appId === appId);
  if (!game)
    return (
      <>
        <h1 data-page-heading tabIndex={-1}>
          Game Details
        </h1>
        <EmptyState
          title="Sample game not found"
          description="This game is not in the fictional catalog. Choose a sample from the library."
          action={
            <Button asChild>
              <a href="#/library">Open library</a>
            </Button>
          }
        />
      </>
    );
  const files = demoLua.filter((file) => file.appId === appId);
  const manifests = demoManifests.filter((file) => file.appId === appId);
  const history = jobs.filter((job) => job.appId === appId);
  return (
    <>
      <a href="#/library" className="back-link">
        <ArrowLeft />
        Back to library
      </a>
      <section className="game-detail-hero">
        <GameArt game={game} hero />
        <div>
          <div className="inline-controls">
            <StatusBadge tone="amber">Fictional game</StatusBadge>
            <StatusBadge tone={game.demoInstalled ? "green" : "neutral"}>
              {game.demoInstalled ? "Demo installed" : "Demo not installed"}
            </StatusBadge>
          </div>
          <h1 data-page-heading tabIndex={-1}>
            {game.name}
          </h1>
          <p>{game.tagline}</p>
          <span className="detail-meta">
            {game.genre} <span>·</span> AppID {game.appId}
          </span>
        </div>
      </section>
      <div className="quick-actions">
        <SimulateAction
          label="Preview refresh"
          kind="Metadata preview"
          appId={appId}
          variant="default"
        />
        <Button variant="outline" asChild>
          <a href={`#/lua?q=${appId}`}>
            <Braces />
            Lua files
          </a>
        </Button>
        <Button variant="outline" asChild>
          <a href={`#/manifests?q=${appId}`}>
            <Database />
            Manifests
          </a>
        </Button>
        <Button variant="outline" asChild>
          <a href={`#/activity?q=${appId}`}>
            Activity
            <ArrowRight />
          </a>
        </Button>
        <SourceAttribution />
      </div>
      <Tabs defaultValue="overview" className="detail-tabs">
        <TabsList aria-label="Game detail sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="installation">Installation</TabsTrigger>
          <TabsTrigger value="lua">Lua files</TabsTrigger>
          <TabsTrigger value="manifests">Manifests</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="two-column">
            <Panel title="About this game">
              <p className="body-copy">{game.description}</p>
              <div className="tag-row">
                <StatusBadge>{game.genre}</StatusBadge>
                <StatusBadge>Single-player sample</StatusBadge>
                <StatusBadge>Windows example</StatusBadge>
              </div>
              <div className="notice-box">
                All metadata and artwork are synthetic UI fixtures. This is not
                a real ownership or installation record.
              </div>
            </Panel>
            <Panel title="Game information">
              <dl className="facts">
                <div>
                  <dt>Sample release</dt>
                  <dd>{game.releaseDate}</dd>
                </div>
                <div>
                  <dt>Sample playtime</dt>
                  <dd>{game.hours} hours</dd>
                </div>
                <div>
                  <dt>Sample size</dt>
                  <dd>{game.size}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>Offline fixture catalog</dd>
                </div>
                <div>
                  <dt>Freshness</dt>
                  <dd>Unknown</dd>
                </div>
              </dl>
            </Panel>
          </div>
          <Panel
            title="Everything for this game"
            description="Continue without leaving your workspace"
          >
            <div className="resource-grid">
              {[
                {
                  title: "Lua documents",
                  value: files.length,
                  href: `#/lua?q=${appId}`,
                  icon: Braces,
                },
                {
                  title: "Local manifests",
                  value: manifests.length,
                  href: `#/manifests?q=${appId}`,
                  icon: Database,
                },
              ].map(({ title, value, href, icon: Icon }) => (
                <a href={href} key={title}>
                  <Icon />
                  <strong>{value}</strong>
                  <span>{title} · demo</span>
                  <ArrowRight />
                </a>
              ))}
            </div>
          </Panel>
        </TabsContent>
        <TabsContent value="installation">
          <Panel
            title="Installation example"
            description="Presentation only. Local Steam discovery is not implemented."
          >
            <div className="installation-card">
              <FolderOpen />
              <div>
                <h3>
                  {game.demoInstalled
                    ? "Sample installation record"
                    : "No sample installation"}
                </h3>
                <p>
                  {game.demoInstalled
                    ? `D:\\DemoLibrary\\steamapps\\common\\${game.name}`
                    : "This fictional game has no installed example."}
                </p>
                <StatusBadge tone="amber">Not verified locally</StatusBadge>
              </div>
            </div>
            {game.demoInstalled && (
              <InspectDialog
                trigger={
                  <Button variant="outline">Preview folder details</Button>
                }
                title="Sample folder"
                description="This example path is never opened or inspected."
              >
                <FilePreview
                  title="Fictional installation"
                  content={`D:\\DemoLibrary\\steamapps\\common\\${game.name}\nBuild: demo-build-1042\nSource: synthetic fixture\nLocal verification: not performed`}
                />
              </InspectDialog>
            )}
          </Panel>
        </TabsContent>
        <TabsContent value="lua">
          <Panel
            title="Lua files"
            description="Synthetic documents; no parsing or execution."
          >
            {files.length ? (
              <>
                <FilePreview
                  title={files[0].managedPath}
                  content={luaSample
                    .replaceAll("999999991", game.appId)
                    .replaceAll("Aether Drift", game.name ?? "")}
                />
                <Button asChild variant="outline">
                  <a href={`#/lua?q=${appId}`}>
                    Open in Lua Studio
                    <ArrowRight />
                  </a>
                </Button>
              </>
            ) : (
              <EmptyState
                description="No sample Lua files for this game."
                action={
                  <Button asChild variant="outline">
                    <a href={`#/lua?q=${appId}`}>Open Lua Studio</a>
                  </Button>
                }
              />
            )}
          </Panel>
        </TabsContent>
        <TabsContent value="manifests">
          <Panel
            title="Local manifests"
            description="These records describe fictional paths, not discovered files."
          >
            {manifests.length ? (
              <>
                <FilePreview
                  title={manifests[0].originalPath}
                  content={manifestSample
                    .replaceAll("999999991", game.appId)
                    .replaceAll("Aether Drift", game.name ?? "")}
                />
                <Button asChild variant="outline">
                  <a href={`#/manifests?q=${appId}`}>
                    Inspect sample records
                    <ArrowRight />
                  </a>
                </Button>
              </>
            ) : (
              <EmptyState description="No sample manifests for this game." />
            )}
          </Panel>
        </TabsContent>
        <TabsContent value="activity">
          <Panel
            title="Game activity"
            description="Temporary demo jobs for this game only."
          >
            {history.length ? (
              history.map((job) => (
                <div key={job.id} className="list-row">
                  <div>
                    <strong>{job.kind}</strong>
                    <small>Simulation · {job.progressPercent}%</small>
                  </div>
                  <StatusBadge>{job.status}</StatusBadge>
                </div>
              ))
            ) : (
              <EmptyState description="No demo activity for this game yet." />
            )}
            <SimulateAction
              label="Simulate metadata refresh"
              kind="Metadata preview"
              appId={appId}
            />
          </Panel>
        </TabsContent>
      </Tabs>
    </>
  );
}
