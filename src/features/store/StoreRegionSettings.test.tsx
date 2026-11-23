import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StoreRegionSettings } from "./StoreRegionSettings";
import { savedStoreCountry } from "@/api/store-prices";
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it("defaults to USA independent of device locale and the old automatic region preference", () => {
  vi.spyOn(navigator, "language", "get").mockReturnValue("fr-CA");
  localStorage.setItem("steamhub.storeCountry.v1", "CA");
  render(<StoreRegionSettings />);
  expect(
    screen.getByRole("combobox", { name: "Steam store country" }),
  ).toHaveValue("US");
});
it("persists a region chosen in settings across remounts", async () => {
  const view = render(<StoreRegionSettings />);
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Steam store country" }),
    "CA",
  );
  expect(savedStoreCountry()).toBe("CA");
  expect(screen.getByRole("status")).toHaveTextContent("Region saved");
  view.unmount();
  render(<StoreRegionSettings />);
  expect(
    screen.getByRole("combobox", { name: "Steam store country" }),
  ).toHaveValue("CA");
});
