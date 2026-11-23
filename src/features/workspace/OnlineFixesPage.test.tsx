import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OnlineFixesPage } from "./OnlineFixesPage";
import {
  discoverOnlineFixes,
  onlineFixOperation,
  onlineFixStatus,
  onlineFixGames,
  openReference,
} from "@/api/workspace";
vi.mock("@/app/library-context", () => ({
  useLocalLibrary: () => ({
    snapshot: {
      games: [
        { appId: "620", name: "Portal 2", installed: true },
        { appId: "4001890", name: "How to Fish", installed: true },
        { appId: "570", name: "Owned game", installed: true },
        { appId: "2379780", name: "Singleplayer Lua game", installed: true },
        { appId: "999", name: "Lua game awaiting download", installed: false },
      ],
    },
    scan: vi.fn(),
    scanning: false,
    loading: false,
    error: null,
  }),
}));
vi.mock("@/app/workspace-context", () => ({
  useWorkspace: () => ({
    snapshot: {
      files: [{ appId: "570", extension: "lua" }],
      luaApps: ["620", "999", "2379780", "4001890"],
    },
    refresh: vi.fn(),
    error: "",
    loading: false,
  }),
}));
vi.mock("@/api/workspace", () => ({
  discoverOnlineFixes: vi.fn(),
  onlineFixOperation: vi.fn(),
  onlineFixStatus: vi.fn(),
  onlineFixGames: vi.fn(),
  openReference: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());
beforeEach(() => {
  vi.mocked(onlineFixGames).mockResolvedValue({ apps: ["620"], unknown: [] });
});
const listing = {
  appId: "620",
  sourceUrl: "https://lua.tools/fixes/620",
  fixes: [
    {
      id: "fix1",
      title: "Online release",
      description: "Use a matching build.",
      hasFix: true,
      tags: [],
    },
  ],
  warnings: [],
  providerError: null,
};
it("offers only online installed Lua games, excluding singleplayer and ownership", async () => {
  render(<OnlineFixesPage />);
  expect(
    await screen.findByRole("button", { name: /Portal 2/ }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Owned game")).not.toBeInTheDocument();
  expect(screen.queryByText("Singleplayer Lua game")).not.toBeInTheDocument();
  expect(
    screen.queryByText("Lua game awaiting download"),
  ).not.toBeInTheDocument();
});
it("shows instructions, opens the game download page, reviews and verifies installation", async () => {
  vi.mocked(discoverOnlineFixes).mockResolvedValue(listing);
  vi.mocked(onlineFixStatus)
    .mockResolvedValueOnce({ installed: false, canUndo: false })
    .mockResolvedValue({ installed: true, canUndo: true });
  vi.mocked(onlineFixOperation)
    .mockResolvedValueOnce({
      id: "a".repeat(64),
      appId: "620",
      installPath: "G:/Steam/steamapps/common/Portal 2",
      files: [{ name: "test.dll", size: 10, before: "old", after: "new" }],
    })
    .mockResolvedValue(null);
  render(<OnlineFixesPage />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Portal 2/ }));
  expect(await screen.findByText("Use a matching build.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Download fix" }));
  expect(openReference).toHaveBeenCalledWith("https://lua.tools/fixes/620");
  expect(
    screen.queryByRole("button", { name: "Install fix" }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Select downloaded ZIP" }),
  );
  expect(await screen.findByText(/test.dll/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Install fix" }));
  expect(
    await screen.findByText("Fix installed and verified"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Undo fix" })).toBeInTheDocument();
  expect(onlineFixOperation).toHaveBeenLastCalledWith(
    "620",
    "apply",
    "a".repeat(64),
  );
});
it("rechecks persisted installation even when the download provider is unavailable", async () => {
  vi.mocked(discoverOnlineFixes).mockRejectedValue(
    new Error("Provider unavailable"),
  );
  vi.mocked(onlineFixStatus).mockResolvedValue({
    installed: true,
    canUndo: true,
  });
  render(<OnlineFixesPage />);
  await userEvent.click(
    await screen.findByRole("button", { name: /Portal 2/ }),
  );
  expect(
    await screen.findByText("Fix installed and verified"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Undo fix" })).toBeInTheDocument();
});

it("keeps the How to Fish review available to retry after Steam exits", async () => {
  const appId = "4001890";
  const id = "b".repeat(64);
  vi.mocked(onlineFixGames).mockResolvedValue({ apps: [appId], unknown: [] });
  vi.mocked(discoverOnlineFixes).mockResolvedValue({
    ...listing,
    appId,
    sourceUrl: `https://lua.tools/fixes/${appId}`,
  });
  vi.mocked(onlineFixStatus)
    .mockResolvedValueOnce({ installed: false, canUndo: false })
    .mockResolvedValueOnce({ installed: false, canUndo: false })
    .mockResolvedValue({ installed: true, canUndo: true });
  vi.mocked(onlineFixOperation)
    .mockResolvedValueOnce({
      id,
      appId,
      installPath: "G:/Steam/steamapps/common/How to Fish",
      destinationPrefix: "How to Fish",
      files: [
        {
          name: "How to Fish/fixture.txt",
          size: 10,
          before: null,
          after: "new",
        },
      ],
    })
    .mockRejectedValueOnce(
      new Error("STEAM_RUNTIME: Fully exit Steam, then try again."),
    )
    .mockResolvedValue(null);
  render(<OnlineFixesPage />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /How to Fish/ }));
  await user.click(
    await screen.findByRole("button", { name: "Select downloaded ZIP" }),
  );
  const review = (await screen.findByText("Review installation"))
    .parentElement!;
  const installer = within(review);
  expect(
    installer.getByText("G:/Steam/steamapps/common/How to Fish/How to Fish"),
  ).toBeInTheDocument();
  await user.click(installer.getByRole("button", { name: "Install fix" }));
  expect(await installer.findByRole("alert")).toHaveTextContent(
    "Fully exit Steam",
  );
  await user.click(installer.getByRole("button", { name: "Install fix" }));
  expect(onlineFixOperation).toHaveBeenLastCalledWith(appId, "apply", id);
  expect(
    await screen.findByText("Fix installed and verified"),
  ).toBeInTheDocument();
});

it("keeps unconfirmed support out and retries it through Refresh games", async () => {
  vi.mocked(onlineFixGames)
    .mockResolvedValueOnce({ apps: [], unknown: ["620"] })
    .mockResolvedValue({ apps: ["620"], unknown: [] });
  render(<OnlineFixesPage />);
  const user = userEvent.setup();
  expect(
    await screen.findByText(/Online support could not be confirmed/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Portal 2/ }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Refresh games" }));
  expect(
    await screen.findByRole("button", { name: /Portal 2/ }),
  ).toBeInTheDocument();
  expect(onlineFixGames).toHaveBeenLastCalledWith(true);
});
