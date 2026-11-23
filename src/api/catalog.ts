import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import type {
  ApiResult,
  CatalogGameDetail,
  CatalogProviderStatus,
  CatalogSearchRequest,
  CatalogSearchResult,
  CatalogSyncRequest,
  CatalogSyncResult,
} from "@/contracts";

const appId = z.string().regex(/^[1-9][0-9]{0,19}$/);
const status = z.enum([
  "verified_local",
  "absent",
  "not_checked",
  "scan_failed",
]);

const error = z.object({
  code: z.enum([
    "INVALID_INPUT",
    "NOT_FOUND",
    "NO_STEAM_INSTALLATION",
    "IO_ERROR",
    "PERMISSION_DENIED",
    "PROVIDER_UNAVAILABLE",
    "RATE_LIMITED",
    "UNSUPPORTED_FORMAT",
    "UNTRUSTED_SOURCE",
    "INCOMPATIBLE_VERSION",
    "INTEGRITY_FAILURE",
    "ROLLBACK_REQUIRED",
    "CONFLICT",
    "CANCELLED",
    "INTERNAL",
  ]),
  message: z.string(),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const sourceAttributionSchema = z.object({
  providerId: z.string(),
  fetchedAt: z.string(),
  freshness: z.enum(["fresh", "stale", "unknown"]),
  documentationUrl: z.string().optional(),
});

export const catalogGameSummarySchema = z.object({
  appId,
  name: z.string().nullable(),
  artworkUrl: z.string().nullable(),
  installed: z.boolean(),
  metadataSource: sourceAttributionSchema.nullable(),
  itemType: z.string().nullable().optional(),
  lastModifiedUnix: z.number().nullable().optional(),
});

export const catalogSearchResultSchema = z.object({
  games: z.array(catalogGameSummarySchema),
  nextCursor: z.string().nullable(),
  origin: z.enum(["live", "cache", "local"]),
  stale: z.boolean(),
  providerId: z.string().nullable(),
  providerStatus: z.enum([
    "ready",
    "needs_configuration",
    "offline",
    "rate_limited",
    "failed",
  ]),
});

const localInstallation = z.object({
  id: z.number().int().positive(),
  appId,
  libraryRoot: z.string(),
  installPath: z.string(),
  buildId: z.string().nullable(),
  sourceAcfPath: z.string(),
  lastSeenAt: z.string(),
  status,
  checkedAt: z.string().nullable(),
});

export const catalogGameDetailSchema = z.object({
  appId,
  name: z.string().nullable(),
  artworkUrl: z.string().nullable(),
  installed: z.boolean(),
  metadataSource: sourceAttributionSchema.nullable(),
  itemType: z.string().nullable().optional(),
  description: z.string().nullable(),
  shortDescription: z.string().nullable().optional(),
  releaseDate: z.string().nullable(),
  website: z.string().nullable().optional(),
  headerImage: z.string().nullable().optional(),
  capsuleImage: z.string().nullable().optional(),
  genres: z.array(z.string()).default([]),
  localInstallations: z.array(localInstallation).default([]),
  localInstallationDerived: z.boolean(),
});

export const catalogProviderStatusSchema = z.array(
  z.object({
    id: z.string(),
    displayName: z.string(),
    kind: z.enum(["official", "community", "local", "fixture"]),
    enabled: z.boolean(),
    documentationUrl: z.string().nullable(),
    capabilities: z.array(z.string()),
    status: z.enum([
      "ready",
      "needs_configuration",
      "offline",
      "rate_limited",
      "failed",
    ]),
    lastSyncTime: z.string().nullable(),
    setupNeeded: z.boolean(),
    lastRedactedError: z.string().nullable(),
  }),
);

export const catalogSyncResultSchema = z.object({
  status: z.string(),
  processed: z.number().int().nonnegative(),
  message: z.string(),
});

function envelope<T>(data: z.ZodType<T>) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error }),
  ]);
}

async function call<T>(
  command:
    | "catalog_search"
    | "catalog_get"
    | "catalog_provider_status"
    | "catalog_set_api_key"
    | "catalog_sync",
  args: Record<string, unknown> | undefined,
  schema: z.ZodType<ApiResult<T>>,
): Promise<ApiResult<T>> {
  if (!isTauri()) {
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message:
          "Real catalog search requires the SteamHub desktop backend. Demo preview remains available.",
        retryable: false,
      },
    };
  }
  try {
    const response = await invoke<unknown>(command, args);
    const parsed = schema.safeParse(response);
    return parsed.success
      ? parsed.data
      : {
          ok: false,
          error: {
            code: "INTERNAL",
            message: "The catalog backend returned an incompatible response.",
            retryable: false,
          },
        };
  } catch {
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message:
          "Could not reach the catalog backend service. Retry the operation.",
        retryable: true,
      },
    };
  }
}

export const searchCatalog = (request: CatalogSearchRequest) =>
  call<CatalogSearchResult>(
    "catalog_search",
    { request },
    envelope(catalogSearchResultSchema),
  );

export const getCatalogGame = (appId: string) =>
  call<CatalogGameDetail>(
    "catalog_get",
    { appId },
    envelope(catalogGameDetailSchema),
  );

export const getCatalogProviderStatus = () =>
  call<CatalogProviderStatus[]>(
    "catalog_provider_status",
    undefined,
    envelope(catalogProviderStatusSchema),
  );

export const setCatalogApiKey = (apiKey: string) =>
  call<boolean>(
    "catalog_set_api_key",
    { request: { apiKey } },
    envelope(z.boolean()),
  );

export const syncCatalog = (request: CatalogSyncRequest = {}) =>
  call<CatalogSyncResult>(
    "catalog_sync",
    { request },
    envelope(catalogSyncResultSchema),
  );
