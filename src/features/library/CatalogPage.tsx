import { useState } from "react";
import { Grid2X2, List, Search, SlidersHorizontal } from "lucide-react";
import { useDemo } from "@/app/demo-context";
import { filterGames } from "@/api/demo/service";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GameCard, GameTable } from "@/components/workspace/Games";
import {
  EmptyState,
  FilterSelect,
  PageHeader,
  SimulateAction,
  SourceAttribution,
  StatusBadge,
} from "@/components/workspace/Primitives";

export function CatalogPage({
  search = false,
  initialQuery = "",
}: {
  search?: boolean;
  initialQuery?: string;
}) {
  const { games, providers } = useDemo();
  const [query, setQuery] = useState(initialQuery);
  const [genre, setGenre] = useState("all");
  const [installation, setInstallation] = useState("all");
  const [sort, setSort] = useState("name");
  const [source, setSource] = useState("all");
  const [view, setView] = useState<"grid" | "table">("grid");
  const sourceEnabled = providers.find(
    (provider) => provider.id === "demo-catalog",
  )?.enabled;
  const matches = filterGames(
    search && (!sourceEnabled || source === "unavailable") ? [] : games,
    { query, genre, installation, sort },
  );
  const reset = () => {
    setQuery("");
    setGenre("all");
    setInstallation("all");
    setSource("all");
  };
  return (
    <>
      <PageHeader
        title={search ? "Game Search" : "Game Library"}
        description={
          search
            ? "Find your next destination by title or AppID. Search uses offline fixtures."
            : "A home for every game in your sample collection."
        }
        actions={
          <SimulateAction
            label={search ? "Refresh demo catalog" : "Preview library scan"}
            kind={search ? "Catalog preview" : "Library preview"}
          />
        }
      />
      {search && (
        <div className="search-intro">
          <Search />
          <div>
            <h2>One search. Your whole game workspace.</h2>
            <p>
              Try “Aether”, “Neon”, or AppID 999999991. No external catalog is
              contacted.
            </p>
          </div>
          <StatusBadge tone="amber">Offline fixture</StatusBadge>
        </div>
      )}
      <div className="catalog-toolbar">
        <div className="search-field">
          <Search aria-hidden="true" />
          <Input
            aria-label={
              search ? "Search sample catalog" : "Filter sample library"
            }
            placeholder="Search games or AppID…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <FilterSelect
          label="Filter by genre"
          value={genre}
          onChange={setGenre}
          options={[
            { value: "all", label: "All genres" },
            ...Array.from(new Set(games.map((game) => game.genre))),
          ]}
        />
        {search ? (
          <FilterSelect
            label="Filter by source"
            value={source}
            onChange={setSource}
            options={[
              { value: "all", label: "Sample catalog" },
              { value: "unavailable", label: "Unavailable reference" },
            ]}
          />
        ) : (
          <FilterSelect
            label="Filter by installation"
            value={installation}
            onChange={setInstallation}
            options={[
              { value: "all", label: "All sample games" },
              { value: "installed", label: "Demo installed" },
              { value: "absent", label: "Demo not installed" },
            ]}
          />
        )}
      </div>
      <div className="results-toolbar">
        <span>
          <strong>{matches.length}</strong> sample{" "}
          {matches.length === 1 ? "game" : "games"}
          <span className="muted"> · synthetic data</span>
        </span>
        <div className="inline-controls">
          <SlidersHorizontal className="size-4 muted" aria-hidden="true" />
          <FilterSelect
            label="Sort games"
            value={sort}
            onChange={setSort}
            options={[
              { value: "name", label: "Title A–Z" },
              { value: "hours", label: "Sample playtime" },
            ]}
          />
          <div className="view-toggle">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Grid view"
              aria-pressed={view === "grid"}
              onClick={() => setView("grid")}
            >
              <Grid2X2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Table view"
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
            >
              <List />
            </Button>
          </div>
        </div>
      </div>
      {matches.length ? (
        view === "grid" ? (
          <div className="game-grid">
            {matches.map((game) => (
              <GameCard game={game} key={game.appId} />
            ))}
          </div>
        ) : (
          <GameTable games={matches} />
        )
      ) : (
        <EmptyState
          title="No sample games match"
          description={
            !sourceEnabled && search
              ? "The demo catalog is disabled. Enable it in Source Providers to search again."
              : "Try another title, AppID, or filter. These results describe fixtures, not your actual Steam library."
          }
          action={
            <Button onClick={reset} variant="outline">
              Clear filters
            </Button>
          }
        />
      )}
      <SourceAttribution />
    </>
  );
}
