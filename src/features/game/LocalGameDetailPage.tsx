import { useEffect, useState } from "react";
import { ArrowLeft, FolderSearch } from "lucide-react";
import { getLocalGame } from "@/api/library";
import { useLocalLibrary } from "@/app/library-context";
import type { ApiResult, LocalGameDetail } from "@/contracts";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmptyState,
  LoadingSkeleton,
  Panel,
} from "@/components/workspace/Primitives";
import { InstallationStatus } from "@/features/library/LocalLibraryPage";
import { SteamButtons } from "@/features/workspace/NativeWorkspace";
import { GameStatusButton } from "./GameStatus";
import { GameArtwork } from "@/features/library/GameArtwork";

const sections = {
  overview: "Overview",
  installation: "Installation",
  lua: "Lua files",
  manifests: "Manifests",
  activity: "Activity",
};
export function LocalGameDetailPage({ appId }: { appId?: string }) {
  const { snapshot, scan, scanning } = useLocalLibrary();
  const [response, setResponse] = useState<{
    key: string;
    result: ApiResult<LocalGameDetail>;
  } | null>(null);
  useEffect(() => {
    let active = true;
    void getLocalGame(appId ?? "").then((result) => {
      if (active)
        setResponse({ key: `${appId}:${snapshot?.lastScanAt}`, result });
    });
    return () => {
      active = false;
    };
  }, [appId, snapshot?.lastScanAt]);
  const result =
    response?.key === `${appId}:${snapshot?.lastScanAt}`
      ? response.result
      : null;
  const game = result?.ok ? result.data : null;
  return (
    <>
      <a href="#/library" className="back-link">
        <ArrowLeft />
        Back to library
      </a>
      <h1 data-page-heading tabIndex={-1}>
        {game?.name ?? (game ? `AppID ${game.appId}` : "Game Details")}
      </h1>
      {!result ? (
        <LoadingSkeleton />
      ) : !result.ok ? (
        <EmptyState
          title="Local record unavailable"
          description={`${result.error.code}: ${result.error.message}`}
          action={
            <Button asChild variant="outline">
              <a href="#/library">Open local library</a>
            </Button>
          }
        />
      ) : (
        game && (
          <>
            <div className="local-detail-header">
              <GameArtwork appId={game.appId} thumbnail />
              <div>
                <div className="tag-row">
                  <InstallationStatus status={game.installStatus} />
                </div>
                <p>
                  AppID {game.appId} · {game.installationCount} installation
                  {game.installationCount === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <div className="quick-actions">
              <GameStatusButton
                appId={game.appId}
                name={game.name ?? `AppID ${game.appId}`}
              />
              {game.installStatus === "verified_local" && (
                <SteamButtons appId={game.appId} />
              )}
              <Button
                disabled={scanning}
                onClick={() => {
                  void scan();
                }}
              >
                <FolderSearch />
                {scanning ? "Scanning libraries…" : "Rescan local libraries"}
              </Button>
              <span className="source-attribution">
                Source: local appmanifest ACF · last seen{" "}
                {game.metadataSource.fetchedAt}
              </span>
            </div>
            <Tabs defaultValue="installation" className="detail-tabs">
              <TabsList aria-label="Local game detail sections">
                {Object.entries(sections).map(([tab, label]) => (
                  <TabsTrigger key={tab} value={tab}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="overview">
                <Panel
                  title="Local game information"
                  description="Only facts read from local Steam installation records are shown."
                >
                  <dl className="facts">
                    <div>
                      <dt>Display name</dt>
                      <dd>{game.name ?? "Not present in ACF"}</dd>
                    </div>
                    <div>
                      <dt>AppID</dt>
                      <dd>{game.appId}</dd>
                    </div>
                    <div>
                      <dt>Metadata source</dt>
                      <dd>local-steam · freshness unknown until rescan</dd>
                    </div>
                    <div>
                      <dt>Public description / release / artwork</dt>
                      <dd>
                        <a href={`#/game/${game.appId}?source=catalog`}>
                          View Steam catalog details
                        </a>
                      </dd>
                    </div>
                  </dl>
                </Panel>
              </TabsContent>
              <TabsContent value="installation">
                <Panel
                  title="Local installations"
                  description="Verification describes the last completed scan. Missing and failed records are retained."
                >
                  {game.installations.map((installation) => (
                    <article
                      className="local-installation"
                      key={installation.id}
                    >
                      <InstallationStatus status={installation.status} />
                      <dl className="facts">
                        <div>
                          <dt>Library root</dt>
                          <dd>{installation.libraryRoot}</dd>
                        </div>
                        <div>
                          <dt>
                            {installation.status === "verified_local"
                              ? "Verified directory"
                              : "Recorded directory"}
                          </dt>
                          <dd data-testid="local-install-path">
                            {installation.installPath}
                          </dd>
                        </div>
                        <div>
                          <dt>Build ID</dt>
                          <dd>{installation.buildId ?? "Not present"}</dd>
                        </div>
                        <div>
                          <dt>Source ACF</dt>
                          <dd>{installation.sourceAcfPath}</dd>
                        </div>
                        <div>
                          <dt>Last seen record</dt>
                          <dd>{installation.lastSeenAt}</dd>
                        </div>
                        <div>
                          <dt>Verification attempt</dt>
                          <dd>
                            {installation.checkedAt ??
                              "Not checked since v1 migration"}
                          </dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </Panel>
              </TabsContent>
              {(
                [
                  ["lua", "Lua configurations"],
                  ["manifests", "Managed manifests"],
                  ["activity", "Workspace activity"],
                ] as const
              ).map(([tab, title]) => (
                <TabsContent key={tab} value={tab}>
                  <EmptyState
                    title={title}
                    description="Open the connected workspace for this AppID. File associations are local metadata and do not grant Steam access."
                    action={
                      <Button asChild variant="outline">
                        <a
                          href={`#/${tab === "activity" ? "activity" : tab}?q=${game.appId}`}
                        >
                          Open {title.toLowerCase()}
                        </a>
                      </Button>
                    }
                  />
                </TabsContent>
              ))}
            </Tabs>
          </>
        )
      )}
    </>
  );
}
