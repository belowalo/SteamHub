import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
const output = resolve("test-results/store-prices");
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

async function type(text) {
  const e = await request(`/session/${session}/element`, "POST", {
    using: "css selector",
    value: 'input[aria-label="Game name, AppID or Steam link"]',
  });
  const id = e["element-6066-11e4-a52e-4f735466cecf"];
  await request(`/session/${session}/element/${id}/clear`, "POST", {});
  await request(`/session/${session}/element/${id}/value`, "POST", { text });
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
  const featured = await (
    await fetch(
      "https://store.steampowered.com/api/featuredcategories?cc=CA&l=english",
      { signal: AbortSignal.timeout(15000) },
    )
  ).json();
  const deal = featured.specials.items
    .filter(
      (i) =>
        i.type === 0 &&
        i.discount_percent > 0 &&
        i.discount_percent < 100 &&
        i.final_price > 0,
    )
    .sort((a, b) => a.id - b.id)[0];
  assert.ok(deal);
  const quotes = await invoke("steam_store_prices", {
    apps: ["570", "620", String(deal.id)],
    country: "CA",
    refresh: true,
  });
  assert.equal(quotes.find((q) => q.appId === "570").kind, "free");
  const sale = quotes.find((q) => q.appId === String(deal.id));
  assert.equal(sale.kind, "paid");
  assert.equal(sale.currency, "CAD");
  assert.equal(sale.discount, deal.discount_percent);
  assert.ok(sale.original && sale.current);
  const us = await invoke("steam_store_prices", {
    apps: ["620"],
    country: "US",
    refresh: true,
  });
  assert.equal(us[0].currency, "USD");
  assert.equal(quotes.find((q) => q.appId === "620").currency, "CAD");
  await execute("location.hash='/settings'");
  await ready(
    `return !!document.querySelector('select[aria-label="Steam store country"]')`,
  );
  await execute(
    `const e=document.querySelector('select[aria-label="Steam store country"]');e.value='CA';e.dispatchEvent(new Event('change',{bubbles:true}));`,
  );
  await execute("location.hash='/dashboard'");
  await ready(
    `return !!document.querySelector('input[aria-label="Game name, AppID or Steam link"]')`,
  );
  await type("Dota 2");
  await ready(
    "return [...document.querySelectorAll('.add-game-results>button')].some(e=>e.textContent.includes('AppID 570') && e.textContent.includes('Free on Steam') && e.textContent.includes('Get on Steam'))",
  );
  await screenshot("free-on-steam");
  await type(deal.name);
  await ready(
    `return [...document.querySelectorAll('.add-game-results>button')].some(e=>e.textContent.includes('AppID ${deal.id}') && e.textContent.includes('\u2212${deal.discount_percent}%') && e.textContent.includes('CAD'))`,
  );
  await screenshot("discount-search");
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const { readFile } = await import("node:fs/promises");
  await execute(await readFile(require.resolve("axe-core/axe.min.js"), "utf8"));
  const violations = await request(
    `/session/${session}/execute/async`,
    "POST",
    {
      script:
        "const done=arguments[arguments.length-1];axe.run(document.querySelector('main')).then(r=>done(r.violations.map(v=>({id:v.id,impact:v.impact}))))",
      args: [],
    },
  );
  assert.deepEqual(violations, []);
  for (const [width, height] of [
    [1200, 832],
    [960, 640],
  ]) {
    await request(`/session/${session}/window/rect`, "POST", { width, height });
    assert.equal(
      await execute(
        'return document.querySelector("main").scrollWidth>document.querySelector("main").clientWidth+1',
      ),
      false,
    );
    await screenshot(`discount-${width}x${height}`);
  }
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ quotes, us, deal, violations, screenshots }, null, 2),
  );
  console.log(
    "Steam prices passed: live free game, live discount/original price, CAD/USD separation, home labels, accessibility and two window sizes.",
  );
} finally {
  if (session) await request(`/session/${session}`, "DELETE").catch(() => {});
  driver.kill();
}
