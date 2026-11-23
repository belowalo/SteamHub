import { afterEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearMocks } from "@tauri-apps/api/mocks";
import { mockIPC } from "@/test/desktop";
import { GameDataSources } from "./GameDataSources";
import type { GameDataSource } from "@/api/workspace";

afterEach(() => {
  clearMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});
const sources = (): GameDataSource[] => [
  {
    name: "Hubcap / Morrenus",
    kind: "hubcap",
    urlTemplate: "https://hubcapmanifest.com/api/v1/manifest/{appid}",
    format: "zip",
    enabled: true,
    hasCredential: false,
  },
  {
    name: "OpenLua",
    kind: "openlua",
    urlTemplate: "",
    format: "lua",
    enabled: false,
    hasCredential: false,
  },
];
describe("game-data source setup", () => {
  it("keeps website-only sources separate from automatic fallback", async () => {
    const opened: string[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "open_reference") {
        opened.push((args as Record<string, unknown>).url as string);
        return { ok: true, data: true };
      }
      return { ok: true, data: sources() };
    });
    render(<GameDataSources />);
    const manual = await screen.findByRole("group", {
      name: "Game data source 2",
    });
    expect(within(manual).getByText("Website / import")).toBeInTheDocument();
    expect(within(manual).queryByRole("checkbox")).not.toBeInTheDocument();
    await userEvent
      .setup()
      .click(within(manual).getByRole("button", { name: "Open website" }));
    expect(opened).toEqual(["https://openlua.cloud/"]);
  });
  it("sends keys through the private command and preserves unsaved source choices", async () => {
    let current = sources();
    const calls: string[] = [];
    mockIPC((cmd, args) => {
      const payload = (args ?? {}) as Record<string, unknown>;
      calls.push(cmd);
      if (cmd === "game_data_credential") {
        expect(args).toEqual({ provider: "hubcap", key: "qa-private-key" });
        current[0].hasCredential = true;
        return { ok: true, data: true };
      }
      if (payload.sources) {
        expect(JSON.stringify(payload.sources)).not.toContain("qa-private-key");
        current = payload.sources as GameDataSource[];
      }
      return { ok: true, data: structuredClone(current) };
    });
    render(<GameDataSources />);
    const key = await screen.findByLabelText("Hubcap / Morrenus API key");
    expect(key).toHaveAttribute("type", "password");
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Enabled" }));
    await user.type(key, "qa-private-key");
    await user.click(screen.getByRole("button", { name: "Save key" }));
    expect(await screen.findByText("Key saved")).toBeInTheDocument();
    expect(key).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "Enabled" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save sources" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Game-data sources saved",
    );
    expect(current[0].enabled).toBe(false);
    expect(calls).toEqual([
      "game_data_sources",
      "game_data_credential",
      "game_data_sources",
      "game_data_sources",
    ]);
  });
});
