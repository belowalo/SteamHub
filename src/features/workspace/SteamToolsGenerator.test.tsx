import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearMocks } from "@tauri-apps/api/mocks";
import { mockIPC } from "@/test/desktop";
import { WorkspaceContext, type WorkspaceState } from "@/app/workspace-context";
import { SteamToolsGenerator } from "./SteamToolsGenerator";

afterEach(() => {
  clearMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});
function open() {
  const value: WorkspaceState = {
    snapshot: null,
    loading: false,
    busy: false,
    error: "",
    message: "",
    refresh: vi.fn(async () => {}),
    run: vi.fn(async () => undefined),
    perform: async (action) => {
      await action();
      return true;
    },
    dismiss: vi.fn(),
  };
  render(
    <WorkspaceContext.Provider value={value}>
      <SteamToolsGenerator />
    </WorkspaceContext.Provider>,
  );
}
describe("built-in SteamTools generator", () => {
  it("looks up an AppID without a local scan, then adds the exact looked-up data", async () => {
    const calls: unknown[] = [];
    mockIPC((cmd, args) => {
      calls.push([cmd, args]);
      const generated = {
        text: "addappid(813780)",
        filename: "steamhub_813780.lua",
        installedPath: null,
        manifests: [],
        warnings: [],
      };
      return {
        ok: true,
        data:
          cmd === "steamtools_lookup"
            ? {
                id: "a".repeat(64),
                app: "813780",
                source: "https://github.com/Satisl/MAU/tree/813780",
                generated,
                steamRoot: "G:\\Steam",
              }
            : {
                ...generated,
                installedPath: "G:\\Steam\\config\\lua\\steamhub_813780.lua",
              },
      };
    });
    open();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("AppID"), "813780");
    await user.click(screen.getByRole("button", { name: "Find game" }));
    expect(
      await screen.findByRole("button", { name: "Add to Steam" }),
    ).toBeEnabled();
    expect(screen.getByLabelText("Steam folder")).toHaveValue("G:\\Steam");
    await user.click(screen.getByRole("button", { name: "Add to Steam" }));
    expect(await screen.findByRole("button", { name: "Added" })).toBeDisabled();
    expect(calls).toEqual([
      ["steamtools_lookup", { app: "813780" }],
      ["steamtools_add", { id: "a".repeat(64), steamRoot: "G:\\Steam" }],
    ]);
  });
  it("shows lookup errors without offering Add to Steam", async () => {
    mockIPC(() => ({
      ok: false,
      error: {
        code: "GAME_DATA_UNAVAILABLE",
        message: "No usable game data found",
        retryable: true,
      },
    }));
    open();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("AppID"), "813780");
    await user.click(screen.getByRole("button", { name: "Find game" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No usable game data found",
    );
    expect(
      screen.queryByRole("button", { name: "Add to Steam" }),
    ).not.toBeInTheDocument();
  });
  it("requires a preview before deployment and invalidates it when input changes", async () => {
    const calls: unknown[] = [];
    mockIPC((cmd, args) => {
      calls.push([cmd, args]);
      return {
        ok: true,
        data: {
          text: "addappid(620)",
          filename: "steamhub_620.lua",
          installedPath: null,
          manifests: [],
          warnings: [],
        },
      };
    });
    open();
    const user = userEvent.setup();
    expect(
      screen.getByRole("button", { name: "Save and add to Steam" }),
    ).toBeDisabled();
    await user.type(screen.getByLabelText("Game AppID"), "620");
    await user.type(
      screen.getByLabelText("Steam installation folder"),
      "E:\\Steam",
    );
    await user.click(
      screen.getByRole("button", { name: "Preview generated Lua" }),
    );
    expect(await screen.findByLabelText("Generated Lua preview")).toHaveValue(
      "addappid(620)",
    );
    expect(calls[0]).toEqual([
      "steamtools_generate",
      {
        app: "620",
        depots: "",
        dlcs: "",
        steamRoot: "E:\\Steam",
        deploy: false,
      },
    ]);
    expect(
      screen.getByRole("button", { name: "Save and add to Steam" }),
    ).toBeEnabled();
    await user.type(screen.getByLabelText("Game AppID"), "1");
    expect(
      screen.getByRole("button", { name: "Save and add to Steam" }),
    ).toBeDisabled();
  });
  it("shows provider failures without claiming installation succeeded", async () => {
    mockIPC(() => ({
      ok: false,
      error: {
        code: "IO_ERROR",
        message: "Provider configuration failed",
        retryable: true,
      },
    }));
    open();
    await userEvent.click(
      screen.getByRole("button", { name: "Preview request-code adapter" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Provider configuration failed",
    );
    expect(
      screen.getByRole("button", { name: "Install request-code adapter" }),
    ).toBeDisabled();
  });
});
