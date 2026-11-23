import { useEffect, useState } from "react";
import { getSteamPrices, type StoreQuote } from "@/api/store-prices";

export function useStorePrices(apps: string[], country: string, version = 0) {
  const idsKey = [...new Set(apps)].slice(0, 16).sort().join(",");
  const key = `${country}:${idsKey}:${version}`;
  const [response, setResponse] = useState<{
    key: string;
    quotes: StoreQuote[];
  } | null>(null);
  useEffect(() => {
    if (!idsKey) return;
    let active = true;
    void getSteamPrices(idsKey.split(","), country, version > 0).then(
      (quotes) => {
        if (active)
          setResponse({
            key,
            quotes: quotes.filter((q) => q.country === country),
          });
      },
      () => {
        if (active) setResponse({ key, quotes: [] });
      },
    );
    return () => {
      active = false;
    };
  }, [idsKey, country, key, version]);
  return {
    quotes: Object.fromEntries(
      (response?.key === key ? response.quotes : []).map((q) => [q.appId, q]),
    ),
    loading: !!idsKey && response?.key !== key,
  };
}
