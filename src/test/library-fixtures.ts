import type { LibrarySnapshot, LocalGameDetail } from "@/contracts";
const at = "2026-11-03T12:00:00Z";
export const localSnapshot: LibrarySnapshot = {
  games: [
    {
      appId: "123",
      name: "Local fixture game",
      artworkUrl: null,
      installed: true,
      installStatus: "verified_local",
      installationCount: 1,
      metadataSource: {
        providerId: "local-steam",
        fetchedAt: at,
        freshness: "unknown",
      },
    },
  ],
  roots: [
    {
      path: "E:\\OwnedSteam",
      source: "user_selected",
      status: "complete",
      lastScannedAt: at,
      attemptedAt: at,
      diagnostics: [],
    },
  ],
  lastScanAt: at,
};
export const localDetail: LocalGameDetail = {
  ...localSnapshot.games[0],
  description: null,
  releaseDate: null,
  installations: [
    {
      id: 1,
      appId: "123",
      libraryRoot: "E:\\OwnedSteam",
      installPath: "E:\\OwnedSteam\\steamapps\\common\\Fixture",
      buildId: "100",
      sourceAcfPath: "E:\\OwnedSteam\\steamapps\\appmanifest_123.acf",
      lastSeenAt: at,
      status: "verified_local",
      checkedAt: at,
    },
  ],
};
