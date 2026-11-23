import type {
  GameDetail,
  JobSummary,
  ManifestSummary,
  ProviderInfo,
  FixRecord,
  LuaDocument,
} from "@/contracts";

export interface DemoGame extends GameDetail {
  genre: string;
  palette: string;
  monogram: string;
  hours: number;
  demoInstalled: boolean;
  size: string;
  tagline: string;
}

const titles = [
  [
    "Aether Drift",
    "Exploration",
    "aether",
    "AD",
    42.6,
    true,
    "18.4 GB",
    "Find your orbit.",
    "Drift through the ruins of a forgotten solar system in this fictional exploration adventure.",
  ],
  [
    "Neon District",
    "Action",
    "neon",
    "ND",
    16.2,
    true,
    "32.1 GB",
    "After dark, come alive.",
    "A fictional city of midnight streets, electric skylines, and impossible escapes.",
  ],
  [
    "The Quiet Atlas",
    "Adventure",
    "atlas",
    "QA",
    8.4,
    true,
    "6.8 GB",
    "Every path tells a story.",
    "Map an imaginary world of mountain trails and quiet discoveries at your own pace.",
  ],
  [
    "Emberfall",
    "Role-playing",
    "ember",
    "EF",
    64.8,
    false,
    "41.2 GB",
    "From the ashes.",
    "Explore the fictional kingdom of Ashen Reach and choose which stories survive.",
  ],
  [
    "Orbital Echoes",
    "Strategy",
    "orbital",
    "OE",
    23.1,
    true,
    "12.6 GB",
    "Build beyond the horizon.",
    "Plan a fictional orbital settlement where every connection matters.",
  ],
  [
    "Verdant Valley",
    "Simulation",
    "verdant",
    "VV",
    5.7,
    false,
    "4.2 GB",
    "A little room to grow.",
    "Tend a fictional garden and create a slower rhythm in an illustrated countryside.",
  ],
] as const;

// Fictional identities and presentation-only installation examples. Canonical
// installed remains false: no actual local installation has been verified.
export const demoGames: DemoGame[] = titles.map(
  (
    [
      name,
      genre,
      palette,
      monogram,
      hours,
      demoInstalled,
      size,
      tagline,
      description,
    ],
    index,
  ) => ({
    appId: String(999999991 + index),
    name,
    genre,
    palette,
    monogram,
    hours,
    demoInstalled,
    size,
    tagline,
    description,
    artworkUrl: null,
    installed: false,
    installations: [],
    releaseDate: "2025-09-18",
    metadataSource: {
      providerId: "demo-catalog",
      fetchedAt: "2026-11-03T12:00:00Z",
      freshness: "unknown",
    },
  }),
);

export const demoManifests: ManifestSummary[] = demoGames
  .slice(0, 3)
  .map((game, i) => ({
    id: `demo-manifest-${i}`,
    appId: game.appId,
    depotId: null,
    kind: "appmanifest_acf",
    originalPath: `D:\\DemoLibrary\\steamapps\\appmanifest_${game.appId}.acf`,
    sha256: "a1b2c3d4".repeat(8),
    bytes: 232 + i * 80,
    inspectedAt: "2026-11-03T12:00:00Z",
  }));

export const demoLua: LuaDocument[] = demoGames.slice(0, 2).map((game, i) => ({
  id: `demo-lua-${i}`,
  appId: game.appId,
  managedPath: `DemoWorkspace/${game.name?.replaceAll(" ", "-").toLowerCase()}.lua`,
  sha256: "f1e2d3c4".repeat(8),
  provenance: "generated",
  updatedAt: "2026-11-03T12:00:00Z",
}));

export const demoProviders: ProviderInfo[] = [
  {
    id: "demo-catalog",
    displayName: "Sample game catalog",
    kind: "fixture",
    enabled: true,
    capabilities: ["catalog_search", "catalog_get"],
    documentationUrl: null,
    health: "healthy",
  },
  {
    id: "demo-local",
    displayName: "Sample local library",
    kind: "fixture",
    enabled: true,
    capabilities: ["file_import"],
    documentationUrl: null,
    health: "unchecked",
  },
];

export const demoFixes: FixRecord[] = [
  {
    id: "demo-fix-1",
    providerId: "demo-reference",
    appId: "999999991",
    title: "Ultrawide display reference",
    version: "1.2",
    approval: "manual_reference_only",
    compatibility: "unknown",
    checkedAt: null,
    canAutoApply: false,
  },
  {
    id: "demo-fix-2",
    providerId: "demo-reference",
    appId: "999999992",
    title: "Controller mapping reference",
    version: "0.9",
    approval: "unverified",
    compatibility: "unknown",
    checkedAt: null,
    canAutoApply: false,
  },
];

export const demoJobs: JobSummary[] = [
  {
    id: "demo-job-1",
    kind: "Library preview",
    appId: "999999991",
    status: "succeeded",
    progressPercent: 100,
    errorCode: null,
    createdAt: "2026-11-03T12:00:00Z",
    updatedAt: "2026-11-03T12:01:00Z",
  },
  {
    id: "demo-job-2",
    kind: "Catalog preview",
    appId: "999999992",
    status: "failed",
    progressPercent: 0,
    errorCode: "PROVIDER_UNAVAILABLE",
    createdAt: "2026-11-03T11:50:00Z",
    updatedAt: "2026-11-03T11:51:00Z",
  },
];

export const luaSample =
  '-- SYNTHETIC UI FIXTURE — not executed\nlocal game = {\n  app_id = "999999991",\n  title = "Aether Drift",\n  template = "metadata-preview"\n}\n\nreturn game\n';
export const manifestSample =
  '"AppState"\n{\n  "appid"      "999999991"\n  "name"       "Aether Drift (synthetic fixture)"\n  "installdir" "Aether Drift"\n  "buildid"    "demo-build-1042"\n}\n';
