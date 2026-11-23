import { useEffect, useState } from "react";
import {
  Activity,
  Braces,
  Database,
  LayoutDashboard,
  Library,
  Settings,
  Waypoints,
  Wrench,
} from "lucide-react";

export const navigation = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    group: "Workspace",
  },
  { id: "library", label: "Game Library", icon: Library, group: "Workspace" },
  { id: "online-fixes", label: "Online Fixes", icon: Wrench, group: "Manage" },
  { id: "lua", label: "Lua Studio", icon: Braces, group: "Manage" },
  {
    id: "manifests",
    label: "Manifest Manager",
    icon: Database,
    group: "Manage",
  },
  {
    id: "sources",
    label: "Source Providers",
    icon: Waypoints,
    group: "Manage",
  },
  {
    id: "activity",
    label: "Activity & Downloads",
    icon: Activity,
    group: "System",
  },
  { id: "tools", label: "Tools", icon: Wrench, group: "System" },
  { id: "settings", label: "Settings", icon: Settings, group: "System" },
] as const;
export type PageId =
  (typeof navigation)[number]["id"] | "search" | "game" | "not-found";
export interface Route {
  page: PageId;
  appId?: string;
  query: string;
  key: string;
  source?: "demo" | "local" | "catalog";
}
export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "") || "dashboard";
  const [pathname, search] = raw.split("?");
  const [page, appId] = pathname.split("/");
  return {
    page:
      page === "game" || page === "search"
        ? page
        : navigation.some((item) => item.id === page)
          ? (page as PageId)
          : "not-found",
    appId,
    query: new URLSearchParams(search).get("q") ?? "",
    key: raw,
    source:
      new URLSearchParams(search).get("source") === "demo"
        ? "demo"
        : new URLSearchParams(search).get("source") === "local"
          ? "local"
          : new URLSearchParams(search).get("source") === "catalog"
            ? "catalog"
            : undefined,
  };
}
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
export function navigate(page: string, query?: string) {
  window.location.hash = `/${page}${query ? `?q=${encodeURIComponent(query)}` : ""}`;
}
export function gameHref(
  appId: string,
  source: "demo" | "local" | "catalog" = "demo",
) {
  return `#/game/${appId}?source=${source}`;
}
