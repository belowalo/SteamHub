import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import { listen } from "@tauri-apps/api/event";

export const managedFileSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string(),
  extension: z.enum(["lua", "acf", "vdf", "manifest"]),
  size: z.number().int().positive(),
  appId: z.string().nullable(),
  source: z.string(),
  version: z.string(),
  importedAt: z.string(),
  warnings: z.array(z.string()),
});
const settingsSchema = z.object({
  theme: z.enum(["dark", "light"]),
  scanOnStart: z.boolean(),
  storeCountry: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
});
export const workspaceSchema = z.object({
  luaApps: z.array(z.string()).optional(),
  files: z.array(managedFileSchema),
  activity: z.array(
    z.object({
      id: z.number(),
      kind: z.string(),
      status: z.string(),
      message: z.string(),
      createdAt: z.string(),
    }),
  ),
  notes: z.array(
    z.object({ appId: z.string(), body: z.string(), updatedAt: z.string() }),
  ),
  settings: settingsSchema,
  dataDirectory: z.string(),
  logFile: z.string(),
  busy: z.boolean(),
});
export type ManagedFile = z.infer<typeof managedFileSchema>;
export const shortcutsSchema = z.object({
  shortcuts: z.array(
    z.object({
      name: z.string(),
      executable: z.string(),
      startDirectory: z.string(),
      userId: z.string(),
      sourceFile: z.string(),
    }),
  ),
  diagnostics: z.array(z.string()),
});
export const getShortcuts = () =>
  nativeCall("library_shortcuts", {}, shortcutsSchema);
export type WorkspaceSnapshot = z.infer<typeof workspaceSchema>;
export type WorkspaceSettings = z.infer<typeof settingsSchema>;
export type WorkspaceAction =
  "import" | "restore" | "backup" | "export" | "delete" | "verify" | "report";
export const operationSchema = z.object({
  processed: z.number(),
  skipped: z.number(),
  errors: z.array(z.string()),
  output: z.string().nullable(),
  cancelled: z.boolean(),
});
export type OperationResult = z.infer<typeof operationSchema>;

export async function nativeCall<T>(
  command: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!isTauri())
    throw new Error(
      "Open the SteamHub desktop application to use native services.",
    );
  const result = z
    .discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), data: schema }),
      z.object({
        ok: z.literal(false),
        error: z.object({
          code: z.string(),
          message: z.string(),
          retryable: z.boolean(),
        }),
      }),
    ])
    .safeParse(await invoke<unknown>(command, args));
  if (!result.success)
    throw new Error(
      "The desktop returned an incompatible response. Restart SteamHub.",
    );
  if (!result.data.ok)
    throw new Error(`${result.data.error.code}: ${result.data.error.message}`);
  return result.data.data;
}
export const loadWorkspace = () =>
  nativeCall("workspace_snapshot", {}, workspaceSchema);
const generatedLuaSchema = z.object({
  text: z.string(),
  filename: z.string(),
  installedPath: z.string().nullable(),
  manifests: z.array(
    z.object({
      name: z.string(),
      size: z.number().int().nonnegative(),
      sha256: z.string(),
    }),
  ),
  warnings: z.array(z.string()),
});
const lookupSchema = z.object({
  id: z.string(),
  app: z.string(),
  source: z.string(),
  generated: generatedLuaSchema,
  steamRoot: z.string().nullable(),
});
export type GameDataLookup = z.infer<typeof lookupSchema>;
const dataSourceSchema = z.object({
  name: z.string(),
  urlTemplate: z.string(),
  format: z.enum(["zip", "lua"]),
  enabled: z.boolean(),
  kind: z.string().default("custom"),
  hasCredential: z.boolean().default(false),
});
export type GameDataSource = z.infer<typeof dataSourceSchema>;
export const gameDataSources = (sources: GameDataSource[] | null = null) =>
  nativeCall("game_data_sources", { sources }, z.array(dataSourceSchema));
