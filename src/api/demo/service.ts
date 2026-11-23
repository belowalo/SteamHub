import { demoGames } from "./fixtures";
import type { DemoGame } from "./fixtures";

export type PreviewState = "ready" | "loading" | "empty" | "error";
export interface DemoCatalogQuery {
  query?: string;
  genre?: string;
  installation?: string;
  sort?: string;
}

export function filterGames(
  games: DemoGame[],
  {
    query = "",
    genre = "all",
    installation = "all",
    sort = "name",
  }: DemoCatalogQuery,
): DemoGame[] {
  const normalized = query.trim().toLowerCase();
  return games
    .filter(
      (game) =>
        (!normalized ||
          `${game.name} ${game.appId}`.toLowerCase().includes(normalized)) &&
        (genre === "all" || game.genre === genre) &&
        (installation === "all" ||
          game.demoInstalled === (installation === "installed")),
    )
    .sort((a, b) =>
      sort === "hours"
        ? b.hours - a.hours
        : (a.name ?? "").localeCompare(b.name ?? ""),
    );
}

/** Explicitly frontend-only. Never invokes Tauri or touches network/files/DB. */
export async function loadDemoCatalog(
  signal: AbortSignal,
): Promise<DemoGame[]> {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, 180);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return demoGames;
}
