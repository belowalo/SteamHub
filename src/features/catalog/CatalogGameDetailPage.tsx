import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Gamepad2,
  HardDrive,
  Tag,
} from "lucide-react";
import { getCatalogGame } from "@/api/catalog";
import type { ApiResult, CatalogGameDetail } from "@/contracts";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  LoadingSkeleton,
  PageHeader,
  Panel,
  StatusBadge,
} from "@/components/workspace/Primitives";
import { CatalogArtwork } from "./CatalogSearchPage";
import { ReferenceButton } from "@/features/workspace/NativeWorkspace";
import { GameStatusButton } from "@/features/game/GameStatus";
import { StoreOffer } from "@/features/store/StoreOffer";

export function CatalogGameDetailPage({ appId }: { appId: string }) {
  const [loading, setLoading] = useState(true);
  const [response, setResponse] = useState<ApiResult<CatalogGameDetail> | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    void getCatalogGame(appId).then((res) => {
      if (active) {
        setResponse(res);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [appId]);

  if (loading) {
    return (
      <>
        <PageHeader
          title="Game Details"
          description="Loading catalog information…"
        />
        <LoadingSkeleton />
      </>
    );
  }

  if (!response) {
    return (
      <EmptyState
        title="Something went wrong"
        description="No response received from catalog backend."
        action={
          <Button asChild variant="outline">
            <a href="#/search">Back to search</a>
          </Button>
        }
      />
    );
  }

  if (!response.ok) {
    const isNotFound = response.error.code === "NOT_FOUND";
    const isUnavailable = response.error.code === "PROVIDER_UNAVAILABLE";
    return (
      <>
        <PageHeader
          title={isNotFound ? "Game not found" : "Catalog unavailable"}
          description={
            isNotFound
              ? `AppID ${appId} was not found in the Steam store catalog.`
              : isUnavailable
                ? "Steam storefront is currently unreachable. Try again when connectivity is restored."
                : response.error.message
          }
          actions={
            <Button asChild variant="outline">
              <a href="#/search">Back to search</a>
            </Button>
          }
        />
        <div className="notice-box">
          <AlertTriangle aria-hidden="true" />
          <span>
            {isNotFound
              ? `No game exists in the Steam catalog with AppID ${appId}.`
              : isUnavailable
                ? "Provider unavailable. No data can be shown without fabricating content."
                : `Error ${response.error.code}: ${response.error.message}`}
          </span>
        </div>
      </>
    );
  }

  const game = response.data;
  const name = game.name ?? `AppID ${appId}`;
  const steamUrl = `https://store.steampowered.com/app/${appId}`;

  return (
    <>
      <PageHeader
        title={name}
        description={`AppID ${appId} · Steam catalog entry`}
        actions={
          <>
            <GameStatusButton appId={appId} name={name} />
            <Button asChild variant="outline">
              <a href="#/library">Back to library</a>
            </Button>
            <ReferenceButton url={steamUrl}>
              <ExternalLink />
              View on Steam
            </ReferenceButton>
          </>
        }
      />

      <StoreOffer appId={appId} />
      {/* Installation status notice — truthful only */}
      {game.installed ? (
        <div className="notice-box installed-notice">
          <HardDrive aria-hidden="true" />
          <strong>Verified installed</strong>
          <span>
            This game was detected on your system during the last library scan.
          </span>
          <StatusBadge tone="green">Verified installed</StatusBadge>
        </div>
      ) : (
        <div className="notice-box">
          <Gamepad2 aria-hidden="true" />
          <span>
            This title is not currently verified as installed on this machine.
            Installation status is determined only by local library scans.
          </span>
          <StatusBadge tone="neutral">Not installed</StatusBadge>
        </div>
      )}

      <div className="game-detail-layout">
        {/* Artwork column */}
        <aside className="game-detail-art">
          <CatalogArtwork
            src={game.headerImage ?? game.artworkUrl}
            alt={name}
            className="detail-header-img"
          />
          {game.capsuleImage && game.capsuleImage !== game.headerImage && (
            <CatalogArtwork
              src={game.capsuleImage}
              alt={`${name} capsule`}
              className="detail-capsule-img"
            />
          )}
        </aside>

        {/* Info column */}
        <div className="game-detail-info">
          {/* Source attribution */}
          {game.metadataSource && (
            <Panel>
              <h2>Source</h2>
              <dl className="facts">
                <div>
                  <dt>Provider</dt>
                  <dd>
                    <StatusBadge tone="blue">
                      {game.metadataSource.providerId}
                    </StatusBadge>
                  </dd>
                </div>
                <div>
                  <dt>Freshness</dt>
                  <dd>
                    <StatusBadge
                      tone={
                        game.metadataSource.freshness === "fresh"
                          ? "green"
                          : "amber"
                      }
                    >
                      {game.metadataSource.freshness}
                    </StatusBadge>
                  </dd>
                </div>
                <div>
                  <dt>Fetched at</dt>
                  <dd>{game.metadataSource.fetchedAt}</dd>
                </div>
                {game.metadataSource.documentationUrl && (
                  <div>
                    <dt>Documentation</dt>
                    <dd>
                      <ReferenceButton
                        url={game.metadataSource.documentationUrl}
                      >
                        Provider docs
                        <ExternalLink className="inline-icon" />
                      </ReferenceButton>
                    </dd>
                  </div>
                )}
              </dl>
            </Panel>
          )}

          {/* Core facts */}
          <Panel>
            <h2>Catalog information</h2>
            <dl className="facts">
              <div>
                <dt>AppID</dt>
                <dd>{appId}</dd>
              </div>
              {game.releaseDate && (
                <div>
                  <dt>Release date</dt>
                  <dd>{game.releaseDate}</dd>
                </div>
              )}
              {game.itemType && (
                <div>
                  <dt>Type</dt>
                  <dd>{game.itemType}</dd>
                </div>
              )}
              {game.website && (
                <div>
                  <dt>Website</dt>
                  <dd>{game.website}</dd>
                </div>
              )}
            </dl>
          </Panel>

          {/* Genres */}
          {game.genres.length > 0 && (
            <Panel>
              <h2>
                <Tag aria-hidden="true" />
                Genres
              </h2>
              <div className="tag-row">
                {game.genres.map((genre) => (
                  <StatusBadge key={genre}>{genre}</StatusBadge>
                ))}
              </div>
            </Panel>
          )}

          {/* Descriptions */}
          {(game.shortDescription || game.description) && (
            <Panel>
              <h2>Description</h2>
              {game.shortDescription && (
                <p className="body-copy short-desc">{game.shortDescription}</p>
              )}
              {game.description && (
                <p className="body-copy long-desc">
                  {game.description.replace(/<[^>]*>/g, " ")}
                </p>
              )}
            </Panel>
          )}

          {/* Local installations (only when actually installed) */}
          {game.localInstallationDerived &&
            game.localInstallations.length > 0 && (
              <Panel>
                <h2>
                  <HardDrive aria-hidden="true" />
                  Local installations
                </h2>
                <div className="installation-list">
                  {game.localInstallations.map((inst) => (
                    <div key={inst.id} className="installation-item">
                      <dl className="facts">
                        <div>
                          <dt>Path</dt>
                          <dd>
                            <code>{inst.installPath}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Library root</dt>
                          <dd>
                            <code>{inst.libraryRoot}</code>
                          </dd>
                        </div>
                        {inst.buildId && (
                          <div>
                            <dt>Build ID</dt>
                            <dd>{inst.buildId}</dd>
                          </div>
                        )}
                        <div>
                          <dt>Status</dt>
                          <dd>
                            <StatusBadge
                              tone={
                                inst.status === "verified_local"
                                  ? "green"
                                  : "amber"
                              }
                            >
                              {inst.status.replaceAll("_", " ")}
                            </StatusBadge>
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

          {/* Steam link footer */}
          <div className="detail-footer">
            <ReferenceButton url={steamUrl}>
              <ExternalLink />
              View AppID {appId} on Steam Store
            </ReferenceButton>
          </div>
        </div>
      </div>
    </>
  );
}
