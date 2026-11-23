import { afterEach, expect, it, vi } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";
import { listen, type EventCallback } from "@tauri-apps/api/event";
import { mockIPC } from "@/test/desktop";
import { lookupGameData } from "./workspace";
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
afterEach(() => {
  clearMocks();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});
it("isolates provider events by request and AppID, and always removes its listener", async () => {
  const stop = vi.fn();
  let deliver: EventCallback<unknown> | undefined;
  vi.mocked(listen).mockImplementation(async (_event, handler) => {
    deliver = handler;
    return stop;
  });
  mockIPC((_command, args) => {
    const payload = {
      requestId: (args as Record<string, unknown>).requestId,
      app: "620",
      index: 0,
      source: "Fixture provider",
      status: "trying",
      detail: "Downloading game data",
    };
    deliver?.({
      event: "steamhub:lookup-progress",
      id: 1,
      payload: { ...payload, requestId: "another-request" },
    });
    deliver?.({
      event: "steamhub:lookup-progress",
      id: 1,
      payload: { ...payload, app: "999" },
    });
    deliver?.({ event: "steamhub:lookup-progress", id: 1, payload });
    return {
      ok: false,
      error: {
        code: "GAME_DATA_UNAVAILABLE",
        message: "No usable data",
        retryable: true,
      },
    };
  });
  const progress = vi.fn();
  await expect(lookupGameData("620", progress)).rejects.toThrow(
    "No usable data",
  );
  expect(progress).toHaveBeenCalledTimes(1);
  expect(progress.mock.calls[0][0]).toMatchObject({
    source: "Fixture provider",
    status: "trying",
  });
  expect(stop).toHaveBeenCalledTimes(1);
});
