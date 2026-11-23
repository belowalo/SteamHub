import { afterEach, describe, expect, it } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";
import { mockIPC } from "@/test/desktop";
import {
  searchCatalog,
  getCatalogGame,
  getCatalogProviderStatus,
  setCatalogApiKey,
  syncCatalog,
} from "./catalog";
import type {
  CatalogGameDetail,
  CatalogProviderStatus,
  CatalogSearchResult,
} from "@/contracts";

afterEach(() => {
  clearMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  Reflect.deleteProperty(globalThis, "isTauri");
});

describe("real catalog client", () => {
  it("does not fabricate catalog data in browser preview", async () => {
    const result = await searchCatalog({ query: "Portal 2" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL");
      expect(result.error.message).toContain("SteamHub desktop backend");
    }
  });

  it("decodes live catalog search results correctly", async () => {
    const mockSearchResult: CatalogSearchResult = {
      games: [
        {
          appId: "620",
          name: "Portal 2",
          artworkUrl: "https://shared.akamai.steamstatic.com/capsule.jpg",
          installed: false,
          metadataSource: {
            providerId: "steam-storefront",
            fetchedAt: "2026-11-03T12:00:00Z",
            freshness: "fresh",
            documentationUrl: "https://store.steampowered.com",
          },
          itemType: "game",
        },
      ],
      nextCursor: null,
      origin: "live",
      stale: false,
      providerId: "steam-storefront",
      providerStatus: "ready",
    };

    mockIPC((command, args) => {
      expect(command).toBe("catalog_search");
      expect(args).toEqual({ request: { query: "Portal 2" } });
      return { ok: true, data: mockSearchResult };
    });

    const result = await searchCatalog({ query: "Portal 2" });
    expect(result).toEqual({ ok: true, data: mockSearchResult });
  });

  it("decodes catalog game detail and installation status", async () => {
    const mockDetail: CatalogGameDetail = {
      appId: "620",
      name: "Portal 2",
      artworkUrl: "https://shared.akamai.steamstatic.com/capsule.jpg",
      installed: false,
      metadataSource: {
        providerId: "steam-storefront",
        fetchedAt: "2026-11-03T12:00:00Z",
        freshness: "fresh",
        documentationUrl: "https://store.steampowered.com",
      },
      itemType: "game",
      description: "A puzzle game.",
      shortDescription: "Perpetual testing.",
      releaseDate: "18 Apr, 2011",
      website: "https://thinkwithportals.com",
      headerImage: "https://store.akamai.steamstatic.com/header.jpg",
      capsuleImage: null,
      genres: ["Action", "Adventure"],
      localInstallations: [],
      localInstallationDerived: false,
    };

    mockIPC((command, args) => {
      expect(command).toBe("catalog_get");
      expect(args).toEqual({ appId: "620" });
      return { ok: true, data: mockDetail };
    });

    const result = await getCatalogGame("620");
    expect(result).toEqual({ ok: true, data: mockDetail });
  });

  it("decodes provider status information and setup needed flags", async () => {
    const mockProviders: CatalogProviderStatus[] = [
      {
        id: "steam-storefront",
        displayName: "Steam Storefront",
        kind: "official",
        enabled: true,
        documentationUrl: "https://store.steampowered.com",
        capabilities: ["catalog_search", "catalog_get"],
        status: "ready",
        lastSyncTime: null,
        setupNeeded: false,
        lastRedactedError: null,
      },
      {
        id: "steam-official",
        displayName: "Steam Web API (IStoreService)",
        kind: "official",
        enabled: false,
        documentationUrl:
          "https://partner.steamgames.com/doc/webapi/IStoreService",
        capabilities: ["catalog_search", "catalog_get"],
        status: "needs_configuration",
        lastSyncTime: null,
        setupNeeded: true,
        lastRedactedError: null,
      },
    ];

    mockIPC((command) => {
      expect(command).toBe("catalog_provider_status");
      return { ok: true, data: mockProviders };
    });

    const result = await getCatalogProviderStatus();
    expect(result).toEqual({ ok: true, data: mockProviders });
  });

  it("handles structured error responses gracefully", async () => {
    const error = {
      code: "RATE_LIMITED",
      message: "Rate limit reached. Retry in 60 seconds.",
      retryable: true,
    };

    mockIPC((command) => {
      expect(command).toBe("catalog_search");
      return { ok: false, error };
    });

    const result = await searchCatalog({ query: "Portal 2" });
    expect(result).toEqual({ ok: false, error });
  });

  it("rejects malformed responses without throwing unhandled exceptions", async () => {
    mockIPC(() => {
      return {
        ok: true,
        data: {
          games: [{ appId: "bad app id containing spaces" }],
        },
      };
    });

    const result = await searchCatalog({ query: "test" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL");
      expect(result.error.message).toContain("incompatible response");
    }
  });

  it("handles set api key and sync operations", async () => {
    mockIPC((command, args) => {
      if (command === "catalog_set_api_key") {
        expect(args).toEqual({ request: { apiKey: "test_key_abc" } });
        return { ok: true, data: true };
      }
      expect(command).toBe("catalog_sync");
      return {
        ok: true,
        data: {
          status: "succeeded",
          processed: 50,
          message: "Synchronized 50 entries.",
        },
      };
    });

    expect(await setCatalogApiKey("test_key_abc")).toEqual({
      ok: true,
      data: true,
    });
    expect(await syncCatalog()).toEqual({
      ok: true,
      data: {
        status: "succeeded",
        processed: 50,
        message: "Synchronized 50 entries.",
      },
    });
  });
});
