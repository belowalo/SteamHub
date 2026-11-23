import { afterEach, describe, expect, it } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";
import { mockIPC } from "@/test/desktop";
import {
  loadWorkspace,
  runWorkspace,
  associateFile,
  readManagedFile,
  createManagedFile,
} from "./workspace";
afterEach(() => {
  clearMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  Reflect.deleteProperty(globalThis, "isTauri");
});
describe("native workspace client", () => {
  it("requires native services and rejects malformed response data", async () => {
    await expect(loadWorkspace()).rejects.toThrow("desktop application");
    mockIPC(() => ({ ok: true, data: { files: [] } }));
    await expect(loadWorkspace()).rejects.toThrow("incompatible response");
  });
  it("passes actual import paths and preserves per-file errors", async () => {
    mockIPC((cmd, args) => {
      expect(cmd).toBe("workspace_operation");
      expect(args).toEqual({
        request: { action: "import", ids: [], paths: ["E:\\my.lua"] },
      });
      return {
        ok: true,
        data: {
          processed: 0,
          skipped: 0,
          errors: ["Invalid Lua"],
          output: null,
          cancelled: false,
        },
      };
    });
    expect((await runWorkspace("import", [], ["E:\\my.lua"])).errors).toEqual([
      "Invalid Lua",
    ]);
  });
  it("does not report a failed backend write as success", async () => {
    mockIPC(() => ({
      ok: false,
      error: { code: "IO_ERROR", message: "Disk is full", retryable: true },
    }));
    await expect(
      createManagedFile("620.lua", "return {}", "620", "Local", "v1"),
    ).rejects.toThrow("Disk is full");
  });
  it("sends explicit metadata and file IDs without executing content", async () => {
    const calls: unknown[] = [];
    mockIPC((cmd, args) => {
      calls.push([cmd, args]);
      return {
        ok: true,
        data: cmd === "workspace_read" ? "os.execute('never executed')" : true,
      };
    });
    await associateFile("a".repeat(64), "620", "Local", "v2");
    expect(await readManagedFile("a".repeat(64))).toContain("never executed");
    expect(calls).toHaveLength(2);
  });
});
