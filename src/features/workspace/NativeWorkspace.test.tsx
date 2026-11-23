import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceContext, type WorkspaceState } from "@/app/workspace-context";
import { NativeFiles } from "./NativeWorkspace";
import type { ManagedFile } from "@/api/workspace";
const file: ManagedFile = {
  id: "a".repeat(64),
  name: "620.lua",
  extension: "lua",
  size: 20,
  appId: "620",
  source: "My files",
  version: "v1",
  importedAt: "1793750000000",
  warnings: [],
};
function open(files: ManagedFile[] = [file]) {
  const run = vi.fn(async () => undefined);
  const state: WorkspaceState = {
    snapshot: {
      files,
      notes: [],
      activity: [],
      settings: { theme: "dark", scanOnStart: false },
      dataDirectory: "E:\\profile",
      logFile: "E:\\log",
      busy: false,
    },
    busy: false,
    loading: false,
    error: "",
    message: "",
    refresh: vi.fn(async () => {}),
    run,
    perform: vi.fn(async () => true),
    dismiss: vi.fn(),
  };
  render(
    <WorkspaceContext.Provider value={state}>
      <NativeFiles />
    </WorkspaceContext.Provider>,
  );
  return { run };
}
describe("native file workflows", () => {
  it("opens the native import flow and verifies only selected hashes", async () => {
    const { run } = open();
    await userEvent.click(screen.getByRole("button", { name: "Import files" }));
    expect(run).toHaveBeenCalledWith("import");
    await userEvent.click(screen.getByLabelText("Select 620.lua"));
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(run).toHaveBeenLastCalledWith("verify", [file.id]);
  });
  it("requires a concrete deletion confirmation before removing managed copies", async () => {
    const { run } = open();
    await userEvent.click(screen.getByLabelText("Select 620.lua"));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "original files and Steam installation are preserved",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Delete selected copies" }),
    );
    expect(run).toHaveBeenCalledWith("delete", [file.id]);
  });
  it("filters metadata and marks conflicting versions without inventing provider data", async () => {
    open([file, { ...file, id: "b".repeat(64), version: "v2" }]);
    expect(screen.getAllByText("Conflicting versions")).toHaveLength(2);
    await userEvent.type(screen.getByLabelText("Search managed files"), "v2");
    expect(screen.getByText("1 files · 0 selected")).toBeInTheDocument();
    expect(screen.queryByText("v1")).not.toBeInTheDocument();
  });
});
