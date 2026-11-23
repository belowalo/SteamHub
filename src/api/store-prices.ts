import { z } from "zod";
import { nativeCall } from "./workspace";

const quoteSchema = z.object({
  appId: z.string(),
  country: z.string(),
  kind: z.enum(["free", "paid", "unavailable"]),
  currency: z.string().nullable(),
  current: z.string().nullable(),
  original: z.string().nullable(),
  discount: z.number().int().min(0).max(100),
  checkedAt: z.number(),
  amountMinor: z.number().int().nonnegative().nullable().optional(),
});
export type StoreQuote = z.infer<typeof quoteSchema>;
export const getSteamPrices = (
  apps: string[],
  country: string,
  refresh = false,
) =>
  nativeCall(
    "steam_store_prices",
    { apps, country, refresh },
    z.array(quoteSchema),
  );
export const storeCountries = [
  { value: "US", label: "United States (USA)" },
  { value: "CA", label: "Canada" },
  { value: "GB", label: "United Kingdom" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "AU", label: "Australia" },
  { value: "NZ", label: "New Zealand" },
  { value: "JP", label: "Japan" },
  { value: "KR", label: "South Korea" },
  { value: "BR", label: "Brazil" },
  { value: "IN", label: "India" },
  { value: "PL", label: "Poland" },
  { value: "MX", label: "Mexico" },
];
const countryKey = "steamhub.storeCountry.v2";
const countryEvent = "steamhub:store-country";
let fallbackCountry = "US";
export function savedStoreCountry() {
  try {
    const saved = localStorage.getItem(countryKey);
    if (storeCountries.some((c) => c.value === saved)) return saved!;
  } catch {
    return fallbackCountry;
  }
  return "US";
}
export function saveStoreCountry(value: string) {
  if (!storeCountries.some((c) => c.value === value)) return;
  fallbackCountry = value;
  try {
    localStorage.setItem(countryKey, value);
  } catch {
    /* Session selection remains usable. */
  }
  window.dispatchEvent(new Event(countryEvent));
}
export function subscribeStoreCountry(onChange: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === countryKey || event.key === null) onChange();
  };
  window.addEventListener(countryEvent, onChange);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(countryEvent, onChange);
    window.removeEventListener("storage", storage);
  };
}
