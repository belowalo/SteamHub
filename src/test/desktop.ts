import { mockIPC as tauriMockIPC } from "@tauri-apps/api/mocks";

// Tauri's IPC mock does not set the separate runtime detection flag.
export function mockIPC(...args: Parameters<typeof tauriMockIPC>) {
  Reflect.set(globalThis, "isTauri", true);
  tauriMockIPC(...args);
}
