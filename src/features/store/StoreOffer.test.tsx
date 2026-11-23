import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { StoreOffer } from "./StoreOffer";
import { StoreRegionSettings } from "./StoreRegionSettings";
import { getSteamPrices, type StoreQuote } from "@/api/store-prices";
vi.mock("@/api/store-prices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/store-prices")>()),
  getSteamPrices: vi.fn(),
}));
afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
it("discards an old country's response when the selected country changes", async () => {
  localStorage.setItem("steamhub.storeCountry.v2", "US");
  let us!: (value: StoreQuote[]) => void;
  let ca!: (value: StoreQuote[]) => void;
  vi.mocked(getSteamPrices).mockImplementation(
    (_apps, country) =>
      new Promise((resolve) => {
        if (country === "US") us = resolve;
        else ca = resolve;
      }),
  );
  render(
    <>
      <StoreRegionSettings />
      <StoreOffer appId="620" />
    </>,
  );
  await waitFor(() =>
    expect(getSteamPrices).toHaveBeenCalledWith(["620"], "US", false),
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Steam store country"),
    "CA",
  );
  await waitFor(() =>
    expect(getSteamPrices).toHaveBeenLastCalledWith(["620"], "CA", false),
  );
  const quote = (country: string): StoreQuote => ({
    appId: "620",
    country,
    kind: "paid",
    currency: country === "CA" ? "CAD" : "USD",
    current: "$12.49",
    original: "$24.99",
    discount: 50,
    checkedAt: 1793936000,
  });
  await act(async () => us([quote("US")]));
  expect(screen.queryByText("USD")).not.toBeInTheDocument();
  await act(async () => ca([quote("CA")]));
  expect(screen.getByText("CAD")).toBeInTheDocument();
  expect(screen.queryByText("USD")).not.toBeInTheDocument();
});
it("shows unavailable prices without claiming a free offer when Steam cannot be reached", async () => {
  vi.mocked(getSteamPrices).mockRejectedValue(new Error("Offline"));
  render(<StoreOffer appId="620" />);
  expect(await screen.findByText("Price unavailable")).toBeInTheDocument();
  expect(screen.queryByText("Free on Steam")).not.toBeInTheDocument();
});
