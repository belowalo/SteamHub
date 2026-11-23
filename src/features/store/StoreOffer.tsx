import { useState } from "react";
import { openReference } from "@/api/workspace";
import { Button } from "@/components/ui/button";
import { StorePrice } from "./StorePrice";
import { useStorePrices } from "./useStorePrices";
import { useStoreCountry } from "./useStoreCountry";
import { RefreshCw } from "lucide-react";

export function StoreOffer({ appId }: { appId: string }) {
  const country = useStoreCountry();
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const { quotes, loading } = useStorePrices([appId], country, version);
  return (
    <section className="store-offer" aria-label="Steam store price">
      <span className="store-offer-title">Steam price</span>
      <StorePrice quote={quotes[appId]} loading={loading} />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Refresh Steam prices"
        disabled={loading}
        onClick={() => setVersion((value) => value + 1)}
      >
        <RefreshCw className={loading ? "animate-spin" : ""} />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void openReference(
            `https://store.steampowered.com/app/${appId}/?cc=${country}`,
          ).catch((error) =>
            setError(error instanceof Error ? error.message : String(error)),
          );
        }}
      >
        {quotes[appId]?.kind === "free" ? "Get on Steam" : "View on Steam"}
      </Button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
