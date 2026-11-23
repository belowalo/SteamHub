import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import type {
  ApiResult,
  LibrarySnapshot,
  LocalGameDetail,
  LibraryScanResult,
  LibraryScanRequest,
} from "@/contracts";

const appId = z.string().regex(/^[1-9][0-9]{0,19}$/);
const stamp = z.iso.datetime();
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
const source = z.object({
  providerId: z.literal("local-steam"),
  fetchedAt: stamp,
  freshness: z.literal("unknown"),
});
const summaryShape = {
  appId,
  name: z.string().nullable(),
  artworkUrl: z.null(),
  installed: z.boolean(),
  metadataSource: source,
  installStatus: status,
  installationCount: z.number().int().nonnegative(),
};
const summary = z
  .object(summaryShape)
  .refine(
    (game) => game.installed === (game.installStatus === "verified_local"),
  );
const installation = z.object({
  id: z.number().int().positive(),
  appId,
  libraryRoot: z.string(),
  installPath: z.string(),
  buildId: z.string().nullable(),
  sourceAcfPath: z.string(),
  lastSeenAt: stamp,
  status,
  checkedAt: stamp.nullable(),
});
const root = z.object({
  path: z.string(),
  source: z.enum(["detected", "user_selected"]),
  status: z.enum(["complete", "partial", "failed", "not_checked"]),
  lastScannedAt: stamp.nullable(),
  attemptedAt: stamp.nullable(),
  diagnostics: z.array(
    z.object({ code: z.string(), message: z.string(), path: z.string() }),
  ),
});
export const librarySnapshotSchema = z.object({
  games: z.array(summary),
  roots: z.array(root),
  lastScanAt: stamp.nullable(),
});
const detail = z
  .object({
    ...summaryShape,
    description: z.null(),
    releaseDate: z.null(),
    installations: z.array(installation),
  })
  .refine(
    (game) =>
      game.installed ===
        game.installations.some(
          (installation) => installation.status === "verified_local",
        ) &&
      game.installed === (game.installStatus === "verified_local") &&
      game.installationCount === game.installations.length &&
      game.installations.every(
        (installation) => installation.appId === game.appId,
      ),
  );
const scan = z.object({
  snapshot: librarySnapshotSchema,
  verifiedInstallations: z.number().int().nonnegative(),
  observedInstallations: z.number().int().nonnegative(),
  diagnosticCount: z.number().int().nonnegative(),
});
function envelope<T>(data: z.ZodType<T>) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error }),
  ]);
}
async function call<T>(
  command: "library_scan" | "library_list" | "library_get",
  args: Record<string, unknown> | undefined,
  schema: z.ZodType<ApiResult<T>>,
): Promise<ApiResult<T>> {
  if (!isTauri())
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message:
          "Local library requires the SteamHub desktop backend. Demo mode remains available.",
        retryable: false,
      },
    };
  try {
    const result = schema.safeParse(await invoke<unknown>(command, args));
    return result.success
      ? result.data
      : {
          ok: false,
          error: {
            code: "INTERNAL",
            message: "The library backend returned an incompatible response.",
            retryable: false,
          },
        };
  } catch {
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message:
          "Could not reach the local library backend. Retry the operation.",
        retryable: true,
      },
    };
  }
}
export const listLibrary = () =>
  call<LibrarySnapshot>(
    "library_list",
    undefined,
    envelope(librarySnapshotSchema),
  );
export const scanLibrary = (request: LibraryScanRequest = {}) =>
  call<LibraryScanResult>("library_scan", { request }, envelope(scan));
export const getLocalGame = (id: string) =>
  call<LocalGameDetail>("library_get", { appId: id }, envelope(detail));
