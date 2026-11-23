import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";

beforeEach(() => {
  window.history.replaceState(null, "", "#/dashboard");
});
afterEach(() => {
  vi.useRealTimers();
});
async function openApp(path = "dashboard") {
  window.history.replaceState(null, "", `#/${path}?source=demo`);
  render(<App />);
  await userEvent.selectOptions(screen.getByLabelText("Data mode"), "demo");
  await waitFor(() =>
    expect(
      screen.queryByRole("status", { name: "Loading demo data" }),
    ).not.toBeInTheDocument(),
  );
}

describe("desktop navigation and fixture boundaries", () => {
  it.each([
    ["dashboard", "Welcome to your workspace"],
    ["library", "Game Library"],
    ["search", "Game Search"],
    ["game/999999991", "Aether Drift"],
    ["lua", "Lua Studio"],
    ["manifests", "Manifest Manager"],
    ["sources", "Source Providers"],
    ["activity", "Activity & Downloads"],
    ["tools", "Tools"],
    ["settings", "Settings"],
  ])(
    "renders the %s route with explicit fixture disclosure",
    async (route, heading) => {
      await openApp(route);
      expect(
        screen.getByRole("heading", { level: 1, name: heading }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Fictional data & simulated actions. Only desktop health is live.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("navigation", { name: "Main navigation" }),
      ).toBeInTheDocument();
    },
  );

  it("navigates from sidebar and unified title/AppID search", async () => {
    await openApp();
    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Game Library" }));
    expect(
      await screen.findByRole("heading", { name: "Game Library" }),
    ).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "Unified game search" }),
      "999999992{Enter}",
    );
    expect(
      await screen.findByRole("heading", { name: "Game Search" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Neon District" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open Aether Drift" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Open Neon District" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Neon District" }),
    ).toBeInTheDocument();
  });

  it("filters the library, switches to a real table, and resets no results", async () => {
    await openApp("library");
    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByLabelText("Filter by installation"),
      "installed",
    );
    expect(
      within(screen.getByRole("main")).getAllByRole("link", { name: /^Open / }),
    ).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Table view" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Filter sample library"),
      "not-a-game",
    );
    expect(
      screen.getByRole("heading", { name: "No sample games match" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("opens every game section and never offers unverified installation", async () => {
    await openApp("game/999999991");
    const user = userEvent.setup();
    for (const tab of [
      "Installation",
      "Lua files",
      "Manifests",
      "Activity",
      "Overview",
    ]) {
      await user.click(screen.getByRole("tab", { name: tab }));
      expect(screen.getByRole("tab", { name: tab })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
    expect(
      screen.queryByRole("button", { name: /Install fix/i }),
    ).not.toBeInTheDocument();
  });

  it("shows loading, empty, and retryable error previews", async () => {
    await openApp("library");
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Demo state"), "loading");
    expect(
      screen.getByRole("status", { name: "Loading demo data" }),
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Demo state"), "empty");
    expect(
      screen.getByRole("heading", { name: "Your demo workspace is empty" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load sample data" }));
    await user.selectOptions(screen.getByLabelText("Demo state"), "error");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Demo source unavailable",
    );
    await user.click(screen.getByRole("button", { name: "Retry demo" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "Game Library" }),
    ).toBeInTheDocument();
  });

  it("uses keyboard command navigation and restores dialog focus", async () => {
    await openApp();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Open command palette" }),
    );
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Search commands and games"),
      "Settings",
    );
    await user.keyboard("{ArrowDown}{Enter}");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires a simulation dialog and exposes cancel/retry/progress", async () => {
    await openApp("activity");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "New simulation" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "does not scan, parse, download",
    );
    await user.click(screen.getByRole("button", { name: "Run simulation" }));
    expect(
      screen.getByText(/Simulation queued: Download preview/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", {
        name: "Download preview simulation progress",
      }),
    ).toHaveAttribute("aria-valuenow", "0");
    await user.click(screen.getByRole("button", { name: "Cancel simulation" }));
    await user.click(
      screen.getByRole("button", { name: "Confirm cancellation" }),
    );
    expect(screen.getByText("Demo cancelled")).toBeInTheDocument();
    const card = screen
      .getByText("Download preview", { selector: "h2" })
      .closest("article")!;
    await user.click(
      within(card).getByRole("button", { name: "Retry simulation" }),
    );
    expect(
      screen.getAllByRole("progressbar", {
        name: "Download preview simulation progress",
      }),
    ).toHaveLength(2);
  });

  it("connects demo provider toggles to fixture search", async () => {
    await openApp("sources");
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("switch", { name: "Enable Sample game catalog" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Unified game search" }),
      "999999992{Enter}",
    );
    expect(
      await screen.findByText(/The demo catalog is disabled/),
    ).toBeInTheDocument();
  });

  it("edits Lua as inert text, previews it, and handles missing selection", async () => {
    await openApp("lua");
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Lua document editor"));
    await user.type(
      screen.getByLabelText("Lua document editor"),
      "-- edited sample",
    );
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByText("-- edited sample")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Lua game"), "");
    expect(
      screen.getByRole("heading", { name: "Select a game to begin" }),
    ).toBeInTheDocument();
  });

  it("inspects a manifest and keeps deferred fixes out of navigation", async () => {
    await openApp("manifests");
    const user = userEvent.setup();
    await user.click(
      screen.getAllByRole("button", { name: "Inspect sample" })[0],
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Fixture · no hash calculated",
    );
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(
      screen.queryByRole("link", { name: "Fix Center" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /install/i }),
    ).not.toBeInTheDocument();
  });

  it("validates demo paths and keeps preferences across navigation", async () => {
    await openApp("settings");
    const user = userEvent.setup();
    const path = screen.getByLabelText("Sample export workspace");
    await user.clear(path);
    await user.type(path, "relative/path");
    await user.click(
      screen.getByRole("button", { name: "Save demo preferences" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "absolute Windows path",
    );
    await user.clear(path);
    await user.type(path, "E:\\Preview");
    await user.click(
      screen.getByRole("switch", { name: "Check for catalog updates" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save demo preferences" }),
    );
    expect(
      screen.getByText(/Demo preferences saved for this session/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Tools" }));
    await screen.findByRole("heading", { level: 1, name: "Tools" });
    await user.click(screen.getByRole("link", { name: "Settings" }));
    expect(await screen.findByLabelText("Sample export workspace")).toHaveValue(
      "E:\\Preview",
    );
    expect(
      screen.getByRole("switch", { name: "Check for catalog updates" }),
    ).toBeChecked();
    await user.click(
      screen.getByRole("button", { name: /Light A brighter workspace/ }),
    );
    expect(document.documentElement).toHaveClass("light");
  });

  it("formats JSON and gives a useful invalid-input error", async () => {
    await openApp("tools");
    const user = userEvent.setup();
    const scratchpad = screen.getByLabelText("JSON text");
    await user.clear(scratchpad);
    await user.type(scratchpad, "invalid json");
    await user.click(screen.getByRole("button", { name: "Format JSON" }));
    expect(screen.getByRole("alert")).toHaveTextContent("not valid JSON");
    fireEvent.change(scratchpad, { target: { value: '{"a":1}' } });
    await user.click(screen.getByRole("button", { name: "Format JSON" }));
    expect(scratchpad).toHaveValue('{\n  "a": 1\n}');
  });

  it("handles unknown pages and sample game identifiers", async () => {
    await openApp("unknown");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Page not found",
    );
  });
});
