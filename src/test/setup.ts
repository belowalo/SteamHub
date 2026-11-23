import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onDragDropEvent: async () => () => {} }),
}));

// JSDOM does not implement layout observers. Actual resizing is exercised by
// the Windows WebView2 smoke test, not this no-layout component environment.
vi.stubGlobal(
  "ResizeObserver",
  class ResizeObserverMock {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);

afterEach(cleanup);
