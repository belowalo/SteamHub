import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { AutomaticUpdates } from "./AutomaticUpdates";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));
afterEach(() => vi.resetAllMocks());
it("checks on startup and installs only when restart is requested", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockResolvedValue({
    app: "Update downloaded",
    compatibility: "Exit Steam to apply",
    restartReady: true,
    compatibilityPending: true,
  });
  render(<AutomaticUpdates />);
  expect(await screen.findByText("Exit Steam to apply")).toBeInTheDocument();
  expect(invoke).toHaveBeenCalledWith("automatic_updates", { action: "check" });
  expect(invoke).not.toHaveBeenCalledWith("automatic_updates", {
    action: "install",
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Restart and update" }),
  );
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("automatic_updates", {
      action: "install",
    }),
  );
});
it("leaves the app usable when checks fail", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockRejectedValue(new Error("offline"));
  render(<AutomaticUpdates />);
  expect(
    await screen.findByText(/Automatic update check failed/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Restart and update" }),
  ).not.toBeInTheDocument();
});
it("does not call native updates in the browser preview", () => {
  vi.mocked(isTauri).mockReturnValue(false);
  render(<AutomaticUpdates />);
  expect(invoke).not.toHaveBeenCalled();
});
