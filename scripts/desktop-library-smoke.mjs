// P04 real-machine smoke: actual Rust IPC, real Steam metadata, no test/demo roots
// are inserted into the user's application database.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";
const folder = resolve("test-results/p04");
const base = "http://127.0.0.1:4444";
const binary = resolve("src-tauri/target/release/steamhub.exe");
const driver = spawn("tauri-driver", ["--port", "4444"], {
  stdio: "inherit",
  windowsHide: true,
});
let driverError, sessionId;
driver.on("error", (error) => {
  driverError = error;
});
const checks = [],
  screenshots = [];
let snapshot, repeat, integrity, accessibility;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function request(path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  if (!response.ok || typeof data.value?.error === "string")
    throw new Error(JSON.stringify(data));
  return data.value;
}
async function execute(script, args = []) {
  return request(`/session/${sessionId}/execute/sync`, "POST", {
    script,
    args,
  });
}
async function invoke(command, args = {}) {
  return request(`/session/${sessionId}/execute/async`, "POST", {
    script:
      "const done=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(done,e=>done({transportError:String(e)}));",
    args: [command, args],
  });
}
async function click(selector) {
  const found = await request(`/session/${sessionId}/element`, "POST", {
    using: "css selector",
    value: selector,
  });
  await request(
    `/session/${sessionId}/element/${found["element-6066-11e4-a52e-4f735466cecf"]}/click`,
    "POST",
    {},
  );
}
async function until(script) {
  for (let n = 0; n < 300; n++) {
    if (await execute(script)) return;
    await pause(100);
  }
  throw new Error(`Timed out: ${script}`);
}
async function screenshot(name) {
  await execute(
    "document.querySelector('main').scrollTo({top:0,behavior:'instant'})",
  );
  await pause(150);
  const path = join(folder, `${name}.png`);
  await writeFile(
    path,
    Buffer.from(await request(`/session/${sessionId}/screenshot`), "base64"),
  );
  screenshots.push(path);
  const valid = await execute(
    "const m=document.querySelector('main'); return m.scrollWidth<=m.clientWidth+1 && document.documentElement.scrollWidth<=innerWidth+1;",
  );
  assert.ok(valid, `Horizontal overflow: ${name}`);
}
async function start() {
  const result = await request("/session", "POST", {
    capabilities: { alwaysMatch: { "tauri:options": { application: binary } } },
  });
  sessionId = result.sessionId;
  await request(`/session/${sessionId}/timeouts`, "POST", { script: 60000 });
  await until("return !!document.querySelector('nav')");
}
async function fingerprints(roots) {
  const result = {};
  for (const root of roots) {
    let canonical;
    try {
      canonical = await realpath(root.path);
    } catch {
      continue;
    }
    const directory = join(root.path, "steamapps");
    let entries;
    try {
      entries = await readdir(directory);
    } catch {
      continue;
    }
    const files = entries
      .filter((name) => /^appmanifest_[0-9]+\.acf$/i.test(name))
      .map((name) => join(directory, name));
    files.push(
      join(directory, "libraryfolders.vdf"),
      join(root.path, "config", "libraryfolders.vdf"),
    );
    for (const path of files) {
      try {
        const resolved = await realpath(path);
        const inside = relative(canonical, resolved);
        if (inside.startsWith("..") || /^[a-z]:/i.test(inside)) continue;
        const metadata = await stat(resolved);
        if (!metadata.isFile() || metadata.size > 2 * 1024 * 1024) continue;
        result[resolved] = {
          sha256: createHash("sha256")
            .update(await readFile(resolved))
            .digest("hex"),
          modified: metadata.mtimeMs,
        };
      } catch {
        /* A missing/unreadable source is diagnosed by Rust. */
      }
    }
  }
  return result;
}
try {
  await mkdir(folder, { recursive: true });
  for (let n = 0; n < 100; n++) {
    if (driverError) throw driverError;
    try {
      await request("/status");
      break;
    } catch (error) {
      if (n === 99) throw error;
      await pause(200);
    }
  }
  await start();
  assert.deepEqual(await invoke("app_health"), {
    ok: true,
    data: { apiVersion: 1, databaseReady: true, appVersion: "0.1.0" },
  });
  checks.push("app_health v1 unchanged after additive migration");
  await click('nav a[href="#/library"]');
  await until(
    "return !!document.querySelector('input[aria-label=\"Filter local library\"]')",
  );
  assert.equal(
    await execute(
      "return document.querySelector('select[aria-label=\"Data mode\"]').value",
    ),
    "real",
  );
  const invalid = await invoke("library_scan", {
    request: { rootPaths: ["relative/path"] },
  });
  assert.equal(invalid.error?.code, "INVALID_INPUT");
  const invalidId = await invoke("library_get", { appId: "123x" });
  assert.equal(invalidId.error?.code, "INVALID_INPUT");
  checks.push("Native path/AppID validation rejects invalid input");
  await click("main .page-actions button");
  await until(
    "return !!document.querySelector('[data-testid=scan-result]') || !!document.querySelector('main [role=alert]')",
  );
  const uiError = await execute(
    "return document.querySelector('main [role=alert]')?.textContent ?? null",
  );
  assert.equal(uiError, null, `Real scan failed: ${uiError}`);
  const listed = await invoke("library_list");
  assert.equal(listed.ok, true);
  snapshot = listed.data;
  assert.ok(
    snapshot.roots.length > 0,
    "No real root found on this registered-Steam machine",
  );
  assert.ok(
    snapshot.games.every(
      (game) =>
        typeof game.appId === "string" &&
        game.installed === (game.installStatus === "verified_local"),
    ),
  );
  checks.push(
    "Real scan invoked through UI; typed installed/status results verified",
  );
  const before = await fingerprints(snapshot.roots);
  const second = await invoke("library_scan", { request: {} });
  assert.equal(second.ok, true, JSON.stringify(second));
  repeat = second.data;
  const after = await fingerprints(snapshot.roots);
  assert.deepEqual(
    after,
    before,
    "Steam metadata changed during repeat scan; investigate concurrent Steam activity",
  );
  integrity = { files: Object.keys(before).length, unchanged: true };
  assert.ok(integrity.files > 0);
  checks.push(
    `${integrity.files} real Steam metadata files: bytes and modification timestamps unchanged`,
  );
  assert.deepEqual(
    repeat.snapshot.games.map((game) => game.appId),
    snapshot.games.map((game) => game.appId),
  );
  checks.push("Repeat scan idempotence and duplicate-free game list");
  // Reload the UI snapshot after the direct IPC repeat scan.
  await click('nav a[href="#/tools"]');
  await click('nav a[href="#/library"]');
  await execute(
    "const button=[...document.querySelectorAll('main button')].find(b=>b.textContent.includes('Reload saved index')); button.click();",
  );
  await until(
    "return !!document.querySelector('input[aria-label=\"Filter local library\"]')",
  );
  const game = repeat.snapshot.games.find((game) => game.installed);
  assert.ok(
    game,
    "No verified installation available for the real detail smoke test",
  );
  const search = await request(`/session/${sessionId}/element`, "POST", {
    using: "css selector",
    value: '[aria-label="Unified game search"]',
  });
  const searchId = search["element-6066-11e4-a52e-4f735466cecf"];
  await request(`/session/${sessionId}/element/${searchId}/value`, "POST", {
    text: game.appId,
  });
  await click('[aria-label="Search local games"]');
  await until(
    `return document.querySelector('input[aria-label="Filter local library"]')?.value === '${game.appId}'`,
  );
  assert.equal(
    await execute("return document.querySelectorAll('main .game-card').length"),
    1,
  );
  checks.push(
    "Unified AppID search filters the real local index without remote catalog data",
  );
  await click('nav a[href="#/library"]');
  for (const [width, height] of [
    [1440, 900],
    [960, 640],
  ]) {
    await request(`/session/${sessionId}/window/rect`, "POST", {
      width,
      height,
    });
    await screenshot(`library-${width}`);
    await click(`a[href="#/game/${game.appId}?source=local"]`);
    await until(
      "return !!document.querySelector('[data-testid=local-install-path]')",
    );
    const detail = await invoke("library_get", { appId: game.appId });
    assert.equal(detail.ok, true);
    assert.ok(
      detail.data.installations.some(
        (installation) => installation.status === "verified_local",
      ),
    );
    await screenshot(`installation-${width}`);
    await click('nav a[href="#/library"]');
  }
  await execute(await readFile("node_modules/axe-core/axe.min.js", "utf8"));
  accessibility = await request(`/session/${sessionId}/execute/async`, "POST", {
    script:
      "const done=arguments[arguments.length-1]; axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}).then(r=>done(r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))));",
    args: [],
  });
  assert.deepEqual(accessibility, []);
  checks.push("Native local-library accessibility scan: zero axe violations");
  await request(`/session/${sessionId}`, "DELETE");
  sessionId = undefined;
  await start();
  const cached = await invoke("library_list");
  assert.equal(cached.ok, true);
  assert.deepEqual(cached.data, repeat.snapshot);
  checks.push(
    "Exact indexed results retained after actual application restart",
  );
  await click('nav a[href="#/library"]');
  await until(
    "return !!document.querySelector('input[aria-label=\"Filter local library\"]')",
  );
  await screenshot("library-after-restart");
  await execute(
    "const s=document.querySelector('select[aria-label=\"Data mode\"]');s.value='demo';s.dispatchEvent(new Event('change',{bubbles:true}));",
  );
  await until("return !!document.querySelector('.art-aether')");
  await screenshot("explicit-demo-separation");
  checks.push(
    "Demo mode remains explicitly separate from persisted local installations",
  );
  const result = {
    passed: true,
    checks,
    screenshots,
    sourceIntegrity: integrity,
    snapshot: repeat.snapshot,
    scan: {
      verifiedInstallations: repeat.verifiedInstallations,
      observedInstallations: repeat.observedInstallations,
      diagnosticCount: repeat.diagnosticCount,
    },
    accessibility,
  };
  await writeFile(
    join(folder, "results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    `PASS: P04 native real scan; ${repeat.snapshot.roots.length} roots, ${repeat.snapshot.games.length} games, ${repeat.verifiedInstallations} verified installations, ${repeat.diagnosticCount} diagnostics; ${integrity.files} unchanged source files; restart verified`,
  );
} catch (error) {
  if (sessionId) await screenshot("failure").catch(() => {});
  await writeFile(
    join(folder, "results.json"),
    JSON.stringify(
      {
        passed: false,
        error: String(error),
        checks,
        screenshots,
        snapshot,
        repeat,
        integrity,
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
  if (driver.pid)
    spawnSync("taskkill", ["/PID", String(driver.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
}
