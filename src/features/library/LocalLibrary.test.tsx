import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearMocks } from "@tauri-apps/api/mocks";
import { mockIPC } from "@/test/desktop";
import { localDetail, localSnapshot } from "@/test/library-fixtures";
import { App } from "@/app/App";
vi.mock("./LuaRemoval", () => ({ LuaRemoval: () => null }));
vi.mock("@/api/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/workspace")>()),
  getLuaLibrary: async () => [
    { appId: "123", name: "Local fixture game" },
    { appId: "2379780", name: "Balatro" },
  ],
  loadWorkspace: async () => ({
    luaApps: ["123", "2379780"],
    files: [],
    activity: [],
    notes: [],
    settings: { theme: "dark", scanOnStart: false },
    dataDirectory: "E:\\workspace",
    logFile: "E:\\logs",
    busy: false,
  }),
}));
beforeEach(() => {
  window.history.replaceState(null, "", "#/library");
});
afterEach(() => {
  clearMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  Reflect.deleteProperty(globalThis, "isTauri");
});
describe("live library UI separate from demos", () => {
  it("sorts game cards by name and installed status", async () => {
    mockIPC(() => ({ ok: true, data: localSnapshot }));
    render(<App />);
    await screen.findByRole("link", { name: /Balatro/ });
    const first = () =>
      document.querySelector(".library-game-card h2")?.textContent;
    expect(first()).toBe("Balatro");
    await userEvent.selectOptions(
      screen.getByLabelText("Sort games"),
      "reverse",
    );
    expect(first()).toBe("Local fixture game");
    await userEvent.selectOptions(
      screen.getByLabelText("Sort games"),
      "installed",
    );
    expect(first()).toBe("Local fixture game");
  });
  it("loads verified local records and installation details without demo files", async () => {
    mockIPC((command) => ({
      ok: true,
      data: command === "library_get" ? localDetail : localSnapshot,
    }));
    render(<App />);
    await userEvent.click(
      await screen.findByRole("link", {
        name: /Local fixture game/,
      }),
    );
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Local fixture game",
      }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("local-install-path")).toHaveTextContent(
      localDetail.installations[0].installPath,
    );
    expect(screen.getByRole("tab", { name: "Installation" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.click(screen.getByRole("tab", { name: "Lua files" }));
    expect(screen.getByText("Lua configurations")).toBeInTheDocument();
    expect(screen.queryByText("Aether Drift")).not.toBeInTheDocument();
  });
  it("runs a real command, displays its summary, and supports local filters/table", async () => {
    let calls = 0;
    mockIPC((command) => {
      if (command === "library_scan") {
        calls++;
        return {
          ok: true,
          data: {
            snapshot: localSnapshot,
            verifiedInstallations: 1,
            observedInstallations: 1,
            diagnosticCount: 0,
          },
        };
      }
      return { ok: true, data: localSnapshot };
    });
    render(<App />);
    await screen.findByRole("link", { name: /Local fixture game/ });
    await userEvent.click(
      screen.getByRole("button", { name: "Scan local libraries" }),
    );
    expect(await screen.findByTestId("scan-result")).toHaveTextContent(
      "1 verified installation records",
    );
    expect(calls).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: "Table view" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByLabelText("Local installation status"),
      "absent",
    );
    expect(screen.getByText("No local records match")).toBeInTheDocument();
  });
  it("reports missing Steam as a failure, not an empty successful scan", async () => {
    mockIPC((command) =>
      command === "library_scan"
        ? {
            ok: false,
            error: {
              code: "NO_STEAM_INSTALLATION",
              message: "Steam absent",
              retryable: true,
            },
          }
        : { ok: true, data: { games: [], roots: [], lastScanAt: null } },
    );
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Scan local libraries" }),
      ).toBeEnabled(),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Scan local libraries" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Steam installation not found",
    );
    expect(screen.queryByTestId("scan-result")).not.toBeInTheDocument();
  });
  it("preserves failed records without exposing redundant demo controls", async () => {
    mockIPC(() => ({
      ok: true,
      data: {
        ...localSnapshot,
        games: [
          {
            ...localSnapshot.games[0],
            installed: false,
            installStatus: "scan_failed",
          },
        ],
      },
    }));
    render(<App />);
    expect(
      await screen.findByText("Verification failed", { selector: "span" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Data mode")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open Aether Drift" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Local fixture game/ }),
    ).toBeInTheDocument();
  });
  it("validates selected Windows roots before starting a native operation", async () => {
    let scans = 0;
    mockIPC((command) => {
      if (command === "library_scan") scans++;
      return { ok: true, data: localSnapshot };
    });
    render(<App />);
    await screen.findByRole("link", { name: /Local fixture game/ });
    await userEvent.click(
      screen.getByRole("button", { name: "Select library root" }),
    );
    await userEvent.type(
      screen.getByLabelText("Local Steam library folder"),
      "relative",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Scan selected root" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "absolute local Windows folder",
    );
    expect(scans).toBe(0);
  });
});

it("filters the library by recorded Lua method independently of installation status", async () => {
  const other = {
    ...localSnapshot.games[0],
    appId: "456",
    name: "Other local game",
  };
  mockIPC(() => ({
    ok: true,
    data: { ...localSnapshot, games: [...localSnapshot.games, other] },
  }));
  render(<App />);
  const user = userEvent.setup();
  await screen.findByRole("link", { name: /Other local game/ });
  await user.selectOptions(screen.getByLabelText("Added method"), "lua");
  expect(await screen.findByText("Balatro")).toBeInTheDocument();
  expect(screen.getByText("Lua configured")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: /Local fixture game/ }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /Other local game/ }),
  ).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Added method"), "other");
  expect(
    screen.getByRole("link", { name: /Other local game/ }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /Local fixture game/ }),
  ).not.toBeInTheDocument();
});
