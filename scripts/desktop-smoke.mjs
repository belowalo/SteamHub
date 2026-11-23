// Uses the real Windows WebView2 app. Build with `npm run desktop:build:debug` first.
// Prerequisites: cargo install tauri-driver --locked; matching msedgedriver on PATH.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const driverPort = 4444;
const base = `http://127.0.0.1:${driverPort}`;
const application = resolve(
  process.env.STEAMHUB_SMOKE_BINARY ?? "src-tauri/target/debug/steamhub.exe",
);
const driver = spawn("tauri-driver", ["--port", String(driverPort)], {
  stdio: "inherit",
  windowsHide: true,
});
let sessionId;
let driverError;
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
  const payload = await response.json();
  if (!response.ok || payload.value?.error)
    throw new Error(JSON.stringify(payload));
  return payload.value;
}
async function execute(script, args = []) {
  return request(`/session/${sessionId}/execute/sync`, "POST", {
    script,
    args,
  });
}
async function waitForReady() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const health = await execute(
      "return document.querySelector('[data-testid=health-status]')?.textContent",
    );
    if (health === "Connected") return;
    if (health === "Unavailable")
      throw new Error("Live desktop health is unavailable");
    await pause(250);
  }
  throw new Error("Timed out waiting for live desktop health");
}

try {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (driverError) throw driverError;
    try {
      await request("/status");
      break;
    } catch (error) {
      if (attempt === 99) throw error;
      await pause(200);
    }
  }
  await mkdir("test-results", { recursive: true });
  for (const launch of [1, 2]) {
    const session = await request("/session", "POST", {
      capabilities: { alwaysMatch: { "tauri:options": { application } } },
    });
    sessionId = session.sessionId;
    await waitForReady();
    assert.equal(
      await execute(
        "return document.querySelector('[data-testid=database-status]').textContent",
      ),
      "Ready",
    );
    const health = await request(
      `/session/${sessionId}/execute/async`,
      "POST",
      {
        script:
          "const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('app_health').then(done, error => done({ error: String(error) }));",
        args: [],
      },
    );
    assert.deepEqual(health, {
      ok: true,
      data: { apiVersion: 1, databaseReady: true, appVersion: "0.1.0" },
    });
    const futureCommand = await request(
      `/session/${sessionId}/execute/async`,
      "POST",
      {
        script:
          "const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('catalog_search').then(() => done('unexpected success'), () => done('unavailable'));",
        args: [],
      },
    );
    assert.equal(futureCommand, "unavailable");
    // Exercise a keyboard focusable, user-facing health check control.
    const button = await request(`/session/${sessionId}/element`, "POST", {
      using: "xpath",
      value: "//button[contains(., 'Check again')]",
    });
    await request(
      `/session/${sessionId}/element/${button["element-6066-11e4-a52e-4f735466cecf"]}/click`,
      "POST",
      {},
    );
    await waitForReady();
    assert.equal(
      await execute(
        "return document.documentElement.scrollWidth <= window.innerWidth",
      ),
      true,
    );
    const screenshot = await request(`/session/${sessionId}/screenshot`);
    await writeFile(
      `test-results/desktop-launch-${launch}.png`,
      Buffer.from(screenshot, "base64"),
    );
    console.log(
      `PASS: Windows desktop launch ${launch}, real IPC, SQLite readiness, refresh and layout`,
    );
    await request(`/session/${sessionId}`, "DELETE");
    sessionId = undefined;
  }
} finally {
  if (sessionId)
    await request(`/session/${sessionId}`, "DELETE").catch(() => {});
  if (driver.pid && process.platform === "win32") {
    // Close only this test's driver tree, including its native Edge driver child.
    spawnSync("taskkill", ["/PID", String(driver.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    driver.kill();
  }
}
