import { type StoreQuote } from "@/api/store-prices";
import { StatusBadge } from "@/components/workspace/Primitives";

export function StorePrice({
  quote,
  loading = false,
}: {
  quote?: StoreQuote;
  loading?: boolean;
}) {
  if (!quote)
    return (
      <span className="store-price-unavailable">
        {loading ? "Checking Steam price…" : "Price unavailable"}
      </span>
    );
  if (quote.kind === "unavailable")
    return <span className="store-price-unavailable">Price unavailable</span>;
  return (
    <span className="store-price">
      {quote.kind === "free" ? (
        <StatusBadge tone="green">Free on Steam</StatusBadge>
      ) : (
        <>
          {quote.discount > 0 && quote.original && <del>{quote.original}</del>}
          <strong>{quote.current}</strong>
          <span className="store-currency">{quote.currency}</span>
        </>
      )}
      {quote.discount > 0 && (
        <StatusBadge tone="green">−{quote.discount}%</StatusBadge>
      )}
    </span>
  );
}
