// Real Windows UI verification. No command or data mocks are installed in the app.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const base = "http://127.0.0.1:4444";
const folder = resolve("test-results/phase03");
const binary = resolve(
  process.env.STEAMHUB_SMOKE_BINARY ?? "src-tauri/target/release/steamhub.exe",
);
const driver = spawn("tauri-driver", ["--port", "4444"], {
  stdio: "inherit",
  windowsHide: true,
});
let driverError;
let sessionId;
const checks = [];
const accessibility = [];
const screenshots = [];
driver.on("error", (error) => {
  driverError = error;
});
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function request(path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok || result.value?.error)
    throw new Error(JSON.stringify(result));
  return result.value;
}
async function execute(script, args = []) {
  return request(`/session/${sessionId}/execute/sync`, "POST", {
    script,
    args,
  });
}
async function asyncExecute(script, args = []) {
  return request(`/session/${sessionId}/execute/async`, "POST", {
    script,
    args,
  });
}
async function element(selector, using = "css selector") {
  const result = await request(`/session/${sessionId}/element`, "POST", {
    using,
    value: selector,
  });
  return result["element-6066-11e4-a52e-4f735466cecf"];
}
async function click(selector, using) {
  const id = await element(selector, using);
  await request(`/session/${sessionId}/element/${id}/click`, "POST", {});
}
async function clickText(text) {
  await click(`//button[normalize-space(.)='${text}']`, "xpath");
}
async function type(selector, text) {
  const id = await element(selector);
  await request(`/session/${sessionId}/element/${id}/clear`, "POST", {});
  await request(`/session/${sessionId}/element/${id}/value`, "POST", { text });
}
async function keys(value) {
  await request(`/session/${sessionId}/actions`, "POST", {
    actions: [{ type: "key", id: "keyboard", actions: value }],
  });
  await request(`/session/${sessionId}/actions`, "DELETE");
}
async function until(script, expected = true) {
  for (let i = 0; i < 80; i += 1) {
    const result = await execute(script);
    if (result === expected) return result;
    await pause(100);
  }
  throw new Error(`Timed out: ${script}; expected ${JSON.stringify(expected)}`);
}
// Keep argument-bearing waits explicit to avoid serializing predicates across IPC.
async function ready(title) {
  for (let i = 0; i < 80; i += 1) {
    if (
      await execute(
        "return !document.querySelector('.skeleton-grid') && document.querySelector('h1')?.textContent === arguments[0]",
        [title],
      )
    )
      return;
    await pause(100);
  }
  throw new Error(`Page not ready: ${title}`);
}
async function shot(name) {
  await execute(
    "document.querySelector('main')?.scrollTo({top:0,behavior:'instant'})",
  );
  await pause(130);
  const png = await request(`/session/${sessionId}/screenshot`);
  const path = `${folder}/${name}.png`;
  await writeFile(path, Buffer.from(png, "base64"));
  screenshots.push(path);
}
async function layout(label) {
  const metrics = await execute(
    "const m=document.querySelector('main'); return {viewport:innerWidth,document:document.documentElement.scrollWidth,main:m.clientWidth,content:m.scrollWidth};",
  );
  assert.ok(
    metrics.document <= metrics.viewport + 1 &&
      metrics.content <= metrics.main + 1,
    `${label}: horizontal overflow ${JSON.stringify(metrics)}`,
  );
  checks.push(`${label}: no horizontal overflow`);
}
async function audit(label) {
  const violations = await asyncExecute(
    "const done=arguments[arguments.length-1]; axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}).then(r=>done(r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))),e=>done({error:String(e)}));",
  );
  assert.ok(
    Array.isArray(violations),
    `axe failed: ${JSON.stringify(violations)}`,
  );
  accessibility.push({ page: label, violations });
  await writeFile(
    `${folder}/accessibility.json`,
    JSON.stringify(accessibility, null, 2),
  );
}
const routes = [
  ["dashboard", "Welcome to your workspace"],
  ["library", "Game Library"],
  ["game", "Aether Drift"],
  ["lua", "Lua Studio"],
  ["manifests", "Manifest Manager"],
  ["fixes", "Fix Center"],
  ["sources", "Source Providers"],
  ["activity", "Activity & Downloads"],
  ["tools", "Tools"],
  ["settings", "Settings"],
];
async function visit(page, title) {
  if (page === "game") {
    await click('nav a[href="#/library"]');
    await ready("Game Library");
    await click('a[aria-label="Open Aether Drift"]');
  } else await click(`nav a[href="#/${page}"]`);
  await ready(title);
}
async function state(value) {
  await execute(
    "const s=document.querySelector('select[aria-label=\"Demo state\"]'); s.value=arguments[0]; s.dispatchEvent(new Event('change',{bubbles:true}));",
    [value],
  );
}

