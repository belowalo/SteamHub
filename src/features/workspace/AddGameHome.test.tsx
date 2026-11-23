import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearMocks } from "@tauri-apps/api/mocks";
import { mockIPC } from "@/test/desktop";
import { WorkspaceContext, type WorkspaceState } from "@/app/workspace-context";
import { AddGameHome } from "./AddGameHome";
import {
  getSteamPrices,
  saveStoreCountry,
  type StoreQuote,
} from "@/api/store-prices";
vi.mock("@/api/store-prices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/store-prices")>()),
  getSteamPrices: vi.fn(),
}));
vi.mock("./MoneySaved", () => ({ MoneySaved: () => null }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
beforeEach(() => {
  vi.mocked(getSteamPrices).mockReset();
  vi.mocked(getSteamPrices).mockResolvedValue([]);
});
afterEach(() => {
  localStorage.clear();
  clearMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});
function open() {
  const state: WorkspaceState = {
    snapshot: null,
    busy: false,
    loading: false,
    error: "",
    message: "",
    refresh: vi.fn(async () => {}),
    run: vi.fn(async () => undefined),
    perform: vi.fn(async () => true),
    dismiss: vi.fn(),
  };
  render(
    <WorkspaceContext.Provider value={state}>
      <AddGameHome />
    </WorkspaceContext.Provider>,
  );
}

describe("Steam store prices", () => {
  const quote = (appId: string, country: string): StoreQuote => ({
    appId,
    country,
    kind: appId === "570" ? "free" : "paid",
    currency: appId === "570" ? null : country === "CA" ? "CAD" : "USD",
    current: country === "CA" ? "CDN$ 12.49" : "$9.99",
    original: country === "CA" ? "CDN$ 24.99" : "$19.99",
    discount: appId === "570" ? 0 : 50,
    checkedAt: 1793936000,
  });
  it("labels free games and discounts in the selected country and opens the official free-game page", async () => {
    vi.mocked(getSteamPrices).mockImplementation(async (apps, country) =>
      apps.map((app) => quote(app, country)),
    );
    const calls: string[] = [];
    mockIPC((command, args) => {
      calls.push(command);
      if (command === "open_reference") {
        expect(args).toEqual({
          url: "https://store.steampowered.com/app/570/?cc=CA",
        });
        return { ok: true, data: true };
      }
      return {
        ok: true,
        data: {
          games: [
            { appId: "570", name: "Free fixture" },
            { appId: "620", name: "Sale fixture" },
          ].map((game) => ({
            ...game,
            artworkUrl: null,
            installed: false,
            metadataSource: null,
          })),
          nextCursor: null,
          origin: "live",
          stale: false,
          providerId: "steam-storefront",
          providerStatus: "ready",
        },
      };
    });
    saveStoreCountry("CA");
    open();
    const user = userEvent.setup();
    expect(
      screen.queryByRole("combobox", { name: "Steam store country" }),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Game name, AppID or Steam link"),
      "fixture",
    );
    const free = await screen.findByRole("button", { name: /Free fixture/ });
    expect(await within(free).findByText("Free on Steam")).toBeInTheDocument();
    const sale = screen.getByRole("button", { name: /Sale fixture/ });
    expect(within(sale).getByText("−50%")).toBeInTheDocument();
    expect(within(sale).getByText("CDN$ 24.99").tagName).toBe("DEL");
    expect(within(sale).getByText("CDN$ 12.49")).toBeInTheDocument();
    expect(within(sale).getByText("CAD")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Refresh Steam prices" }),
    );
    expect(getSteamPrices).toHaveBeenLastCalledWith(["570", "620"], "CA", true);
    await within(free).findByText("Free on Steam");
    await user.click(free);
    expect(calls).toEqual(["catalog_search", "open_reference"]);
  });
  it("checks a typed AppID and directs free games to Steam without fetching Lua", async () => {
    vi.mocked(getSteamPrices).mockResolvedValue([quote("570", "US")]);
    const ipc = vi.fn(() => ({ ok: true, data: true }));
    mockIPC(ipc);
    open();
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Game name, AppID or Steam link"),
      "570",
    );
    await user.click(screen.getByRole("button", { name: "Add to Steam" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "free on Steam",
    );
    expect(
      screen.getByRole("button", { name: "Get on Steam" }),
    ).toBeInTheDocument();
    expect(ipc).not.toHaveBeenCalled();
    expect(getSteamPrices).toHaveBeenCalledWith(["570"], "US");
  });
});
describe("simple home flow", () => {
  it("focuses search with slash, clears with Escape and preserves normal typing", async () => {
    open();
    const input = screen.getByLabelText("Game name, AppID or Steam link");
    fireEvent.keyDown(document.body, { key: "/" });
    expect(input).toHaveFocus();
    await userEvent.type(input, "620");
    await userEvent.keyboard("/");
    expect(input).toHaveValue("620/");
    await userEvent.keyboard("{Escape}");
    expect(input).toHaveValue("");
    await userEvent.type(input, "123");
    await userEvent.click(
      screen.getByRole("button", { name: "Clear game search" }),
    );
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });
  it("suggests games by name while typing and adds the selected game", async () => {
    const calls: string[] = [];
    mockIPC((cmd, args) => {
      calls.push(cmd);
      const generated = {
        text: "addappid(813780)",
        filename: "steamhub_813780.lua",
        installedPath: "G:\\Steam\\config\\lua\\steamhub_813780.lua",
        manifests: [],
        warnings: [],
      };
      if (cmd === "catalog_search") {
        expect(args).toEqual({
          request: { query: "Age of Empires II", limit: 8 },
        });
        return {
          ok: true,
          data: {
            games: [
              {
                appId: "813780",
                name: "Age of Empires II: Definitive Edition",
                artworkUrl: null,
                installed: false,
                metadataSource: null,
              },
            ],
            nextCursor: null,
            origin: "live",
            stale: false,
            providerId: "steam-storefront",
            providerStatus: "ready",
          },
        };
      }
      if (cmd === "steamtools_lookup")
        return {
          ok: true,
          data: {
            id: "a".repeat(64),
            app: "813780",
            source: "https://github.com/Satisl/MAU/tree/813780",
            generated,
            steamRoot: "G:\\Steam",
          },
        };
      if (cmd === "steam_action") {
        expect(args).toEqual({ app: "813780", action: "library" });
        return { ok: true, data: true };
      }
      return { ok: true, data: generated };
    });
    open();
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Game name, AppID or Steam link"),
      "Age of Empires II",
    );
    await user.click(
      await screen.findByRole("button", {
        name: /Age of Empires II: Definitive Edition/,
      }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Open in Steam" }),
    );
    expect(calls).toEqual([
      "catalog_search",
      "steamtools_lookup",
      "steamtools_add",
      "steam_action",
    ]);
  });
  it("fetches and adds an AppID in one submission without local scanning", async () => {
    const calls: string[] = [];
    mockIPC((cmd, args) => {
      calls.push(cmd);
      const generated = {
        text: "addappid(813780)",
        filename: "steamhub_813780.lua",
        installedPath: "G:\\Steam\\config\\lua\\steamhub_813780.lua",
        manifests: [],
        warnings: [],
      };
      if (cmd === "steamtools_lookup") {
        expect(args).toMatchObject({
          app: "813780",
          requestId: expect.any(String),
        });
        return {
          ok: true,
          data: {
            id: "a".repeat(64),
            app: "813780",
            source: "https://github.com/Satisl/MAU/tree/813780",
            generated,
            steamRoot: "G:\\Steam",
          },
        };
      }
      expect(args).toEqual({ id: "a".repeat(64), steamRoot: "G:\\Steam" });
      return { ok: true, data: generated };
    });
    open();
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Game name, AppID or Steam link"),
      "813780",
    );
    await user.click(screen.getByRole("button", { name: "Add to Steam" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Game data installed",
    );
    expect(calls).toEqual(["steamtools_lookup", "steamtools_add"]);
  });
  it("never reports success when the data source is unavailable", async () => {
    mockIPC(() => ({
      ok: false,
      error: {
        code: "GAME_DATA_UNAVAILABLE",
        message: "No usable game data was found",
        retryable: true,
      },
    }));
    open();
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Game name, AppID or Steam link"),
      "813780",
    );
    await user.click(screen.getByRole("button", { name: "Add to Steam" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No usable game data was found",
    );
    expect(screen.queryByText(/Game data installed/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import Lua or ZIP" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("link", { name: "Configure sources" }),
    ).toHaveAttribute("href", "#/sources");
  });
  it("retains the failed AppID after cancelling import and deploys a later import", async () => {
    const calls: string[] = [];
    let imports = 0;
    const generated = {
      text: "addappid(620)",
      filename: "steamhub_620.lua",
      installedPath: null,
      manifests: [],
      warnings: [],
    };
    mockIPC((cmd, args) => {
      calls.push(cmd);
      if (cmd === "steamtools_lookup")
        return {
          ok: false,
          error: {
            code: "GAME_DATA_UNAVAILABLE",
            message: "No entry",
            retryable: true,
          },
        };
      if (cmd === "steamtools_import_lookup") {
        expect(args).toEqual({ app: "620", path: null });
        return {
          ok: true,
          data:
            ++imports === 1
              ? null
              : {
                  id: "b".repeat(64),
                  app: "620",
                  source: "Imported 620.lua",
                  generated,
                  steamRoot: "G:\\Steam",
                },
        };
      }
      expect(cmd).toBe("steamtools_add");
      expect(args).toEqual({ id: "b".repeat(64), steamRoot: "G:\\Steam" });
      return { ok: true, data: generated };
    });
    open();
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Game name, AppID or Steam link"),
      "620",
    );
    await user.click(screen.getByRole("button", { name: "Add to Steam" }));
    await user.click(
      await screen.findByRole("button", { name: "Import Lua or ZIP" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("No entry");
    await user.click(screen.getByRole("button", { name: "Import Lua or ZIP" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Game data installed",
    );
    expect(calls).toEqual([
      "steamtools_lookup",
      "steamtools_import_lookup",
      "steamtools_import_lookup",
      "steamtools_add",
    ]);
  });
});

it("sets up a missing runtime and resumes cached data without another provider request", async () => {
  const calls: string[] = [];
  let attempts = 0;
  const generated = {
    text: "addappid(813780)",
    filename: "steamhub_813780.lua",
    installedPath: null,
    manifests: [],
    warnings: [],
  };
  mockIPC((cmd, args) => {
    calls.push(cmd);
    if (cmd === "steamtools_lookup")
      return {
        ok: true,
        data: {
          id: "a".repeat(64),
          app: "813780",
          source: "https://example.com",
          generated,
          steamRoot: "G:\\Steam",
        },
      };
    if (cmd === "steam_runtime") {
      expect(args).toEqual({ action: "install", steamRoot: "G:\\Steam" });
      return {
        ok: true,
        data: { installed: true, canUndo: true, steamRoot: "G:\\Steam" },
      };
    }
    if (cmd === "steamtools_add" && attempts++ === 0)
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message:
            "SteamTools/OpenSteamTool runtime was not found in this Steam folder.",
          retryable: false,
        },
      };
    return { ok: true, data: generated };
  });
  open();
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText("Game name, AppID or Steam link"),
    "813780",
  );
  await user.click(screen.getByRole("button", { name: "Add to Steam" }));
  await user.click(await screen.findByRole("button", { name: "Set up Steam" }));
  expect(
    await screen.findByRole("button", { name: "Open in Steam" }),
  ).toBeInTheDocument();
  expect(calls).toEqual([
    "steamtools_lookup",
    "steamtools_add",
    "steam_runtime",
    "steamtools_add",
  ]);
});
