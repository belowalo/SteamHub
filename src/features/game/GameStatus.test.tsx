import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameStatusButton } from "./GameStatus";
import { compatibilityLabel } from "./game-status-label";
import {
  getGameStatus,
  saveLaunchReport,
  type GameStatus,
} from "@/api/workspace";
vi.mock("@/api/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/workspace")>()),
  getGameStatus: vi.fn(),
  saveLaunchReport: vi.fn(),
}));
const status: GameStatus = {
  appId: "42",
  lua: true,
  installation: "verified_local",
  runtime: true,
  fix: "changed",
  compatibility: { checkedAt: null, complete: false, requirements: [] },
  stale: true,
  personal: { result: "untested", note: "", updatedAt: null, build: "" },
  reportOutdated: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGameStatus).mockResolvedValue(structuredClone(status));
});
describe("per-game status", () => {
  it("fetches only when opened, separates setup from unknown compatibility, and retries", async () => {
    render(<GameStatusButton appId="42" name="Example" />);
    expect(getGameStatus).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: /Game status for Example/ }),
    );
    expect(
      await screen.findByText("Files changed or missing"),
    ).toBeInTheDocument();
    expect(screen.getByText("Unknown / untested")).toBeInTheDocument();
    expect(screen.getByText(/could not be fully checked/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Refresh status" }),
    );
    expect(getGameStatus).toHaveBeenLastCalledWith("42", true);
  });
  it("keeps your result separate from launcher restrictions and saves the selected report", async () => {
    const restricted = {
      ...status,
      compatibility: {
        ...status.compatibility,
        requirements: [
          {
            kind: "account",
            detail: "An external account is required.",
            source: "https://store.steampowered.com/app/42/",
          },
        ],
      },
      reportOutdated: true,
    };
    vi.mocked(getGameStatus).mockResolvedValue(restricted);
    vi.mocked(saveLaunchReport).mockResolvedValue({
      result: "launched",
      note: "Tested today",
      updatedAt: 1793920000,
      build: "new",
    });
    const onChange = vi.fn();
    render(
      <GameStatusButton
        appId="42"
        name="Example"
        summary={restricted}
        onChange={onChange}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Game status for Example/ }),
    );
    expect(
      await screen.findByText(
        "The installation changed since your report. Test this version again.",
      ),
    ).toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Launch result" }),
      "launched",
    );
    await userEvent.type(
      screen.getByLabelText("Launch note (optional)"),
      "Tested today",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save my result" }),
    );
    expect(
      await screen.findByText("Your launch result was saved on this PC."),
    ).toBeInTheDocument();
    expect(saveLaunchReport).toHaveBeenCalledWith(
      "42",
      "launched",
      "Tested today",
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        personal: expect.objectContaining({ result: "launched" }),
      }),
    );
    expect(
      screen.getAllByText("Launcher / account required").length,
    ).toBeGreaterThan(0);
  });
  it("shows failures and prevents reporting an unverified installation as launched", async () => {
    vi.mocked(getGameStatus).mockRejectedValueOnce(new Error("Check failed"));
    render(<GameStatusButton appId="42" name="Example" />);
    await userEvent.click(
      screen.getByRole("button", { name: /Game status for Example/ }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Check failed");
    vi.mocked(getGameStatus).mockResolvedValue({
      ...status,
      installation: "not_checked",
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Refresh status" }),
    );
    await screen.findByRole("combobox", { name: "Launch result" });
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Launch result" }),
      "launched",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save my result" }),
      ).toBeDisabled(),
    );
  });
  it("does not call a successful personal report verified compatibility", () => {
    expect(
      compatibilityLabel({
        ...status,
        personal: { ...status.personal, result: "launched" },
      }),
    ).toBe("Unknown / untested");
    expect(
      compatibilityLabel({
        ...status,
        stale: false,
        compatibility: {
          checkedAt: 1793920000,
          complete: true,
          requirements: [],
        },
      }),
    ).toBe("No known restrictions");
    expect(
      compatibilityLabel({
        ...status,
        compatibility: { checkedAt: 1, complete: true, requirements: [] },
      }),
    ).toBe("Unknown / untested");
  });
});
