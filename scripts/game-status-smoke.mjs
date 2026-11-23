import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
const output = resolve("test-results/game-status");
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
  const value = await request(`/session/${session}/execute/async`, "POST", {
    script:
      "const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(done,e=>done({transportError:String(e)}));",
    args: [command, args],
  });
  assert.equal(value.ok, true, JSON.stringify(value));
  return value.data;
}
async function ready(script) {
  for (let i = 0; i < 120; i++) {
    if (await execute(script)) return;
    await pause(150);
  }
  throw Error(`Timeout: ${script}`);
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
    } catch {
      await pause(100);
    }
  }
  await start();
  const root = join(profile, "steam-fixture");
  await mkdir(join(root, "steamapps/common/PortalFixture"), {
    recursive: true,
  });
  await mkdir(join(root, "config/lua"), { recursive: true });
  await writeFile(join(root, "steam.exe"), "QA fixture only");
  await writeFile(join(root, "config/lua/renamed.lua"), "addappid(620)");
  const manifest = join(root, "steamapps/appmanifest_620.acf");
  const acf = (build) =>
    `"AppState" {"appid" "620" "name" "Portal status fixture" "StateFlags" "4" "installdir" "PortalFixture" "buildid" "${build}"}`;
  await writeFile(manifest, acf("1"));
  await invoke("library_scan", { request: { rootPaths: [root] } });
  const initial = await invoke("game_status", { app: "620", refresh: false });
  assert.equal(initial.lua, true);
  assert.equal(initial.installation, "verified_local");
  assert.equal(initial.fix, "not_applied");
  assert.equal(initial.personal.result, "untested");
  const requirements = await invoke("game_status", {
    app: "1172470",
    refresh: true,
  });
  assert.ok(
    requirements.compatibility.requirements.some((r) => r.kind === "account"),
  );
  assert.ok(
    requirements.compatibility.requirements.some((r) => r.kind === "anticheat"),
  );
  assert.equal(requirements.personal.result, "untested");
  const reported = await invoke("game_launch_report", {
    app: "620",
    result: "launched",
    note: "QA fixture report",
  });
  assert.equal(reported.result, "launched");
  await request(`/session/${session}`, "DELETE");
  session = null;
  await start();
  let summaries = await invoke("game_status_summaries", {
    apps: ["620", "1172470"],
  });
  assert.equal(summaries[0].personal.result, "launched");
  assert.equal(summaries[1].personal.result, "untested");
  await writeFile(manifest, acf("2"));
  await invoke("library_scan", { request: { rootPaths: [root] } });
  const changed = await invoke("game_status", { app: "620", refresh: false });
  assert.equal(changed.reportOutdated, true);
  await request(`/session/${session}/refresh`, "POST", {});
  await execute("location.hash='/library'");
  await ready(
    `return !!document.querySelector('[aria-label^="Game status for Portal status fixture"]')`,
  );
  assert.ok(
    await execute(
      `const e=document.querySelector('[aria-label^="Game status for Portal status fixture"]');const card=e.closest('article');return e.getBoundingClientRect().bottom<=card.getBoundingClientRect().bottom;`,
    ),
    "Status button must not be clipped by the game card",
  );
  await execute(
    `document.querySelector('[aria-label^="Game status for Portal status fixture"]').click()`,
  );
  await ready(
    `return !!document.querySelector('[aria-label="Your launch result"]')`,
  );
  assert.ok(
    await execute(
      "return document.querySelector('[role=dialog]').textContent.includes('installation changed')",
    ),
  );
  const axe = (await import("node:fs/promises")).readFile;
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  await execute(await axe(require.resolve("axe-core/axe.min.js"), "utf8"));
  const violations = await request(
    `/session/${session}/execute/async`,
    "POST",
    {
      script:
        "const done=arguments[arguments.length-1];axe.run(document.querySelector('[role=dialog]')).then(r=>done(r.violations.map(v=>({id:v.id,impact:v.impact}))))",
      args: [],
    },
  );
  assert.deepEqual(violations, []);
  for (const [width, height] of [
    [1200, 832],
    [960, 640],
  ]) {
    await request(`/session/${session}/window/rect`, "POST", { width, height });
    const layout = await execute(
      "const e=document.querySelector('[role=dialog]');return {overflow:e.scrollWidth>e.clientWidth+1,onscreen:e.getBoundingClientRect().top>=0 && e.getBoundingClientRect().bottom<=innerHeight};",
    );
    assert.equal(layout.overflow, false);
    assert.equal(layout.onscreen, true);
    await screenshot(`status-${width}x${height}`);
  }
  await execute(
    `const e=document.querySelector('select[aria-label="Launch result"]');e.value='failed';e.dispatchEvent(new Event('change',{bubbles:true}));`,
  );
  await execute(
    "[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Save my result').click()",
  );
  await ready(
    "return document.querySelector('[role=dialog]').textContent.includes('Your launch result was saved')",
  );
  summaries = await invoke("game_status_summaries", { apps: ["620"] });
  assert.equal(summaries[0].personal.result, "failed");
  await rename(
    join(root, "config/lua/renamed.lua"),
    join(root, "config/lua/renamed.lua.disabled"),
  );
  const removed = await invoke("game_status", { app: "620", refresh: false });
  assert.equal(removed.lua, false);
  assert.equal(removed.personal.result, "failed");
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      { initial, requirements, changed, summaries, violations, screenshots },
      null,
      2,
    ),
  );
  console.log(
    "Game status passed: setup checks, sourced requirements, private persistence, build changes, UI save, accessibility and two window sizes.",
  );
} finally {
  if (session) await request(`/session/${session}`, "DELETE").catch(() => {});
  driver.kill();
}