export const setGameDataCredential = (provider: string, key: string | null) =>
  nativeCall("game_data_credential", { provider, key }, z.boolean());
export const importGameData = (app: string) =>
  nativeCall(
    "steamtools_import_lookup",
    { app, path: null },
    lookupSchema.nullable(),
  );
const lookupProgressSchema = z.object({
  requestId: z.string(),
  app: z.string(),
  index: z.number().int().nonnegative(),
  source: z.string(),
  status: z.enum(["trying", "validating", "ready", "failed", "skipped"]),
  detail: z.string(),
});
export type LookupProgress = z.infer<typeof lookupProgressSchema>;
export async function lookupGameData(
  app: string,
  onProgress?: (event: LookupProgress) => void,
) {
  if (!onProgress)
    return nativeCall("steamtools_lookup", { app }, lookupSchema);
  const requestId = crypto.randomUUID();
  let stop: (() => void) | undefined;
  try {
    stop = await listen<unknown>("steamhub:lookup-progress", (event) => {
      const parsed = lookupProgressSchema.safeParse(event.payload);
      if (
        parsed.success &&
        parsed.data.requestId === requestId &&
        parsed.data.app === app
      )
        onProgress(parsed.data);
    }).catch(() => undefined);
    return await nativeCall(
      "steamtools_lookup",
      { app, requestId },
      lookupSchema,
    );
  } finally {
    stop?.();
  }
}
export const addGameData = (id: string, steamRoot: string) =>
  nativeCall("steamtools_add", { id, steamRoot }, generatedLuaSchema);
export const configureManifestProvider = (
  base: string,
  steamRoot: string | null = null,
) => nativeCall("steamtools_provider", { base, steamRoot }, generatedLuaSchema);
export const generateSteamTools = (
  app: string,
  depots: string,
  dlcs: string,
  steamRoot: string | null = null,
  deploy = false,
) =>
  nativeCall(
    "steamtools_generate",
    { app, depots, dlcs, steamRoot, deploy },
    generatedLuaSchema,
  );
export const runWorkspace = (
  action: WorkspaceAction,
  ids: string[] = [],
  paths: string[] = [],
) =>
  nativeCall(
    "workspace_operation",
    { request: { action, ids, paths } },
    operationSchema,
  );
export const cancelWorkspace = () =>
  nativeCall("workspace_cancel", {}, z.boolean());
export const saveSettings = (settings: WorkspaceSettings) =>
  nativeCall("workspace_settings", { settings }, z.boolean());
export const associateFile = (
  id: string,
  app: string,
  source: string,
  version: string,
) =>
  nativeCall("workspace_associate", { id, app, source, version }, z.boolean());
export const readManagedFile = (id: string) =>
  nativeCall("workspace_read", { id }, z.string());
export const saveCompatibilityNote = (app: string, body: string) =>
  nativeCall("workspace_note", { app, body }, z.boolean());
export const selectLibraryFolder = () =>
  nativeCall("select_library_folder", {}, z.string().nullable());
export const openReference = (url: string) =>
  nativeCall("open_reference", { url }, z.boolean());
export const steamAction = (
  app: string,
  action: "launch" | "verify" | "properties" | "library",
) => nativeCall("steam_action", { app, action }, z.boolean());
export const openWorkspaceFolder = (logs = false) =>
  nativeCall("open_workspace_folder", { logs }, z.boolean());
export const createManagedFile = (
  name: string,
  text: string,
  app: string,
  source: string,
  version: string,
) =>
  nativeCall(
    "workspace_create",
    { name, text, app, source, version },
    z.boolean(),
  );

export const steamRuntime = (
  action: "status" | "install" | "undo",
  steamRoot?: string,
) =>
  nativeCall(
    "steam_runtime",
    { action, steamRoot: steamRoot ?? null },
    z.object({
      steamRoot: z.string(),
      installed: z.boolean(),
      canUndo: z.boolean(),
    }),
  );

