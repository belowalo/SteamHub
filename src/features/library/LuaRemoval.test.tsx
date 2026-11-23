import { beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LuaRemoval } from "./LuaRemoval";
import { luaRemoval, type LuaRemovalPlan } from "@/api/workspace";
vi.mock("@/api/workspace", () => ({ luaRemoval: vi.fn() }));
const plan: LuaRemovalPlan = {
  id: "a".repeat(64),
  app: "620",
  name: "Fixture game",
  files: [{ path: "G:\\Steam\\config\\lua\\620.lua", size: 123 }],
  blocked: [],
  canUndo: false,
};
const changed = vi.fn(async () => {});
function Harness() {
  const [game, setGame] = useState<{ appId: string; name: string } | null>({
    appId: "620",
    name: "Fixture game",
  });
  return (
    <LuaRemoval game={game} onClose={() => setGame(null)} onChanged={changed} />
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  changed.mockResolvedValue(undefined);
});
it("previews before confirmation and keeps undo available after the selected game disappears", async () => {
  let removed = false;
  vi.mocked(luaRemoval).mockImplementation(async (action) => {
    if (action === "history")
      return removed ? [{ ...plan, canUndo: true }] : [];
    if (action === "preview") return [plan];
    removed = action === "apply";
    return [{ ...plan, canUndo: removed }];
  });
  render(<Harness />);
  expect(await screen.findByText(plan.files[0].path)).toBeInTheDocument();
  expect(luaRemoval).not.toHaveBeenCalledWith("apply", null, null, plan.id);
  await userEvent.click(
    screen.getByRole("button", { name: "Remove Lua entry" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("Restart Steam");
  await userEvent.click(screen.getByText("Removed Lua entries (1)"));
  await userEvent.click(
    await screen.findByRole("button", { name: "Undo removal" }),
  );
  await waitFor(() =>
    expect(luaRemoval).toHaveBeenCalledWith("undo", null, null, plan.id),
  );
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
});
it("blocks shared scripts instead of exposing a usable remove action", async () => {
  vi.mocked(luaRemoval).mockImplementation(async (action) =>
    action === "history"
      ? []
      : [{ ...plan, blocked: ["Shared script requires manual review."] }],
  );
  render(<Harness />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Shared script");
  expect(
    screen.getByRole("button", { name: "Remove Lua entry" }),
  ).toBeDisabled();
});
it("preserves the preview and shows an actionable error if Steam is still running", async () => {
  vi.mocked(luaRemoval).mockImplementation(async (action) => {
    if (action === "history") return [];
    if (action === "apply")
      throw new Error("RUNTIME_SETUP: Fully exit Steam before removing Lua.");
    return [plan];
  });
  render(<Harness />);
  await screen.findByText(plan.files[0].path);
  await userEvent.click(
    screen.getByRole("button", { name: "Remove Lua entry" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Fully exit Steam",
  );
  expect(changed).not.toHaveBeenCalled();
});
it("cancels without applying the preview", async () => {
  vi.mocked(luaRemoval).mockImplementation(async (action) =>
    action === "history" ? [] : [plan],
  );
  render(<Harness />);
  await screen.findByText(plan.files[0].path);
  await userEvent.click(screen.getByRole("button", { name: "Keep game" }));
  expect(luaRemoval).not.toHaveBeenCalledWith("apply", null, null, plan.id);
});
