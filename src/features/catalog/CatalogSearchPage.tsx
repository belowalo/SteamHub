import { useEffect, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Database,
  Gamepad2,
  Grid2X2,
  List,
  Search,
} from "lucide-react";
import { searchCatalog } from "@/api/catalog";
import { gameHref } from "@/app/navigation";
import type {
  ApiResult,
  CatalogGameSummary,
  CatalogSearchResult,
} from "@/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  LoadingSkeleton,
  PageHeader,
  StatusBadge,
} from "@/components/workspace/Primitives";

export function CatalogArtwork({
  src,
  alt,
  className = "",
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  const [error, setError] = useState(false);
  if (!src || error) {
    return (
      <div
        className={`catalog-artwork-placeholder ${className}`}
        aria-hidden="true"
      >
        <Gamepad2 />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={`catalog-artwork-img ${className}`}
      onError={() => setError(true)}
    />
  );
}

export function CatalogSearchPage({
  initialQuery = "",
}: {
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [view, setView] = useState<"grid" | "table">("grid");
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${submittedQuery}:${attempt}`;
  const [completed, setCompleted] = useState<{
    key: string;
    result: ApiResult<CatalogSearchResult>;
  } | null>(null);
  const response = completed?.key === requestKey ? completed.result : null;
  const loading = !!submittedQuery.trim() && !response;

  useEffect(() => {
    if (!submittedQuery.trim()) return;

    let active = true;

    void searchCatalog({ query: submittedQuery.trim(), limit: 30 }).then(
      (res) => {
        if (active) {
          setCompleted({ key: requestKey, result: res });
        }
      },
    );

    return () => {
      active = false;
    };
  }, [submittedQuery, requestKey]);

  // Debounced typing: trigger auto search after 400ms idle
  useEffect(() => {
    const handler = setTimeout(() => {
      if (query !== submittedQuery) {
        setSubmittedQuery(query);
      }
    }, 400);
    return () => clearTimeout(handler);
  }, [query, submittedQuery]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmittedQuery(query);
    setAttempt((n) => n + 1);
  }

  const reset = () => {
    setQuery("");
    setSubmittedQuery("");
  };

  const data = response?.ok ? response.data : null;
  const games: CatalogGameSummary[] = data?.games ?? [];

  return (
    <>
      <PageHeader
        title="Game Search"
        description="Search the real Steam store catalog by game title or numeric AppID."
      />

      <div className="search-intro">
        <Search aria-hidden="true" />
        <div>
          <h2>Search the Steam store catalog.</h2>
          <p>
            Type a game title (e.g. “Portal 2”, “Half-Life”) or numeric AppID
            (e.g. 620). Search never fabricates game ownership or installation
            status.
          </p>
        </div>
        <StatusBadge tone="blue">Real Steam Provider</StatusBadge>
      </div>

      <form className="catalog-toolbar" onSubmit={onSubmit}>
        <div className="search-field">
          <Search aria-hidden="true" />
          <Input
            aria-label="Search Steam catalog"
            placeholder="Search games or AppID (e.g. Portal 2, 620)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button type="submit" variant="default" disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </Button>
        {query && (
          <Button type="button" variant="outline" onClick={reset}>
            Clear
          </Button>
        )}
        <div className="view-toggle">
          <Button
            size="sm"
            variant={view === "grid" ? "secondary" : "ghost"}
            onClick={() => setView("grid")}
            aria-label="Grid view"
          >
            <Grid2X2 />
          </Button>
          <Button
            size="sm"
            variant={view === "table" ? "secondary" : "ghost"}
            onClick={() => setView("table")}
            aria-label="Table view"
          >
            <List />
          </Button>
        </div>
      </form>

      {/* Origin & Status notices */}
      {data && data.origin === "cache" && (
        <div className="notice-box">
          <Database aria-hidden="true" />
          <div>
            <strong>Offline cached catalog results.</strong>{" "}
            <span>
              {data.providerStatus === "offline"
                ? "Steam storefront is unreachable; showing saved results from local database cache."
                : data.providerStatus === "rate_limited"
                  ? "Storefront rate limit encountered; showing cached records."
                  : "Results retrieved from local catalog index."}
            </span>
          </div>
          <StatusBadge tone="amber">Cached / Stale</StatusBadge>
        </div>
      )}

      {data &&
        data.providerStatus === "rate_limited" &&
        data.origin === "live" && (
          <div className="notice-box rate-limited">
            <AlertCircle aria-hidden="true" />
            <div>
              <strong>Rate limit warning.</strong> Too many requests to Steam
              storefront.
            </div>
            <StatusBadge tone="amber">Rate limited</StatusBadge>
          </div>
        )}

      {loading ? (
        <LoadingSkeleton />
      ) : response && !response.ok ? (
        <EmptyState
          title="Search could not complete"
          description={`${response.error.code}: ${response.error.message}`}
          action={
            <Button
              variant="outline"
              onClick={() => {
                setSubmittedQuery(query);
                setAttempt((n) => n + 1);
              }}
            >
              Retry search
            </Button>
          }
        />
      ) : submittedQuery.trim() && games.length === 0 ? (
        <EmptyState
          title="No games found"
          description={`No Steam catalog matches found for “${submittedQuery}”.`}
          action={
            <Button variant="outline" onClick={reset}>
              Clear search
            </Button>
          }
        />
      ) : !submittedQuery.trim() ? (
        <EmptyState
          title="Type a search query"
          description="Enter a game title or numeric AppID above to search the Steam catalog."
        />
      ) : view === "grid" ? (
        <div className="game-grid" data-testid="catalog-search-results">
          {games.map((game) => (
            <article key={game.appId} className="game-card catalog-card">
              <a
                href={gameHref(game.appId, "catalog")}
                className="game-art-link"
                tabIndex={-1}
                aria-hidden="true"
              >
                <CatalogArtwork
                  src={game.artworkUrl}
                  alt={game.name ?? `AppID ${game.appId}`}
                />
              </a>
              <div className="game-info">
                <div className="tag-row">
                  {game.installed ? (
                    <StatusBadge tone="green">Verified Installed</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">Not installed</StatusBadge>
                  )}
                  {game.metadataSource && (
                    <StatusBadge
                      tone={
                        game.metadataSource.freshness === "fresh"
                          ? "blue"
                          : "amber"
                      }
                    >
                      {game.metadataSource.providerId} ·{" "}
                      {game.metadataSource.freshness}
                    </StatusBadge>
                  )}
                </div>
                <h3>
                  <a href={gameHref(game.appId, "catalog")}>
                    {game.name ?? `AppID ${game.appId}`}
                  </a>
                </h3>
                <p className="app-id">AppID {game.appId}</p>
                <div className="card-actions">
                  <Button asChild size="sm" variant="outline">
                    <a href={gameHref(game.appId, "catalog")}>
                      Catalog details
                    </a>
                  </Button>
                  {game.installed && (
                    <Button asChild size="sm" variant="ghost">
                      <a href={gameHref(game.appId, "local")}>Local files</a>
                    </Button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="table-container">
          <table
            className="workspace-table"
            aria-label="Catalog search results"
          >
            <thead>
              <tr>
                <th scope="col">Artwork</th>
                <th scope="col">Title</th>
                <th scope="col">AppID</th>
                <th scope="col">Installation status</th>
                <th scope="col">Metadata source</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {games.map((game) => (
                <tr key={game.appId}>
                  <td>
                    <CatalogArtwork
                      src={game.artworkUrl}
                      alt={game.name ?? game.appId}
                      className="table-thumb"
                    />
                  </td>
                  <td>
                    <a
                      href={gameHref(game.appId, "catalog")}
                      className="table-title-link"
                    >
                      <strong>{game.name ?? `AppID ${game.appId}`}</strong>
                    </a>
                  </td>
                  <td>{game.appId}</td>
                  <td>
                    {game.installed ? (
                      <StatusBadge tone="green">Verified installed</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">Not installed</StatusBadge>
                    )}
                  </td>
                  <td>
                    {game.metadataSource ? (
                      <span className="source-label">
                        {game.metadataSource.providerId} (
                        {game.metadataSource.freshness})
                      </span>
                    ) : (
                      "Unknown"
                    )}
                  </td>
                  <td>
                    <Button asChild size="sm" variant="outline">
                      <a href={gameHref(game.appId, "catalog")}>Details</a>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
