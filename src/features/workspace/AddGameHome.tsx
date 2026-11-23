import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  Gamepad2,
  LoaderCircle,
  Search,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchCatalog } from "@/api/catalog";
import {
  addGameData,
  lookupGameData,
  selectLibraryFolder,
  steamAction,
  type GameDataLookup,
  importGameData,
  openReference,
  type LookupProgress,
} from "@/api/workspace";
import { useWorkspace } from "@/app/workspace-context";
import type { CatalogGameSummary } from "@/contracts";

import { RuntimeSetup } from "./RuntimeSetup";
import { getSteamPrices, type StoreQuote } from "@/api/store-prices";
import { useStorePrices } from "@/features/store/useStorePrices";
import { StorePrice } from "@/features/store/StorePrice";
import { useStoreCountry } from "@/features/store/useStoreCountry";
import { MoneySaved } from "./MoneySaved";

const readable = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/^[A-Z_]+:\s*/, "");
export function AddGameHome() {
  const { refresh } = useWorkspace();
  const [query, setQuery] = useState("");
  const [games, setGames] = useState<CatalogGameSummary[]>([]);
  const country = useStoreCountry();
  const [priceVersion, setPriceVersion] = useState(0);
  const [freeApp, setFreeApp] = useState("");
  const [selectedQuote, setSelectedQuote] = useState<StoreQuote | undefined>();
  const { quotes, loading: pricesLoading } = useStorePrices(
    games.map((game) => game.appId),
    country,
    priceVersion,
  );
  const [runtimeRoot, setRuntimeRoot] = useState<string | undefined>();
  const [pending, setPending] = useState<GameDataLookup | null>(null);
  const [stage, setStage] = useState("idle");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState("");
  const [addedApp, setAddedApp] = useState("");
  const [fallbackApp, setFallbackApp] = useState("");
  const [attempts, setAttempts] = useState<LookupProgress[]>([]);
  const [failureStep, setFailureStep] = useState(1);
  const [savingsRevision, setSavingsRevision] = useState(0);
  const [retryApp, setRetryApp] = useState("");
  const [installedPath, setInstalledPath] = useState<string | null>(null);
  const [installWarnings, setInstallWarnings] = useState<string[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const searchGeneration = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key !== "/" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        !(target instanceof HTMLElement) ||
        target.isContentEditable ||
        target.closest('input,textarea,select,[role="dialog"]')
      )
        return;
      event.preventDefault();
      searchInput.current?.focus();
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, []);
  const clearSearch = () => {
    searchGeneration.current++;
    setQuery("");
    setGames([]);
    setFreeApp("");
    setSelectedQuote(undefined);
    setFallbackApp("");
    setAddedApp("");
    setMessage("");
    setPending(null);
    setStage("idle");
    setAttempts([]);
    setRetryApp("");
    setFailed(false);
    searchInput.current?.focus();
  };
  useEffect(() => {
    const value = query.trim();
    if (value.length < 3 || /^\d+$/.test(value) || /^https?:/i.test(value))
      return;
    const generation = ++searchGeneration.current;
    let active = true;
    const timer = setTimeout(() => {
      if (!active || searchGeneration.current !== generation) return;
      setStage("suggesting");
      void searchCatalog({ query: value, limit: 8 }).then(
        (result) => {
          if (!active || searchGeneration.current !== generation) return;
          setStage("idle");
          if (result.ok) {
            setGames(result.data.games);
            setFailed(false);
            setMessage(
              result.data.games.length
                ? ""
                : "No games found. Try another name.",
            );
          } else {
            setFailed(true);
            setMessage(result.error.message);
          }
        },
        (e) => {
          if (active && searchGeneration.current === generation) {
            setStage("idle");
            setFailed(true);
            setMessage(readable(e));
          }
        },
      );
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);
  const busy = ["pricing", "searching", "fetching", "installing"].includes(
    stage,
  );
  const deploy = async (lookup: GameDataLookup, root: string) => {
    setStage("installing");
    setPending(lookup);
    setFailureStep(3);
    try {
      const result = await addGameData(lookup.id, root);
      setInstalledPath(result.installedPath);
      setInstallWarnings(result.warnings);
    } catch (e) {
      if (readable(e).includes("runtime was not found")) {
        setPending(lookup);
        setRuntimeRoot(root);
        setStage("runtime");
        setFailed(false);
        setMessage("Close Steam, then finish setup to add this game.");
        return;
      }
      throw e;
    }
    setStage("done");
    setAddedApp(lookup.app);
    setFallbackApp("");
    setPending(null);
    setSavingsRevision((value) => value + 1);
    setMessage(
      "Game data installed. Restart Steam to load the new entry, then open your library. Game download and launch have not been verified.",
    );
    await refresh().catch(() => undefined);
  };
  const add = async (app: string, name?: string | null) => {
    searchGeneration.current++;
    setStage("pricing");
    setFailureStep(1);
    setAttempts([]);
    setRetryApp(app);
    setInstalledPath(null);
    setInstallWarnings([]);
    setFreeApp("");
    setSelectedQuote(undefined);
    setMessage("");
    setFailed(false);
    setGames([]);
    setPending(null);
    setRuntimeRoot(undefined);
    setSelected(name || `AppID ${app}`);
    setFallbackApp(app);
    setAddedApp("");
    try {
      const price = (await getSteamPrices([app], country).catch(() => []))[0];
      setSelectedQuote(price);
      if (price?.kind === "free") {
        setFreeApp(app);
        setStage("free");
        setFallbackApp("");
        setMessage(
          `${name || `AppID ${app}`} is free on Steam. Get it from the official store.`,
        );
        return;
      }
      setStage("fetching");
      setFailureStep(2);
      const lookup = await lookupGameData(app, (event) => {
        if (!alive.current) return;
        setAttempts((previous) =>
          [
            ...previous.filter((item) => item.index !== event.index),
            event,
          ].sort((a, b) => a.index - b.index),
        );
      });
      if (lookup.steamRoot) await deploy(lookup, lookup.steamRoot);
      else {
        setPending(lookup);
        setStage("folder");
        setMessage(
          "Choose the Steam folder containing steam.exe to finish adding this game.",
        );
      }
    } catch (e) {
      setFailed(true);
      setMessage(readable(e));
      setStage("error");
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    searchGeneration.current++;
    const value = query.trim();
    const id = /^\d+$/.test(value)
      ? value
      : value.match(
          /^https:\/\/store\.steampowered\.com\/app\/(\d+)(?:\/|$)/i,
        )?.[1];
    if (id) {
      await add(id);
      return;
    }
    setStage("searching");
    setMessage("");
    setFailed(false);
    setPending(null);
    setGames([]);
    try {
      const result = await searchCatalog({ query: value, limit: 8 });
      if (!result.ok) throw new Error(result.error.message);
      setGames(result.data.games);
      setStage("idle");
      if (!result.data.games.length)
        setMessage(
          "No games found. Try a different title or paste a Steam AppID.",
        );
    } catch (e) {
      setMessage(readable(e));
      setFailed(true);
      setStage("idle");
    }
  };
  return (
    <div className="add-game-home">
      <header className="add-game-intro">
        <h1 tabIndex={-1} data-page-heading>
          Add a game
        </h1>
      </header>
      <section className="add-game-card" aria-label="Add a game">
        <form
          onSubmit={(e) => {
            void submit(e);
          }}
          className="add-game-search"
        >
          <Search aria-hidden="true" size={21} />
          <Input
            ref={searchInput}
            aria-keyshortcuts="/"
            aria-label="Game name, AppID or Steam link"
            placeholder="Game name, AppID, or Steam link"
            value={query}
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy) clearSearch();
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setFallbackApp("");
              searchGeneration.current++;
              setAddedApp("");
              setFreeApp("");
              setSelectedQuote(undefined);
              setMessage("");
              setGames([]);
              setPending(null);
              setStage("idle");
              setAttempts([]);
              setRetryApp("");
              setFailed(false);
            }}
          />
          {!!query && !busy && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Clear game search"
              onClick={clearSearch}
            >
              <X />
            </Button>
          )}
          <Button type="submit" disabled={busy || !query.trim()}>
            {busy ? (
              <LoaderCircle className="animate-spin" size={18} />
            ) : (
              <ArrowRight size={18} />
            )}{" "}
            {/^\d+$/.test(query.trim()) ||
            query.includes("store.steampowered.com/app/")
              ? "Add to Steam"
              : "Find game"}
          </Button>
        </form>

        {stage === "suggesting" && (
          <p className="add-game-search-status" role="status">
            Searching…
          </p>
        )}
        {busy && (
          <div className="add-game-progress" role="status" aria-live="polite">
            <LoaderCircle className="animate-spin" size={20} />
            <div>
              <strong>
                {stage === "pricing"
                  ? "Checking Steam price…"
                  : stage === "searching"
                    ? "Searching games…"
                    : stage === "fetching"
                      ? "Getting game data…"
                      : "Adding to Steam…"}
              </strong>
              <p>
                {stage === "fetching" && attempts.length
                  ? attempts[attempts.length - 1].source
                  : selected || "Finding your next game"}
              </p>
            </div>
          </div>
        )}
        {selected &&
          [
            "pricing",
            "fetching",
            "installing",
            "folder",
            "runtime",
            "done",
            "error",
          ].includes(stage) && (
            <ol className="add-game-steps" aria-label="Add game progress">
              {["Check Steam price", "Find game data", "Write Steam files"].map(
                (label, index) => {
                  const step = index + 1;
                  const position =
                    stage === "pricing"
                      ? 1
                      : stage === "fetching"
                        ? 2
                        : stage === "error"
                          ? failureStep
                          : 3;
                  const status =
                    stage === "done" || step < position
                      ? "complete"
                      : step === position
                        ? stage === "error"
                          ? "failed"
                          : ["folder", "runtime"].includes(stage)
                            ? "waiting"
                            : "active"
                        : "pending";
                  return (
                    <li
                      key={label}
                      data-state={status}
                      aria-current={
                        status === "active" ||
                        status === "waiting" ||
                        status === "failed"
                          ? "step"
                          : undefined
                      }
                    >
                      <span>
                        {status === "complete" ? <Check size={14} /> : step}
                      </span>
                      {label}
                      <small>
                        {status === "complete"
                          ? step === 1 &&
                            (!selectedQuote ||
                              selectedQuote.kind === "unavailable")
                            ? "Unavailable"
                            : "Done"
                          : status === "failed"
                            ? "Failed"
                            : status === "waiting"
                              ? "Setup needed"
                              : status === "active"
                                ? "In progress"
                                : "Waiting"}
                      </small>
                    </li>
                  );
                },
              )}
            </ol>
          )}
        {attempts.length > 0 && (
          <details className="provider-attempts" open={stage === "fetching"}>
            <summary>Source results ({attempts.length})</summary>
            <ul>
              {attempts.map((attempt) => (
                <li key={attempt.index} data-state={attempt.status}>
                  <strong>{attempt.source}</strong>
                  <span>
                    {attempt.status === "trying"
                      ? "Trying"
                      : attempt.status === "validating"
                        ? "Validating"
                        : attempt.status === "ready"
                          ? "Found"
                          : attempt.status === "skipped"
                            ? "Skipped"
                            : "Failed"}
                  </span>
                  <p>{attempt.detail}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
        {games.length > 0 && (
          <div className="add-game-results">
            <div className="search-results-heading">
              <span>{games.length} results</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Refresh Steam prices"
                disabled={pricesLoading}
                onClick={() => setPriceVersion((version) => version + 1)}
              >
                <RefreshCw className={pricesLoading ? "animate-spin" : ""} />
                Refresh prices
              </Button>
            </div>
            {games.map((game) => (
              <button
                key={game.appId}
                disabled={busy}
                onClick={() => {
                  if (quotes[game.appId]?.kind === "free") {
                    void openReference(
                      `https://store.steampowered.com/app/${game.appId}/?cc=${country}`,
                    ).catch((error) => {
                      setFailed(true);
                      setMessage(readable(error));
                    });
                  } else void add(game.appId, game.name);
                }}
              >
                {game.artworkUrl ? (
                  <img src={game.artworkUrl} alt="" />
                ) : (
                  <Gamepad2 aria-hidden="true" />
                )}
                <span>
                  <strong>{game.name || game.appId}</strong>
                  <small>AppID {game.appId}</small>
                  <StorePrice
                    quote={quotes[game.appId]}
                    loading={pricesLoading}
                  />
                </span>
                <span className="add-game-result-action">
                  {quotes[game.appId]?.kind === "free"
                    ? "Get on Steam"
                    : "Add to Steam"}{" "}
                  <ArrowRight size={15} />
                </span>
              </button>
            ))}
          </div>
        )}
        {message && (
          <div
            className={`add-game-message ${failed ? "is-error" : ""}`}
            role={failed ? "alert" : "status"}
          >
            {stage === "done" && <Check size={20} />}
            <p>
              {stage === "error" &&
              failureStep === 2 &&
              attempts.length > 0 &&
              !attempts.some((attempt) => attempt.status === "ready")
                ? `No enabled source supplied usable game data for AppID ${retryApp}.`
                : message}
            </p>
          </div>
        )}
        {failed && retryApp && stage !== "done" && (
          <div className="add-game-recovery">
            <p>
              {failureStep === 3
                ? "Check Steam folder access and runtime setup, then retry. A failed add is not recorded as success."
                : "Retry the enabled sources, configure provider keys, or import a Lua/ZIP you downloaded."}
            </p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                void add(retryApp, selected);
              }}
            >
              Retry adding game
            </Button>
          </div>
        )}
        {stage === "done" && (installedPath || installWarnings.length > 0) && (
          <details className="provider-attempts">
            <summary>Installed file details</summary>
            {installedPath && <code>{installedPath}</code>}
            {installWarnings.map((warning, index) => (
              <p key={index}>{warning}</p>
            ))}
          </details>
        )}
        {freeApp && (
          <Button
            onClick={() => {
              void openReference(
                `https://store.steampowered.com/app/${freeApp}/?cc=${country}`,
              ).catch((error) => {
                setFailed(true);
                setMessage(readable(error));
              });
            }}
          >
            Get on Steam <ArrowRight size={15} />
          </Button>
        )}
        {!games.length &&
          selectedQuote &&
          selectedQuote.country === country &&
          selectedQuote.kind !== "free" && (
            <div className="store-selected-price">
              <StorePrice quote={selectedQuote} />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void openReference(
                    `https://store.steampowered.com/app/${selectedQuote.appId}/?cc=${country}`,
                  ).catch((error) => {
                    setFailed(true);
                    setMessage(readable(error));
                  });
                }}
              >
                View on Steam
              </Button>
            </div>
          )}
        {failed && fallbackApp && (
          <div className="inline-controls game-data-fallback">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setStage("fetching");
                void importGameData(fallbackApp)
                  .then(async (lookup) => {
                    if (!lookup) {
                      setStage("idle");
                      return;
                    }
                    setFallbackApp("");
                    setFailed(false);
                    setMessage("");
                    if (lookup.steamRoot)
                      await deploy(lookup, lookup.steamRoot);
                    else {
                      setPending(lookup);
                      setStage("folder");
                      setMessage(
                        "Choose the Steam folder to finish adding this game.",
                      );
                    }
                  })
                  .catch((e) => {
                    setStage("idle");
                    setMessage(readable(e));
                    setFailed(true);
                  });
              }}
            >
              Import Lua or ZIP
            </Button>
            <Button variant="outline" asChild>
              <a href="#/sources">Configure sources</a>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void openReference("https://openlua.cloud/").catch((e) =>
                  setMessage(readable(e)),
                );
              }}
            >
              Open OpenLua
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void openReference("https://lua.tools/").catch((e) =>
                  setMessage(readable(e)),
                );
              }}
            >
              Open LuaTools
            </Button>
          </div>
        )}
        {pending && stage !== "runtime" && (
          <Button
            disabled={busy}
            onClick={() => {
              void selectLibraryFolder()
                .then(async (root) => {
                  if (root) await deploy(pending, root);
                })
                .catch((e) => {
                  setFailed(true);
                  setMessage(readable(e));
                  setStage("folder");
                });
            }}
          >
            Choose Steam folder
          </Button>
        )}
        {addedApp && (
          <Button
            variant="outline"
            onClick={() => {
              void steamAction(addedApp, "library").catch((e) => {
                setFailed(true);
                setMessage(readable(e));
              });
            }}
          >
            Open in Steam
          </Button>
        )}
        {runtimeRoot && pending && (
          <RuntimeSetup
            key={runtimeRoot}
            root={runtimeRoot}
            compact
            onReady={async (root) => {
              try {
                await deploy(pending, root);
              } catch (e) {
                setStage("error");
                setFailed(true);
                setMessage(
                  `Runtime installed, but game files could not be added: ${readable(e)}`,
                );
                setRuntimeRoot(undefined);
              }
            }}
          />
        )}
      </section>
      <MoneySaved revision={savingsRevision} />
    </div>
  );
}
