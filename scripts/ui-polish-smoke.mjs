import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
const output = resolve("test-results/ui-polish");
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

async function visit(route) {
  await execute("location.hash=arguments[0]", [`#/${route}`]);
  const page = route.split("?")[0].split("/")[0];
  await ready(
    `return document.querySelector('main')?.dataset.route===${JSON.stringify(page)} && !!document.querySelector('main h1')`,
  );
  await pause(250);
}
async function select(selector, value) {
  await ready(
    `return !!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`,
  );
  await execute(
    `const e=document.querySelector(arguments[0]);e.value=arguments[1];e.dispatchEvent(new Event('change',{bubbles:true}));`,
    [selector, value],
  );
}
async function type(text) {
  const e = await request(`/session/${session}/element`, "POST", {
    using: "css selector",
    value: 'input[aria-label="Game name, AppID or Steam link"]',
  });
  const id = e["element-6066-11e4-a52e-4f735466cecf"];
  await request(`/session/${session}/element/${id}/clear`, "POST", {});
  await request(`/session/${session}/element/${id}/value`, "POST", { text });
}
const results = [];
async function check(label) {
  const layout = await execute(
    `const main=document.querySelector('main');return {horizontal:main.scrollWidth>main.clientWidth+1,document:document.scrollingElement.scrollHeight>innerHeight+1,regions:[...document.querySelectorAll('*')].filter(e=>e.clientHeight>0&&e.scrollHeight>e.clientHeight+2&&['auto','scroll'].includes(getComputedStyle(e).overflowY)).map(e=>e.className)};`,
  );

  const violations = await request(
    `/session/${session}/execute/async`,
    "POST",
    {
      script:
        "const done=arguments[arguments.length-1];axe.run(document.querySelector('main')).then(r=>done(r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))))",
      args: [],
    },
  );

  results.push({ label, layout, violations });
  await screenshot(label);
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
  await visit("dashboard");
  assert.equal(
    await execute(
      `return !!document.querySelector('select[aria-label="Steam store country"]')`,
    ),
    false,
  );
  await visit("settings");
  await ready(
    `return !!document.querySelector('select[aria-label="Steam store country"]')`,
  );
  assert.equal(
    await execute(
      `return document.querySelector('select[aria-label="Steam store country"]').value`,
    ),
    "US",
  );
  await select('select[aria-label="Steam store country"]', "CA");
  await ready(
    "return document.querySelector('[role=status]')?.textContent.includes('Region saved')",
  );
  assert.equal(
    (await invoke("workspace_snapshot")).settings.storeCountry,
    "CA",
  );
  await request(`/session/${session}`, "DELETE");
  session = null;
  await start();
  await visit("settings");
  await ready(
    `return document.querySelector('select[aria-label="Steam store country"]')?.value==='CA'`,
  );
  await visit("dashboard");
  await type("Portal 2");
  await ready(
    "return [...document.querySelectorAll('.add-game-results>button')].some(e=>e.textContent.includes('AppID 620')&&e.textContent.includes('CAD'))",
  );
  await screenshot("home-saved-region");
  await execute(
    `document.querySelector('[aria-label="Clear game search"]').click()`,
  );
  assert.equal(
    await execute(
      `return document.querySelector('input[aria-label="Game name, AppID or Steam link"]').value`,
    ),
    "",
  );
  await visit("settings");
  await select('select[aria-label="Steam store country"]', "US");
  const root = join(profile, "steam-fixture");
  await mkdir(join(root, "steamapps/common/Alpha"), { recursive: true });
  await mkdir(join(root, "steamapps/common/Zeta"), { recursive: true });
  await mkdir(join(root, "config/lua"), { recursive: true });
  await writeFile(join(root, "steam.exe"), "QA only");
  await writeFile(join(root, "config/lua/library.lua"), "addappid(620)");
  for (const [app, name] of [
    ["570", "Alpha"],
    ["620", "Zeta"],
  ])
    await writeFile(
      join(root, `steamapps/appmanifest_${app}.acf`),
      `"AppState" { "appid" "${app}" "name" "${name} fixture" "StateFlags" "4" "installdir" "${name}" }`,
    );
  await invoke("library_scan", { request: { rootPaths: [root] } });
  await request(`/session/${session}/refresh`, "POST", {});
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const { readFile } = await import("node:fs/promises");
  await execute(await readFile(require.resolve("axe-core/axe.min.js"), "utf8"));
  for (const [width, height] of [
    [1440, 900],
    [960, 640],
  ]) {
    await request(`/session/${session}/window/rect`, "POST", { width, height });
    for (const route of [
      "dashboard",
      "library",
      "lua",
      "manifests",
      "sources",
      "online-fixes",
      "activity",
      "tools",
      "settings",
      "game/620?source=local",
      "game/620?source=catalog",
    ]) {
      await visit(route);
      if (route === "settings")
        assert.equal(
          await execute(
            `return document.querySelector('select[aria-label="Steam store country"]').value`,
          ),
          "US",
        );
      else
        assert.equal(
          await execute(
            `return !!document.querySelector('select[aria-label="Steam store country"]')`,
          ),
          false,
        );
      if (route === "library")
        await ready(
          `return !!document.querySelector('[aria-label="Sort games"]') && !!document.querySelector('.library-game-card')`,
        );
      await check(
        `${route.replaceAll("/", "-").replaceAll("?", "-")}-${width}`,
      );
    }
  }
  await visit("library");
  await select('select[aria-label="Sort games"]', "installed");
  assert.deepEqual(
    await execute(
      `return [...document.querySelectorAll('.library-game-card h2')].slice(0,2).map(e=>e.textContent)`,
    ),
    ["Alpha fixture", "Zeta fixture"],
  );
  await execute(`document.querySelector('[aria-label="Table view"]').click()`);
  await ready(`return !!document.querySelector('table')`);
  await check("library-table");
  await execute(`document.querySelector('[aria-label="Grid view"]').click()`);
  await ready(`return !!document.querySelector('.library-game-card')`);
  await execute(
    `document.querySelector('[aria-label^="Game status for Zeta fixture"]').click()`,
  );
  await ready(
    `return !!document.querySelector('[aria-label="Your launch result"]')`,
  );
  await screenshot("game-status-dialog");
  await execute(
    `document.querySelector('[role="dialog"]').scrollTop=document.querySelector('[role="dialog"]').scrollHeight;`,
  );
  assert.ok(
    await execute(
      `const e=[...document.querySelectorAll('[role="dialog"] button')].find(e=>e.textContent==='Save my result');return e.getBoundingClientRect().bottom<=innerHeight;`,
    ),
  );
  await execute(
    `document.querySelector('[role="dialog"] button[data-slot="dialog-close"]').click()`,
  );
  await visit("settings");
  await ready(`return !!document.querySelector('#native-theme')`);
  await select("#native-theme", "light");
  await ready(`return document.documentElement.classList.contains('light')`);
  await check("settings-light");
  await visit("library");
  await check("library-light");
  await visit("dashboard");
  await check("home-light");
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ profile, results, screenshots }, null, 2),
  );
  const findings = results.filter(
    (item) =>
      item.layout.horizontal ||
      item.layout.document ||
      item.violations.length > 0 ||
      (item.label.startsWith("sources") &&
        JSON.stringify(item.layout.regions) !==
          JSON.stringify(["page-scroll"])),
  );
  assert.deepEqual(findings, [], "Layout and accessibility findings");
  console.log(
    "UI polish passed: USA default, settings-only region, persistence, regional prices, sorting, 11 routes at two sizes, light theme, accessibility and scrolling.",
  );
} catch (error) {
  await screenshot("failure").catch(() => {});
  await writeFile(
    join(output, "failure.txt"),
    String(error) +
      "\n" +
      (await execute("return document.body.innerText").catch(() => "")),
  );
  throw error;
} finally {
  if (session) await request(`/session/${session}`, "DELETE").catch(() => {});
  driver.kill();
}