try {
  await mkdir(folder, { recursive: true });
  for (let i = 0; i < 100; i += 1) {
    if (driverError) throw driverError;
    try {
      await request("/status");
      break;
    } catch (error) {
      if (i === 99) throw error;
      await pause(200);
    }
  }
  const session = await request("/session", "POST", {
    capabilities: { alwaysMatch: { "tauri:options": { application: binary } } },
  });
  sessionId = session.sessionId;
  await request(`/session/${sessionId}/timeouts`, "POST", { script: 30000 });
  await ready("Welcome to your workspace");
  await execute(
    "const s=document.querySelector('select[aria-label=\"Data mode\"]'); s.value='demo'; s.dispatchEvent(new Event('change',{bubbles:true}));",
  );
  await until(
    "return document.querySelector('[data-testid=health-status]')?.textContent",
    "Connected",
  );
  const health = await asyncExecute(
    "const done=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke('app_health').then(done,e=>done({error:String(e)}));",
  );
  assert.deepEqual(health, {
    ok: true,
    data: { apiVersion: 1, databaseReady: true, appVersion: "0.1.0" },
  });
  checks.push("Live Rust IPC and SQLite readiness verified");
  await execute(await readFile("node_modules/axe-core/axe.min.js", "utf8"));
  await execute(
    "window.__uiErrors=[]; addEventListener('error',e=>window.__uiErrors.push(e.message)); addEventListener('unhandledrejection',e=>window.__uiErrors.push(String(e.reason)));",
  );
  for (const [size, width, height] of [
    ["wide", 1440, 900],
    ["compact", 960, 640],
  ]) {
    await request(`/session/${sessionId}/window/rect`, "POST", {
      width,
      height,
    });
    for (const [page, title] of routes) {
      await visit(page, title);
      await layout(`${size}/${page}`);
      await shot(`${size}-${page}`);
      if (size === "wide") await audit(page);
      // Every route uses and recovers from all three explicit state previews.
      for (const mode of ["loading", "empty", "error"]) {
        await state(mode);
        const selector =
          mode === "loading"
            ? ".skeleton-grid"
            : mode === "empty"
              ? ".empty-state"
              : "[role=alert]";
        await until(`return !!document.querySelector('${selector}')`);
        await layout(`${size}/${page}/${mode}`);
        if (size === "wide" && page === "library") await shot(`state-${mode}`);
      }
      await clickText("Retry demo");
      await ready(title);
      // Dismiss preview-recovery notifications so they do not cover later screenshots.
      await execute(
        "document.querySelectorAll('[aria-label=\"Dismiss notification\"]').forEach(b=>b.click())",
      );
    }
  }
  await request(`/session/${sessionId}/window/rect`, "POST", {
    width: 1440,
    height: 900,
  });
  await visit("game", "Aether Drift");
  for (const section of [
    "Installation",
    "Lua files",
    "Manifests",
    "Fixes",
    "Activity",
  ]) {
    await click(
      `//button[@role='tab' and normalize-space(.)='${section}']`,
      "xpath",
    );
    await layout(`game/${section}`);
    await shot(`detail-${section.toLowerCase().replaceAll(" ", "-")}`);
  }
  await visit("library", "Game Library");
  await click('[aria-label="Table view"]');
  await shot("library-table");
  await layout("library/table");
  await type('[aria-label="Unified game search"]', "999999992");
  await click('[aria-label="Search sample games"]');
  await ready("Game Search");
  assert.equal(
    await execute("return document.querySelectorAll('.game-card').length"),
    1,
  );
  await click('a[aria-label="Open Neon District"]');
  await ready("Neon District");
  checks.push("Unified AppID search → filtered game → details");
  await keys([
    { type: "keyDown", value: "\uE009" },
    { type: "keyDown", value: "k" },
    { type: "keyUp", value: "k" },
    { type: "keyUp", value: "\uE009" },
  ]);
  await until("return !!document.querySelector('[role=dialog]')");
  await type('[aria-label="Search commands and games"]', "Manifest Manager");
  await keys([
    { type: "keyDown", value: "\uE015" },
    { type: "keyUp", value: "\uE015" },
    { type: "keyDown", value: "\uE007" },
    { type: "keyUp", value: "\uE007" },
  ]);
  await ready("Manifest Manager");
  checks.push("Ctrl+K → arrow/Enter command navigation");
  await clickText("Compare example versions");
  await shot("manifest-comparison");
  await clickText("Inspect sample");
  await shot("manifest-dialog");
  await audit("manifest-dialog");
  await keys([
    { type: "keyDown", value: "\uE004" },
    { type: "keyUp", value: "\uE004" },
  ]);
  assert.equal(
    await execute("return !!document.activeElement.closest('[role=dialog]')"),
    true,
  );
  await keys([
    { type: "keyDown", value: "\uE00C" },
    { type: "keyUp", value: "\uE00C" },
  ]);
  await until("return !document.querySelector('[role=dialog]')");
  checks.push("Dialog keyboard focus trap and Escape dismissal");
  await visit("activity", "Activity & Downloads");
  await clickText("New simulation");
  await shot("simulation-confirmation");
  await clickText("Run simulation");
  await until(
    "return !!document.querySelector('[role=progressbar][aria-label=\"Download preview simulation progress\"]')",
  );
  await clickText("Cancel simulation");
  await clickText("Confirm cancellation");
  await until("return document.body.textContent.includes('Demo cancelled')");
  await click(
    "//article[.//h2[normalize-space(.)='Download preview']]//button[normalize-space(.)='Retry simulation']",
    "xpath",
  );
  await until(
    "return [...document.querySelectorAll('.job-card')].find(c=>c.querySelector('h2')?.textContent==='Download preview')?.textContent.includes('Demo succeeded')",
  );
  checks.push(
    "Simulation confirmation, cancellation, retry, completion, and progress",
  );
  await shot("activity-success");
  await visit("settings", "Settings");
  await type("#workspace-path", "relative/path");
  await clickText("Save demo preferences");
  await until("return !!document.querySelector('#path-error')");
  await shot("settings-validation");
  await type("#workspace-path", "E:\\DemoWorkspace");
  await clickText("Save demo preferences");
  await until(
    "return document.body.textContent.includes('Demo preferences saved for this session')",
  );
  await click("//button[.//strong[normalize-space(.)='Light']]", "xpath");
  await until("return document.documentElement.classList.contains('light')");
  await shot("settings-light");
  await audit("settings-light");
  await click("//button[.//strong[normalize-space(.)='Dark']]", "xpath");
  checks.push("Path error/success and light/dark appearance");
  const errors = await execute("return window.__uiErrors");
  assert.deepEqual(errors, []);
  const serious = accessibility.flatMap((entry) =>
    entry.violations
      .filter((violation) => ["serious", "critical"].includes(violation.impact))
      .map((violation) => ({ page: entry.page, ...violation })),
  );
  assert.deepEqual(
    serious,
    [],
    `Accessibility violations: ${JSON.stringify(serious)}`,
  );
  checks.push(
    "No captured runtime errors or serious/critical WCAG axe violations",
  );
  await writeFile(
    `${folder}/results.json`,
    JSON.stringify(
      { passed: true, binary, checks, screenshots, accessibility },
      null,
      2,
    ),
  );
  console.log(
    `PASS: Phase 03 native UI; ${checks.length} checks; ${screenshots.length} screenshots; ${accessibility.length} accessibility audits`,
  );
} catch (error) {
  if (sessionId) await shot("failure").catch(() => {});
  await writeFile(
    `${folder}/results.json`,
    JSON.stringify(
      {
        passed: false,
        error: String(error),
        checks,
        screenshots,
        accessibility,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (sessionId)
    await request(`/session/${sessionId}`, "DELETE").catch(() => {});
  if (driver.pid && process.platform === "win32")
    spawnSync("taskkill", ["/PID", String(driver.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  else driver.kill();
}
