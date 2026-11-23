/** SteamHub DTOs v1: design contracts, not automatically generated Rust types. */
export type AppId = string;   // normalized decimal digits, validated by backend
export type DepotId = string; // normalized decimal digits
export type ISODateTime = string;
export type UUID = string;

export type AppErrorCode =
  | 'INVALID_INPUT' | 'NOT_FOUND' | 'NO_STEAM_INSTALLATION'
  | 'IO_ERROR' | 'PERMISSION_DENIED' | 'PROVIDER_UNAVAILABLE'
  | 'RATE_LIMITED' | 'UNSUPPORTED_FORMAT' | 'UNTRUSTED_SOURCE'
  | 'INCOMPATIBLE_VERSION' | 'INTEGRITY_FAILURE'
  | 'ROLLBACK_REQUIRED' | 'CONFLICT' | 'CANCELLED' | 'INTERNAL';

export interface AppError {
  code: AppErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export interface SourceAttribution {
  providerId: string;
  fetchedAt: ISODateTime;
  freshness: 'fresh' | 'stale' | 'unknown';
  documentationUrl?: string;
}

export interface GameSummary {
  appId: AppId;
  name: string | null;
  artworkUrl: string | null;
  installed: boolean; // true only when local installation verified
  metadataSource: SourceAttribution | null;
}
export interface Installation {
  id: number;
  appId: AppId;
  libraryRoot: string;
  installPath: string;
  buildId: string | null;
  sourceAcfPath: string;
  lastSeenAt: ISODateTime;
}
export interface GameDetail extends GameSummary {
  description: string | null;
  releaseDate: string | null;
  installations: Installation[];
}

export interface ProviderInfo {
  id: string;
  displayName: string;
  kind: 'official' | 'community' | 'local' | 'fixture';
  enabled: boolean;
  capabilities: Array<'catalog_search' | 'catalog_get' | 'fix_list' | 'fix_download' | 'file_import'>;
  documentationUrl: string | null;
  health: 'healthy' | 'degraded' | 'unavailable' | 'unchecked';
}

export interface LuaDocument {
  id: UUID;
  appId: AppId | null;
  managedPath: string;
  sha256: string;
  provenance: 'imported' | 'generated';
  updatedAt: ISODateTime;
}
export interface ManifestSummary {
  id: UUID;
  appId: AppId | null;
  depotId: DepotId | null;
  kind: 'appmanifest_acf' | 'depot_manifest' | 'unknown';
  originalPath: string;
  sha256: string;
  bytes: number;
  inspectedAt: ISODateTime;
}

export interface FixRecord {
  id: string;
  providerId: string;
  appId: AppId;
  title: string;
  version: string | null;
  approval: 'unverified' | 'approved' | 'blocked' | 'manual_reference_only';
  compatibility: 'compatible' | 'incompatible' | 'unknown';
  checkedAt: ISODateTime | null;
  canAutoApply: boolean; // server-computed; UI must not override
}
export interface FixPlan {
  fixId: string;
  installationId: number;
  expectedWrites: string[];
  backupBytes: number;
  permitted: boolean;
  blockingReasons: string[];
  requiresConfirmation: boolean;
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export interface JobSummary {
  id: UUID;
  kind: string;
  appId: AppId | null;
  status: JobStatus;
  progressPercent: number;
  errorCode: AppErrorCode | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
export type JobEvent =
  | { type: 'progress'; job: JobSummary }
  | { type: 'finished'; job: JobSummary }
  | { type: 'log'; jobId: UUID; message: string; at: ISODateTime };

export interface LibraryScanRequest { rootPaths?: string[]; force?: boolean }
export interface CatalogSearchRequest { query: string; limit?: number; cursor?: string }
export interface CatalogGameSummary extends GameSummary {
  itemType?: string | null;
  lastModifiedUnix?: number | null;
}
export interface CatalogSearchResult {
  games: CatalogGameSummary[];
  nextCursor: string | null;
  origin: 'live' | 'cache' | 'local';
  stale: boolean;
  providerId: string | null;
  providerStatus: 'ready' | 'needs_configuration' | 'offline' | 'rate_limited' | 'failed';
}
export interface CatalogGameDetail extends Omit<GameDetail, 'installations'> {
  itemType?: string | null;
  shortDescription?: string | null;
  website?: string | null;
  headerImage?: string | null;
  capsuleImage?: string | null;
  genres: string[];
  localInstallations: LocalInstallation[];
  localInstallationDerived: boolean;
}
export interface CatalogProviderStatus {
  id: string;
  displayName: string;
  kind: 'official' | 'community' | 'local' | 'fixture';
  enabled: boolean;
  documentationUrl: string | null;
  capabilities: string[];
  status: 'ready' | 'needs_configuration' | 'offline' | 'rate_limited' | 'failed';
  lastSyncTime: string | null;
  setupNeeded: boolean;
  lastRedactedError: string | null;
}
export interface CatalogSetApiKeyRequest {
  apiKey: string;
}
export interface CatalogSyncRequest {
  resume?: boolean;
}
export interface CatalogSyncResult {
  status: string;
  processed: number;
  message: string;
}
export interface HealthResult { apiVersion: 1; databaseReady: boolean; appVersion: string }

// P04: synchronous read-only discovery. No durable job is claimed before P11.
export type InstallStatus = 'verified_local' | 'absent' | 'not_checked' | 'scan_failed';
export interface ScanDiagnostic { code: string; message: string; path: string }
export interface LibraryRootStatus {
  path: string; source: 'detected' | 'user_selected';
  status: 'complete' | 'partial' | 'failed' | 'not_checked';
  lastScannedAt: ISODateTime | null; attemptedAt: ISODateTime | null;
  diagnostics: ScanDiagnostic[];
}
export interface LocalGameSummary extends GameSummary {
  metadataSource: SourceAttribution;
  installStatus: InstallStatus; installationCount: number;
}
export interface LocalInstallation extends Installation {
  status: InstallStatus; checkedAt: ISODateTime | null;
}
export interface LocalGameDetail extends Omit<GameDetail, 'installations'> {
  metadataSource: SourceAttribution;
  installStatus: InstallStatus; installationCount: number;
  installations: LocalInstallation[];
}
export interface LibrarySnapshot {
  games: LocalGameSummary[]; roots: LibraryRootStatus[]; lastScanAt: ISODateTime | null;
}
export interface LibraryScanResult {
  snapshot: LibrarySnapshot; verifiedInstallations: number;
  observedInstallations: number; diagnosticCount: number;
}

/** Proposed call names; implementation must use explicit Rust-side validation. */
export interface SteamHubCommands {
  app_health: { args: undefined; result: HealthResult };
  library_scan: { args: LibraryScanRequest; result: LibraryScanResult };
  library_list: { args: undefined; result: LibrarySnapshot };
  library_get: { args: { appId: AppId }; result: LocalGameDetail };
  catalog_search: { args: { request: CatalogSearchRequest }; result: CatalogSearchResult };
  catalog_get: { args: { appId: AppId }; result: CatalogGameDetail };
  catalog_provider_status: { args: undefined; result: CatalogProviderStatus[] };
  catalog_set_api_key: { args: { request: CatalogSetApiKeyRequest }; result: boolean };
  catalog_sync: { args: { request?: CatalogSyncRequest }; result: CatalogSyncResult };
  manifest_list: { args: { appId?: AppId }; result: ManifestSummary[] };
  fix_list: { args: { appId: AppId }; result: FixRecord[] };
  fix_plan: { args: { fixId: string; installationId: number }; result: FixPlan };
  job_list: { args: undefined; result: JobSummary[] };
}
