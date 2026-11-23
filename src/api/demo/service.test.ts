import { describe, expect, it } from "vitest";
import { demoFixes, demoGames } from "./fixtures";
import { filterGames, loadDemoCatalog } from "./service";
import { parseRoute } from "@/app/navigation";

describe("offline UI adapter", () => {
  it("keeps synthetic installation examples separate from verified facts", () => {
    expect(demoGames.some((game) => game.demoInstalled)).toBe(true);
    expect(
      demoGames.every(
        (game) => !game.installed && game.installations.length === 0,
      ),
    ).toBe(true);
    expect(
      demoFixes.every(
        (fix) => !fix.canAutoApply && fix.approval !== "approved",
      ),
    ).toBe(true);
  });
  it("filters titles, string AppIDs, genres, installation examples, and sort", () => {
    expect(filterGames(demoGames, { query: " aEtHer " })).toHaveLength(1);
    expect(filterGames(demoGames, { query: "999999992" })[0].name).toBe(
      "Neon District",
    );
    expect(filterGames(demoGames, { genre: "Adventure" })[0].name).toBe(
      "The Quiet Atlas",
    );
    expect(filterGames(demoGames, { installation: "installed" })).toHaveLength(
      4,
    );
    expect(filterGames(demoGames, { sort: "hours" })[0].name).toBe("Emberfall");
    expect(filterGames(demoGames, { query: "missing" })).toEqual([]);
  });
  it("does not mutate canonical fixtures when sorting", () => {
    const original = demoGames.map((game) => game.appId);
    filterGames(demoGames, { sort: "hours" });
    expect(demoGames.map((game) => game.appId)).toEqual(original);
  });
  it("supports aborting a fixture request", async () => {
    const controller = new AbortController();
    const request = loadDemoCatalog(controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
  it("parses deep links without converting identifiers to numbers", () => {
    expect(parseRoute("#/game/999999991").appId).toBe("999999991");
    expect(parseRoute("#/search?q=The%20Quiet%20Atlas").query).toBe(
      "The Quiet Atlas",
    );
    expect(parseRoute("#/unknown").page).toBe("not-found");
  });
});
