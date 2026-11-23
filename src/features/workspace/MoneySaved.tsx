import { useEffect, useState } from "react";
import { totalGamePrices } from "./money-prices";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLuaLibrary } from "@/api/workspace";
import { getSteamPrices, type StoreQuote } from "@/api/store-prices";
import { useStoreCountry } from "@/features/store/useStoreCountry";

export function MoneySaved({ revision = 0 }: { revision?: number }) {
  const country = useStoreCountry();
  const [refresh, setRefresh] = useState(0);
  const key = `${country}:${revision}:${refresh}`;
  const [state, setState] = useState<{
    key: string;
    apps: string[];
    quotes: StoreQuote[];
    loading: boolean;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const library = await getLuaLibrary();
        const apps = [...new Set(library.map((game) => game.appId))];
        const quotes: StoreQuote[] = [];
        if (active)
          setState({
            key,
            apps,
            quotes: [],
            loading: apps.length > 0,
            error: false,
          });
        for (let i = 0; i < apps.length && active; i += 16) {
          const batch = apps.slice(i, i + 16);
          const result = await getSteamPrices(
            batch,
            country,
            refresh > 0,
          ).catch(() => []);
          if (!active) return;
          quotes.push(
            ...result.filter(
              (q) => q.country === country && batch.includes(q.appId),
            ),
          );
          setState({
            key,
            apps,
            quotes: [...quotes],
            loading: i + 16 < apps.length,
            error: false,
          });
        }
      } catch {
        if (active)
          setState({ key, apps: [], quotes: [], loading: false, error: true });
      }
    })();
    return () => {
      active = false;
    };
  }, [key, country, revision, refresh]);
  const current = state?.key === key ? state : null;
  const loading = !current || current.loading;
  const result = totalGamePrices(current?.apps ?? [], current?.quotes ?? []);
  const amounts = [...result.totals]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([currency, amount]) =>
        `${new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(amount / 100)} ${currency}`,
    );
  const value = amounts.length
    ? amounts.join(" + ")
    : current && !current.error && (!result.total || result.priced > 0)
      ? "0"
      : "—";
  return (
    <section
      className="money-saved"
      aria-labelledby="money-saved-title"
      aria-busy={loading}
    >
      <div>
        <h2 id="money-saved-title">Money saved</h2>
        <strong className="money-saved-value">{value}</strong>
        <p>
          {current?.error
            ? "Could not read Lua-added games. Try refreshing."
            : loading
              ? `Checking Steam prices… ${result.priced} of ${result.total} games priced`
              : result.total
                ? `${result.priced} of ${result.total} Lua-added games priced${result.priced < result.total ? " · Incomplete total" : ""}`
                : "Add games through Lua to build your total."}
        </p>
        <small>
          Estimated current Steam value in {country}. Discounts included;
          unavailable prices excluded.
        </small>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Refresh money saved"
        disabled={loading}
        onClick={() => setRefresh((value) => value + 1)}
      >
        <RefreshCw className={loading ? "animate-spin" : ""} />
      </Button>
    </section>
  );
}