const fixDiscoverySchema = z.object({
  appId: z.string(),
  sourceUrl: z.string().url(),
  warnings: z.array(z.string()),
  providerError: z.string().nullable(),
  fixes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      hasFix: z.boolean(),
      tags: z.array(z.object({ name: z.string(), slug: z.string() })),
    }),
  ),
});
export const discoverOnlineFixes = (app: string) =>
  nativeCall("online_fix_discover", { app }, fixDiscoverySchema);
export type FixDiscovery = z.infer<typeof fixDiscoverySchema>;

const fixPlanSchema = z.object({
  id: z.string(),
  appId: z.string(),
  installPath: z.string(),
  destinationPrefix: z.string().optional(),
  files: z.array(
    z.object({
      name: z.string(),
      size: z.number(),
      before: z.string().nullable(),
      after: z.string(),
    }),
  ),
});
export type FixPlan = z.infer<typeof fixPlanSchema>;
export const onlineFixOperation = (
  app: string,
  action: "preview" | "apply" | "undo",
  id?: string,
) =>
  nativeCall(
    "online_fix_operation",
    { app, action, id: id ?? null },
    fixPlanSchema.nullable(),
  );

export const onlineFixStatus = (app: string) =>
  nativeCall(
    "online_fix_status",
    { app },
    z.object({ installed: z.boolean(), canUndo: z.boolean() }),
  );

export const onlineFixGames = (refresh = false) =>
  nativeCall(
    "online_fix_games",
    { refresh },
    z.object({ apps: z.array(z.string()), unknown: z.array(z.string()) }),
  );

export const getLuaLibrary = () =>
  nativeCall(
    "lua_library",
    {},
    z.array(z.object({ appId: z.string(), name: z.string().nullable() })),
  );

const luaRemovalSchema = z.object({
  id: z.string(),
  app: z.string(),
  name: z.string(),
  files: z.array(z.object({ path: z.string(), size: z.number() })),
  blocked: z.array(z.string()),
  canUndo: z.boolean(),
});
export type LuaRemovalPlan = z.infer<typeof luaRemovalSchema>;
export const luaRemoval = (
  action: "preview" | "apply" | "undo" | "history",
  app: string | null = null,
  name: string | null = null,
  id: string | null = null,
) =>
  nativeCall(
    "lua_removal",
    { action, app, name, id },
    z.array(luaRemovalSchema),
  );

const launchResultSchema = z.enum(["untested", "launched", "failed"]);
const personalLaunchSchema = z.object({
  result: launchResultSchema,
  note: z.string(),
  updatedAt: z.number().nullable(),
  build: z.string(),
});
const compatibilitySchema = z.object({
  checkedAt: z.number().nullable(),
  complete: z.boolean(),
  requirements: z.array(
    z.object({ kind: z.string(), detail: z.string(), source: z.string() }),
  ),
});
const gameStatusSchema = z.object({
  appId: z.string(),
  lua: z.boolean(),
  installation: z.string(),
  runtime: z.boolean().nullable(),
  fix: z.enum(["verified", "changed", "not_applied", "not_checked"]),
  compatibility: compatibilitySchema,
  stale: z.boolean(),
  personal: personalLaunchSchema,
  reportOutdated: z.boolean(),
});
export type GameStatus = z.infer<typeof gameStatusSchema>;
export type LaunchResult = z.infer<typeof launchResultSchema>;
export const getGameStatus = (app: string, refresh = false) =>
  nativeCall("game_status", { app, refresh }, gameStatusSchema);
export const saveLaunchReport = (
  app: string,
  result: LaunchResult,
  note: string,
) =>
  nativeCall("game_launch_report", { app, result, note }, personalLaunchSchema);
const statusSummarySchema = gameStatusSchema.pick({
  appId: true,
  compatibility: true,
  stale: true,
  personal: true,
});
export type GameStatusSummary = z.infer<typeof statusSummarySchema>;
export const getGameStatusSummaries = (apps: string[]) =>
  nativeCall("game_status_summaries", { apps }, z.array(statusSummarySchema));
