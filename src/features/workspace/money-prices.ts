import type { StoreQuote } from "@/api/store-prices";

export function totalGamePrices(apps: string[], quotes: StoreQuote[]) {
  const unique = new Set(apps);
  const priced = new Set<string>();
  const totals = new Map<string, number>();
  for (const quote of quotes) {
    if (!unique.has(quote.appId) || priced.has(quote.appId)) continue;
    if (quote.kind === "free") {
      priced.add(quote.appId);
      continue;
    }
    if (
      quote.kind !== "paid" ||
      !quote.currency ||
      !/^[A-Z]{3}$/.test(quote.currency) ||
      typeof quote.amountMinor !== "number" ||
      !Number.isSafeInteger(quote.amountMinor) ||
      quote.amountMinor < 0
    )
      continue;
    const sum = (totals.get(quote.currency) ?? 0) + quote.amountMinor;
    if (!Number.isSafeInteger(sum)) continue;
    totals.set(quote.currency, sum);
    priced.add(quote.appId);
  }
  return { totals, priced: priced.size, total: unique.size };
}
