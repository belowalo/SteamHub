import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
const output = resolve("test-results/desktop-layout");
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
  await execute("location.hash='/sources'");
  await ready("return document.querySelectorAll('.game-data-source').length>0");
  const results = [];
  for (const [width, height] of [
    [1200, 832],
    [960, 640],
  ]) {
    await request(`/session/${session}/window/rect`, "POST", { width, height });
    const result = await execute(`
      const main=document.querySelector('main');
      main.style.scrollBehavior='auto';
      const sidebar=document.querySelector('.sidebar');
      const top=sidebar.getBoundingClientRect().top;
      main.scrollTop=main.scrollHeight;
      const buttons=[...main.querySelectorAll('button')];
      const last=buttons.find(b=>b.textContent.includes('Sync / resume index'));
      const rect=last.getBoundingClientRect();
      return {
        documentScroll:document.scrollingElement.scrollHeight>innerHeight+1,
        horizontalOverflow:document.scrollingElement.scrollWidth>innerWidth+1 || main.scrollWidth>main.clientWidth+1,
        sidebarMoved:sidebar.getBoundingClientRect().top!==top,
        bottomReachable:rect.top>=0 && rect.bottom<=innerHeight,
        scrollAreas:[...document.querySelectorAll('*')].filter(e=>e.clientHeight>0 && e.scrollHeight>e.clientHeight+2 && ['auto','scroll'].includes(getComputedStyle(e).overflowY)).map(e=>e.className)
      };
    `);
    assert.equal(result.documentScroll, false, JSON.stringify(result));
    assert.equal(result.horizontalOverflow, false, JSON.stringify(result));
    assert.equal(result.sidebarMoved, false, JSON.stringify(result));
    assert.equal(result.bottomReachable, true, JSON.stringify(result));
    assert.deepEqual(result.scrollAreas, ["page-scroll"]);
    await screenshot(`sources-${width}x${height}`);
    results.push({ width, height, ...result });
  }
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    "Source Providers: one scrollbar, fixed sidebar, reachable bottom controls at both window sizes.",
  );
} finally {
  if (session) await request(`/session/${session}`, "DELETE").catch(() => {});
  driver.kill();
}
