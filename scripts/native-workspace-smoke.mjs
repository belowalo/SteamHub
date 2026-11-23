import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
const require = createRequire(import.meta.url);
const output = resolve("test-results/native-workspace");
const profile = join(output, `profile-${Date.now()}`);
await mkdir(profile, { recursive: true });
const executable = resolve(
  process.env.STEAMHUB_SMOKE_BINARY ?? "src-tauri/target/release/steamhub.exe",
);
const driver = spawn(
  process.env.STEAMHUB_TAURI_DRIVER ??
    (existsSync(".tools/bin/tauri-driver.exe")
      ? resolve(".tools/bin/tauri-driver.exe")
      : "tauri-driver"),
  [
    "--port",
    "4444",
    ...(process.env.STEAMHUB_EDGE_DRIVER
      ? ["--native-driver", process.env.STEAMHUB_EDGE_DRIVER]
      : existsSync(".tools/edgedriver/msedgedriver.exe")
        ? ["--native-driver", resolve(".tools/edgedriver/msedgedriver.exe")]
        : []),
  ],
  {
    windowsHide: true,
    stdio: "inherit",
    env: { ...process.env, STEAMHUB_PROFILE_DIR: profile },
  },
);
let driverError;
driver.on("error", (e) => (driverError = e));
let session;
const base = "http://127.0.0.1:4444";
const checks = [];
const screenshots = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function request(path, method = "GET", body) {
  const r = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(110000),
  });
  const json = await r.json();
  if (!r.ok || typeof json.value?.error === "string")
    throw Error(JSON.stringify(json));
  return json.value;
}
async function execute(script, args = []) {
  return request(`/session/${session}/execute/sync`, "POST", { script, args });
}
async function invoke(command, args = {}) {
  return request(`/session/${session}/execute/async`, "POST", {
    script:
      "const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(done,e=>done({transportError:String(e)}));",
    args: [command, args],
  });
}
async function ready(script) {
  for (let i = 0; i < 120; i++) {
    if (await execute(script)) return;
    await pause(150);
  }
  throw Error(`Timeout: ${script}`);
}
function success(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}
async function screenshot(name) {
  const p = join(output, `${name}.png`);
  await writeFile(
    p,
    Buffer.from(await request(`/session/${session}/screenshot`), "base64"),
  );
  screenshots.push(p);
}
async function start() {
  const r = await request("/session", "POST", {
    capabilities: {
      alwaysMatch: { "tauri:options": { application: executable } },
    },
  });
  session = r.sessionId;
  await ready(
    "return !!window.__TAURI_INTERNALS__ && !!document.querySelector('main h1')",
  );
  await request(`/session/${session}/timeouts`, "POST", { script: 100000 });
}
try {
  for (let i = 0; i < 100; i++) {
    if (driverError) throw driverError;
    try {
      await request("/status");
      break;
    } catch (e) {
      if (i === 99) throw e;
      await pause(150);
    }
  }
  await start();
  assert.equal(success(await invoke("app_health")).databaseReady, true);
  checks.push(
    "Release executable starts with embedded frontend and real SQLite IPC",
  );
  const first = success(await invoke("workspace_snapshot"));
  assert.equal(first.files.length, 0);
  assert.equal(first.dataDirectory, profile);
  checks.push("Isolated profile preserves the user's existing workspace");
  const source = join(profile, "620.lua");
  const body = "-- Native test: inert configuration\nreturn {enabled=true}\n";
  await writeFile(source, body);
  await writeFile(join(profile, "invalid.lua"), "function !!!");
  await writeFile(
    join(profile, "sample.manifest"),
    Buffer.from([0, 1, 2, 3, 4, 5]),
  );
  let imported = success(
    await invoke("workspace_operation", {
      request: {
        action: "import",
        paths: [
          source,
          join(profile, "invalid.lua"),
          join(profile, "sample.manifest"),
        ],
        ids: [],
      },
    }),
  );
  assert.equal(imported.processed, 2);
  assert.equal(imported.errors.length, 1);
  const files = success(await invoke("workspace_snapshot")).files;
  const lua = files.find((f) => f.extension === "lua");
  assert.equal(lua.id, createHash("sha256").update(body).digest("hex"));
  assert.equal(lua.appId, "620");
  assert.equal(success(await invoke("workspace_read", { id: lua.id })), body);
  checks.push(
    "Real file import validates Lua, handles opaque manifests, hashes bytes, and reads previews",
  );
  imported = success(
    await invoke("workspace_operation", {
      request: { action: "import", paths: [source], ids: [] },
    }),
  );
  assert.equal(imported.skipped, 1);
  assert.equal(await readFile(source, "utf8"), body);
  checks.push("Duplicate detection preserves original source bytes");
  success(
    await invoke("workspace_associate", {
      id: lua.id,
      app: "620",
      source: "Native QA",
      version: "v2",
    }),
  );
  success(
    await invoke("workspace_create", {
      name: "edited.lua",
      text: "return {enabled=false}",
      app: "620",
      source: "Native QA",
      version: "v3",
    }),
  );
  success(
    await invoke("workspace_note", {
      app: "620",
      body: "Native QA compatibility note",
    }),
  );
  success(
    await invoke("workspace_settings", {
      settings: { theme: "light", scanOnStart: false },
    }),
  );
  checks.push(
    "Real metadata edits, immutable text versions, notes and persistent settings",
  );
  const verified = success(
    await invoke("workspace_operation", {
      request: { action: "verify", paths: [], ids: [] },
    }),
  );
  assert.equal(verified.processed, 3);
  assert.equal(verified.errors.length, 0);
  checks.push("Whole-vault integrity verification");
  const scan = success(await invoke("library_scan"));
  assert.ok(scan.snapshot.roots.length);
  checks.push(
    `Read-only real Steam scan: ${scan.verifiedInstallations} verified installations`,
  );
  const shortcuts = success(await invoke("library_shortcuts"));
  assert.ok(Array.isArray(shortcuts.shortcuts));
  checks.push(
    `Separate non-Steam shortcut scan: ${shortcuts.shortcuts.length} records`,
  );
  const search = success(
    await invoke("catalog_search", {
      request: { query: "Portal 2", limit: 10 },
    }),
  );
  assert.ok(
    search.games.some((g) => g.appId === "620"),
    JSON.stringify(search),
  );
  const detail = success(await invoke("catalog_get", { appId: "620" }));
  assert.equal(detail.appId, "620");
  checks.push(
    "Live Steam title search and AppID details through native provider",
  );
  const rejected = await invoke("open_reference", {
    url: "https://evil.invalid/",
  });
  assert.equal(rejected.ok, false);
  checks.push("External opener rejects unapproved URLs");
  await execute("location.reload()");
  await ready(
    "return document.querySelector('main h1')?.textContent==='Add a game'",
  );
  await pause(700);
  const axe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
  const accessibility = [];
  await request(`/session/${session}/window/rect`, "POST", {
    width: 1440,
    height: 900,
  });
  for (const page of [
    "dashboard",
    "library",
    "search",
    "lua",
    "manifests",
    "sources",
    "online-fixes",
    "activity",
    "tools",
    "settings",
  ]) {
    await execute("location.hash=arguments[0]", [`#/${page}`]);
    await ready(
      `return document.querySelector('main')?.dataset.route===${JSON.stringify(page)} && !!document.querySelector('main h1')`,
    );
    await pause(400);
    if (page === "library") {
      await ready(
        "return [...document.querySelectorAll('.library-artwork img')].some(image=>image.complete && image.naturalWidth>0)",
      );
      checks.push("Game Library loaded actual artwork from Steam CDN");
    }
    await execute(axe);
    const result = await request(`/session/${session}/execute/async`, "POST", {
      script:
        "const done=arguments[arguments.length-1];axe.run(document.querySelector('main'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}).then(r=>done(r.violations.map(v=>({id:v.id,description:v.description,nodes:v.nodes.map(n=>n.target)}))),e=>done({error:String(e)}));",
      args: [],
    });
    accessibility.push({ page, violations: result });
    assert.deepEqual(result, [], `Accessibility: ${page}`);
    assert.ok(
      await execute(
        "return document.documentElement.scrollWidth<=innerWidth+1 && document.querySelector('main').scrollWidth<=document.querySelector('main').clientWidth+1",
      ),
      `Overflow: ${page}`,
    );
    await screenshot(page);
  }
  checks.push(
    "All 10 production pages render without horizontal overflow or WCAG A/AA axe violations at 1440×900",
  );
  await execute("location.hash='#/library'");
  await ready(
    "return document.querySelector('main h1')?.textContent==='Game Library'",
  );
  await execute(
    "document.querySelector('[aria-label=\"Table view\"]').click()",
  );
  await ready(
    "return [...document.querySelectorAll('.library-artwork-thumb img')].some(image=>image.complete && image.naturalWidth>0)",
  );
  await screenshot("library-table");
  checks.push("Game Library table also loaded Steam artwork thumbnails");
  await request(`/session/${session}/window/rect`, "POST", {
    width: 960,
    height: 640,
  });
  await execute("location.hash='#/lua'");
  await pause(400);
  assert.ok(
    await execute(
      "return document.documentElement.scrollWidth<=innerWidth+1 && document.querySelector('main').scrollWidth<=document.querySelector('main').clientWidth+1",
    ),
  );
  await screenshot("lua-small");
  const gaps = await execute(
    `const section=document.querySelector('[aria-label="Add a game to Steam"]'); const field=section.querySelector('input'); const label=field.closest('label'); const button=section.querySelector('button'); return {labelGap:field.getBoundingClientRect().top-label.getBoundingClientRect().top, actionGap:button.getBoundingClientRect().top-field.getBoundingClientRect().bottom, chromeRemoved:!document.querySelector('.topbar,.workspace-switcher,.sidebar-footer')};`,
  );
  assert.ok(gaps.labelGap >= 24, JSON.stringify(gaps));
  assert.ok(gaps.actionGap >= 12, JSON.stringify(gaps));
  assert.equal(gaps.chromeRemoved, true);
  success(
    await invoke("workspace_settings", {
      settings: { theme: "dark", scanOnStart: false },
    }),
  );
  await execute("location.reload()");
  await ready(
    "return document.querySelector('main h1')?.textContent==='Lua Studio'",
  );
  await pause(400);
  await screenshot("lua-dark");
  await execute("location.hash='#/dashboard'");
  await ready(
    "return document.querySelector('main h1')?.textContent==='Add a game'",
  );
  await screenshot("home-dark");
  success(
    await invoke("workspace_settings", {
      settings: { theme: "light", scanOnStart: false },
    }),
  );
  checks.push(
    "Removed production chrome; native label/control and control/button gaps verified; dark home/Lua screenshots captured",
  );
  checks.push("960×640 native layout");
  await request(`/session/${session}`, "DELETE");
  session = undefined;
  await start();
  const restored = success(await invoke("workspace_snapshot"));
  assert.equal(restored.files.length, 3);
  assert.equal(restored.settings.theme, "light");
  assert.equal(restored.notes[0].body, "Native QA compatibility note");
  assert.ok(restored.activity.length >= 4);
  checks.push(
    "Real application restart preserves configurations, notes, activity and preferences",
  );
  const steamFixture = join(profile, "steam-fixture");
  const defaults = success(
    await invoke("game_data_sources", { sources: null }),
  );
  assert.equal(defaults.length, 10);
  assert.deepEqual(
    defaults
      .filter((source) => source.kind !== "custom")
      .map((source) => source.kind),
    [
      "hubcap",
      "ryuu",
      "manifestdex",
      "catmisteam",
      "openlua",
      "luatools",
      "manifesthub",
    ],
  );
  const fixtureKey = "qa-only-not-a-real-api-key";
  try {
    success(
      await invoke("game_data_credential", {
        provider: "ryuu",
        key: fixtureKey,
      }),
    );
    let saved = success(await invoke("game_data_sources", { sources: null }));
    assert.equal(
      saved.find((source) => source.kind === "ryuu").hasCredential,
      true,
    );
    assert.ok(!JSON.stringify(saved).includes(fixtureKey));
    await request(`/session/${session}`, "DELETE");
    session = null;
    await start();
    saved = success(await invoke("game_data_sources", { sources: null }));
    assert.equal(
      saved.find((source) => source.kind === "ryuu").hasCredential,
      true,
    );
    assert.ok(
      !JSON.stringify(success(await invoke("workspace_snapshot"))).includes(
        fixtureKey,
      ),
    );
  } finally {
    if (session)
      success(
        await invoke("game_data_credential", { provider: "ryuu", key: null }),
      );
  }
  const custom = [
    {
      name: "Example Lua feed",
      urlTemplate: "https://example.com/{appid}.lua",
      format: "lua",
      enabled: false,
    },
    ...defaults,
  ];
  success(await invoke("game_data_sources", { sources: custom }));
  assert.equal(
    success(await invoke("game_data_sources", { sources: null }))[0].name,
    "Example Lua feed",
  );
  success(await invoke("game_data_sources", { sources: defaults }));
  await mkdir(join(steamFixture, "depotcache"), { recursive: true });
  await writeFile(join(steamFixture, "steam.exe"), "fixture only");
  await writeFile(join(steamFixture, "OpenSteamTool.dll"), "fixture only");
  await writeFile(join(steamFixture, "dwmapi.dll"), "fixture only");
  await writeFile(
    join(steamFixture, "depotcache", "621_18446744073709551615.manifest"),
    "opaque manifest fixture",
  );
  const runtimeStatus = success(
    await invoke("steam_runtime", {
      action: "status",
      steamRoot: steamFixture,
    }),
  );
  assert.equal(runtimeStatus.installed, true);
  assert.equal(runtimeStatus.canUndo, false);
  checks.push(
    "Runtime detection command recognizes a complete fixture without modifying it",
  );
  const generatorArgs = {
    app: "620",
    depots: `621,${"ab".repeat(32)},18446744073709551615`,
    dlcs: "622",
    steamRoot: steamFixture,
    deploy: false,
  };
  const generated = success(await invoke("steamtools_generate", generatorArgs));
  assert.ok(
    !success(await invoke("workspace_snapshot")).luaApps.includes("620"),
    "Preview must not mark a Lua deployment",
  );
  assert.ok(
    generated.text.includes('setManifestid(621,"18446744073709551615")'),
  );
  assert.equal(generated.manifests.length, 1);
  const installed = success(
    await invoke("steamtools_generate", { ...generatorArgs, deploy: true }),
  );
  assert.equal(await readFile(installed.installedPath, "utf8"), generated.text);
  assert.ok(
    success(await invoke("workspace_snapshot")).luaApps.includes("620"),
    "Successful deployment must mark the Lua method",
  );
  const ownedFix = await invoke("online_fix_discover", { app: "570" });
  assert.equal(ownedFix.ok, false);
  assert.equal(ownedFix.error.code, "NOT_FOUND");
  checks.push(
    "Lua eligibility follows successful deployment, not previews, vault imports or local ownership; native discovery rejects other games",
  );
  success(
    await invoke("steamtools_generate", { ...generatorArgs, deploy: true }),
  );
  const changed = await invoke("steamtools_generate", {
    ...generatorArgs,
    depots: `621,${"cd".repeat(32)}`,
    deploy: true,
  });
  assert.equal(changed.ok, false);
  assert.equal(await readFile(installed.installedPath, "utf8"), generated.text);
  assert.ok(
    success(await invoke("workspace_snapshot")).luaApps.includes("620"),
    "Successful deployment must mark the Lua method",
  );
  const adapter = success(
    await invoke("steamtools_provider", {
      base: "https://manifest.manifestdex.com/",
      steamRoot: steamFixture,
    }),
  );
  assert.ok(
    (await readFile(adapter.installedPath, "utf8")).includes("ManifestDeX/1.0"),
  );
  assert.equal(
    (
      await invoke("steamtools_provider", {
        base: "http://example.com/",
        steamRoot: null,
      })
    ).ok,
    false,
  );
  const afterGeneration = success(await invoke("workspace_snapshot"));
  assert.ok(
    afterGeneration.files.some(
      (f) => f.name === "621_18446744073709551615.manifest",
    ),
  );
  checks.push(
    "Native generator preview/deployment, exact uint64 IDs, manifest vault import, idempotence, conflict preservation, and replaceable request-code adapter (isolated Steam fixture)",
  );
  const localLua = join(profile, "local-game-data.lua");
  await writeFile(
    localLua,
    `addappid(630)\naddappid(631,1,"${"ab".repeat(32)}")\nos.execute("never")\n`,
  );
  const luaLookup = success(
    await invoke("steamtools_import_lookup", { app: "630", path: localLua }),
  );
  assert.ok(luaLookup.generated.text.includes("addappid(630)"));
  assert.ok(!luaLookup.generated.text.includes("execute"));
  const importedInstalled = success(
    await invoke("steamtools_add", {
      id: luaLookup.id,
      steamRoot: steamFixture,
    }),
  );
  assert.equal(
    await readFile(importedInstalled.installedPath, "utf8"),
    luaLookup.generated.text,
  );
  assert.equal(
    (await invoke("steamtools_import_lookup", { app: "999", path: localLua }))
      .ok,
    false,
  );
  checks.push(
    "Generic source configuration persists and Lua import regenerates/deploys data without executing scripts or requiring binary manifest files",
  );
  success(
    await invoke("game_data_sources", {
      sources: [
        ...defaults.filter((source) =>
          ["hubcap", "ryuu", "manifestdex", "catmisteam"].includes(source.kind),
        ),
        {
          name: "Missing test feed",
          urlTemplate:
            "https://raw.githubusercontent.com/SteamToolsProject/SteamTools/master/missing-test-feed/{appid}.lua",
          format: "lua",
          enabled: true,
        },
        ...defaults.filter(
          (source) =>
            !["hubcap", "ryuu", "manifestdex", "catmisteam"].includes(
              source.kind,
            ),
        ),
      ],
    }),
  );
  const remote = success(await invoke("steamtools_lookup", { app: "813780" }));
  success(await invoke("game_data_sources", { sources: defaults }));
  checks.push(
    "Sources without keys, a restricted public feed, and a custom 404 all fall through to a working provider; credentials persist privately across restart",
  );
  const nameSearch = success(
    await invoke("catalog_search", {
      request: { query: "Age of Empires II: Definitive Edition", limit: 20 },
    }),
  );
  assert.ok(
    nameSearch.games.some((game) => game.appId === "813780"),
    "Game-name search must resolve to 813780",
  );
  checks.push(
    "Live game-name search resolves Age of Empires II: Definitive Edition to AppID 813780",
  );
  assert.equal(remote.app, "813780");
  assert.ok(remote.generated.manifests.length > 0);
  assert.ok(remote.generated.text.includes("addappid(813780)"));
  const remoteInstalled = success(
    await invoke("steamtools_add", { id: remote.id, steamRoot: steamFixture }),
  );
  assert.equal(
    await readFile(remoteInstalled.installedPath, "utf8"),
    remote.generated.text,
  );
  for (const manifest of remote.generated.manifests) {
    const bytes = await readFile(
      join(steamFixture, "depotcache", manifest.name),
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      manifest.sha256,
    );
  }
  success(
    await invoke("steamtools_add", { id: remote.id, steamRoot: steamFixture }),
  );
  const notInstalled = await invoke("library_get", { appId: "813780" });
  assert.equal(
    notInstalled.ok,
    false,
    "813780 must have no indexed installation in this fixture",
  );
  checks.push(
    `Live AppID-only 813780 lookup from ${remote.source}, ${remote.generated.manifests.length} manifests, regenerated Lua and hash-matched manifest deployment with no indexed local installation`,
  );
  await mkdir(join(steamFixture, "steamapps/common/PortalFixture"), {
    recursive: true,
  });
  await writeFile(
    join(steamFixture, "steamapps/appmanifest_620.acf"),
    '"AppState" { "appid" "620" "name" "Portal fixture" "StateFlags" "4" "installdir" "PortalFixture" }',
  );
  success(
    await invoke("library_scan", { request: { rootPaths: [steamFixture] } }),
  );
  const detectedLua = success(await invoke("workspace_snapshot")).luaApps;
  const luaInventory = success(await invoke("lua_library"));
  assert.ok(luaInventory.some((game) => game.appId === "620"));
  if (detectedLua.includes("2379780"))
    assert.ok(
      luaInventory.some((game) => game.appId === "2379780"),
      "Existing Lua game must appear even without installation record",
    );
  checks.push(
    `Lua library includes ${luaInventory.length} configured titles independently of local installation records`,
  );
  const onlineEligible = success(
    await invoke("online_fix_games", { refresh: false }),
  );
  assert.ok(detectedLua.includes("620"));
  assert.ok(
    onlineEligible.apps.includes("620"),
    "Online co-op fixture should be eligible",
  );
  assert.ok(
    !onlineEligible.apps.includes("2379780"),
    "Balatro must not be offered online fixes",
  );
  checks.push(
    `Detected ${detectedLua.length} active Lua AppIDs, including existing external configs; ${onlineEligible.apps.length} installed games have verified online support`,
  );
  await request(`/session/${session}/refresh`, "POST", {});
  await execute("location.hash='#/online-fixes'");
  await ready(
    "return [...document.querySelectorAll('button.fixes-game')].some(e=>e.textContent.includes('Portal fixture'))",
  );
  await screenshot("online-fixes-lua-only");
  await execute(
    "[...document.querySelectorAll('button.fixes-game')].find(e=>e.textContent.includes('Portal fixture')).click()",
  );
  await ready(
    "return [...document.querySelectorAll('h3')].some(e=>e.textContent==='Instructions')",
  );
  await ready(
    "return [...document.querySelectorAll('button')].some(e=>e.textContent==='Download fix' && !e.disabled)",
  );
  await screenshot("online-fixes-instructions");
  checks.push(
    "Online Fixes requires active Lua plus online support; singleplayer is excluded and the co-op fixture opens instructions and ZIP controls",
  );
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      { executable, profile, checks, accessibility, screenshots },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, profile, screenshots }, null, 2));
} finally {
  if (session) await request(`/session/${session}`, "DELETE").catch(() => {});
  if (driver.pid)
    spawnSync("taskkill", ["/PID", String(driver.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
}
