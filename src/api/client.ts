import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import type { ApiResult, HealthResult, SteamHubCommands } from "@/contracts";

// Expose only commands implemented by this phase. Future contracts are not stubs.
export type ImplementedCommands = Pick<SteamHubCommands, "app_health">;

const healthEnvelope: z.ZodType<ApiResult<HealthResult>> = z.discriminatedUnion(
  "ok",
  [
    z.object({
      ok: z.literal(true),
      data: z.object({
        apiVersion: z.literal(1),
        databaseReady: z.boolean(),
        appVersion: z.string().min(1),
      }),
    }),
    z.object({
      ok: z.literal(false),
      error: z.object({
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
      }),
    }),
  ],
);

export async function getAppHealth(): Promise<
  ApiResult<ImplementedCommands["app_health"]["result"]>
> {
  if (!isTauri()) {
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message:
          "Desktop backend unavailable. Open SteamHub with npm run desktop:dev.",
        retryable: false,
      },
    };
  }

  try {
    const response = healthEnvelope.safeParse(
      await invoke<unknown>("app_health"),
    );
    if (!response.success) {
      return {
        ok: false,
        error: {
          code: "INTERNAL",
          message:
            "The desktop backend returned an incompatible health response.",
          retryable: false,
        },
      };
    }
    return response.data;
  } catch {
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: "Could not reach the desktop backend. Try checking again.",
        retryable: true,
      },
    };
  }
}
