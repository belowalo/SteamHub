import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MoneySaved } from "./MoneySaved";
import { totalGamePrices } from "./money-prices";
import { getLuaLibrary } from "@/api/workspace";
import {
  getSteamPrices,
  saveStoreCountry,
  type StoreQuote,
} from "@/api/store-prices";
vi.mock("@/api/workspace", () => ({ getLuaLibrary: vi.fn() }));
vi.mock("@/api/store-prices", async (original) => ({
  ...(await original<typeof import("@/api/store-prices")>()),
  getSteamPrices: vi.fn(),
}));
const quote = (
  appId: string,
  amountMinor: number | null,
  currency = "USD",
  kind: StoreQuote["kind"] = "paid",
): StoreQuote => ({
  appId,
  amountMinor,
  currency,
  kind,
  country: "US",
  current: "$10.00",
  original: null,
  discount: 0,
  checkedAt: 1,
});
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});
afterEach(() => localStorage.clear());
describe("money saved", () => {
  it("deduplicates games, excludes unknown/invalid prices and keeps currencies separate", () => {
    const result = totalGamePrices(
      ["1", "1", "2", "3", "4", "5", "6"],
      [
        quote("1", 999),
        quote("1", 999),
        quote("2", 2500, "CAD"),
        quote("3", null, "USD", "unavailable"),
        quote("4", 0, "USD", "free"),
        quote("5", -10),
        quote("6", null),
        quote("999", 90000),
      ],
    );
    expect([...result.totals]).toEqual([
      ["USD", 999],
      ["CAD", 2500],
    ]);
    expect(result.priced).toBe(3);
    expect(result.total).toBe(6);
  });
  it("prices every Lua game in batches and exposes incomplete totals", async () => {
    vi.mocked(getLuaLibrary).mockResolvedValue(
      Array.from({ length: 17 }, (_, i) => ({
        appId: String(i + 1),
        name: null,
      })),
    );
    vi.mocked(getSteamPrices).mockImplementation(async (apps) =>
      apps.map((app) =>
        quote(
          app,
          app === "17" ? null : 100,
          "USD",
          app === "17" ? "unavailable" : "paid",
        ),
      ),
    );
    render(<MoneySaved />);
    expect(
      await screen.findByText(/16 of 17 Lua-added games priced/),
    ).toHaveTextContent("Incomplete total");
    expect(screen.getByText(/16\.00 USD/)).toBeInTheDocument();
    expect(getSteamPrices).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(getSteamPrices).mock.calls.map(([apps]) => apps.length),
    ).toEqual([16, 1]);
  });
  it("refreshes after adding a game and discards old-region amounts", async () => {
    vi.mocked(getLuaLibrary).mockResolvedValue([{ appId: "1", name: null }]);
    vi.mocked(getSteamPrices).mockImplementation(async (apps, country) =>
      apps.map((app) => ({
        ...quote(
          app,
          country === "CA" ? 1200 : 1000,
          country === "CA" ? "CAD" : "USD",
        ),
        country,
      })),
    );
    const view = render(<MoneySaved revision={0} />);
    expect(await screen.findByText(/10\.00 USD/)).toBeInTheDocument();
    view.rerender(<MoneySaved revision={1} />);
    await waitFor(() => expect(getLuaLibrary).toHaveBeenCalledTimes(2));
    saveStoreCountry("CA");
    expect(await screen.findByText(/12\.00 CAD/)).toBeInTheDocument();
    expect(screen.queryByText(/10\.00 USD/)).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Refresh money saved" }),
    );
    await waitFor(() =>
      expect(getSteamPrices).toHaveBeenLastCalledWith(["1"], "CA", true),
    );
  });
  it("shows unavailable rather than zero when the Lua library cannot be read", async () => {
    vi.mocked(getLuaLibrary).mockRejectedValue(new Error("offline"));
    render(<MoneySaved />);
    expect(
      await screen.findByText(/Could not read Lua-added games/),
    ).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(getSteamPrices).not.toHaveBeenCalled();
  });
});
