import { afterEach, describe, expect, it } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";
import { mockIPC } from "@/test/desktop";
import { getAppHealth } from "./client";

afterEach(() => {
  clearMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  Reflect.deleteProperty(globalThis, "isTauri");
});

describe("typed health bridge", () => {
  it("reports a browser-only preview without inventing a working backend", async () => {
    const response = await getAppHealth();
    expect(response.ok).toBe(false);
    if (!response.ok)
      expect(response.error.message).toContain("Desktop backend unavailable");
  });

  it("invokes the implemented command and reads its v1 envelope", async () => {
    mockIPC((command) => {
      expect(command).toBe("app_health");
      return {
        ok: true,
        data: { apiVersion: 1, databaseReady: true, appVersion: "0.1.0" },
      };
    });
    expect(await getAppHealth()).toEqual({
      ok: true,
      data: { apiVersion: 1, databaseReady: true, appVersion: "0.1.0" },
    });
  });

  it("preserves structured backend errors", async () => {
    const error = {
      code: "INTERNAL",
      message: "Database unavailable",
      retryable: true,
    };
    mockIPC(() => ({ ok: false, error }));
    expect(await getAppHealth()).toEqual({ ok: false, error });
  });

  it.each([
    {
      ok: true,
      data: { apiVersion: 2, databaseReady: true, appVersion: "0.1.0" },
    },
    {
      ok: true,
      data: { apiVersion: 1, databaseReady: "yes", appVersion: "0.1.0" },
    },
    { databaseReady: true },
  ])("rejects incompatible responses: %j", async (response) => {
    mockIPC(() => response);
    const result = await getAppHealth();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("incompatible");
  });

  it("converts a transport rejection into a safe retryable error", async () => {
    mockIPC(() => {
      throw new Error("Internal transport details");
    });
    const result = await getAppHealth();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.retryable).toBe(true);
      expect(result.error.message).not.toContain("Internal transport details");
    }
  });
});
