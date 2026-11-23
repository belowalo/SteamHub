import { afterEach, describe, expect, it } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";
import { mockIPC } from "@/test/desktop";
import { localDetail, localSnapshot } from "@/test/library-fixtures";
import { getLocalGame, listLibrary, scanLibrary } from "./library";
afterEach(() => {
  clearMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  Reflect.deleteProperty(globalThis, "isTauri");
});
describe("real library boundary", () => {
  it("does not invent local data in browser preview", async () => {
    expect((await listLibrary()).ok).toBe(false);
  });
  it("decodes persisted list and installation detail envelopes", async () => {
    mockIPC((command, args) => {
      if (command === "library_get") {
        expect(args).toEqual({ appId: "123" });
        return { ok: true, data: localDetail };
      }
      expect(command).toBe("library_list");
      return { ok: true, data: localSnapshot };
    });
    expect(await listLibrary()).toEqual({ ok: true, data: localSnapshot });
    expect(await getLocalGame("123")).toEqual({ ok: true, data: localDetail });
  });
  it("sends explicit roots and preserves real scan failures", async () => {
    const error = {
      code: "NO_STEAM_INSTALLATION",
      message: "Steam absent",
      retryable: true,
    };
    mockIPC((command, args) => {
      expect(command).toBe("library_scan");
      expect(args).toEqual({ request: { rootPaths: ["E:\\Steam"] } });
      return { ok: false, error };
    });
    expect(await scanLibrary({ rootPaths: ["E:\\Steam"] })).toEqual({
      ok: false,
      error,
    });
  });
  it.each([
    { ...localSnapshot, games: [{ ...localSnapshot.games[0], appId: 123 }] },
    {
      ...localSnapshot,
      games: [
        {
          ...localSnapshot.games[0],
          installed: true,
          installStatus: "scan_failed",
        },
      ],
    },
    {
      ...localSnapshot,
      games: [
        {
          ...localSnapshot.games[0],
          metadataSource: {
            ...localSnapshot.games[0].metadataSource,
            providerId: "demo-catalog",
          },
        },
      ],
    },
  ])("rejects malformed or demo-tagged local payloads", async (data) => {
    mockIPC(() => ({ ok: true, data }));
    const response = await listLibrary();
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.message).toContain("incompatible");
  });
  it("converts transport failures to safe structured errors", async () => {
    mockIPC(() => {
      throw new Error("private raw transport value");
    });
    const result = await listLibrary();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.retryable).toBe(true);
      expect(result.error.message).not.toContain("private");
    }
  });
});
