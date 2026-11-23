import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowRight,
  ChevronDown,
  Command,
  FlaskConical,
  Gamepad2,
  Search,
  Settings,
  Wrench,
} from "lucide-react";
import { DemoProvider } from "./DemoProvider";
import { LibraryProvider } from "./LibraryProvider";
import { useLocalLibrary } from "./library-context";
import { LocalLibraryPage } from "@/features/library/LocalLibraryPage";
import { LocalGameDetailPage } from "@/features/game/LocalGameDetailPage";
import { useDemo } from "./demo-context";
import {
  gameHref,
  navigate,
  navigation,
  useRoute,
  type Route,
} from "./navigation";
import type { PreviewState } from "@/api/demo/service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DemoBoundary,
  EmptyState,
  FilterSelect,
  ToastStack,
} from "@/components/workspace/Primitives";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { CatalogPage } from "@/features/library/CatalogPage";
import { GameDetailPage } from "@/features/game/GameDetailPage";
import { LuaStudioPage } from "@/features/lua/LuaStudioPage";
import { ManifestPage } from "@/features/manifests/ManifestPage";
import { SourcesPage } from "@/features/sources/SourcesPage";
import { ActivityPage } from "@/features/activity/ActivityPage";
import { ToolsPage } from "@/features/tools/ToolsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { WorkspaceProvider } from "./WorkspaceProvider";
import { useWorkspace } from "./workspace-context";
import { saveSettings } from "@/api/workspace";
import {
  NativeActivity,
  NativeFiles,
  NativeSettings,
  NativeSources,
  NativeTools,
  WorkspaceNotice,
} from "@/features/workspace/NativeWorkspace";
import { CatalogSearchPage } from "@/features/catalog/CatalogSearchPage";
import { CatalogGameDetailPage } from "@/features/catalog/CatalogGameDetailPage";
import { OnlineFixesPage } from "@/features/workspace/OnlineFixesPage";
import { AddGameHome } from "@/features/workspace/AddGameHome";
import { AutomaticUpdates } from "@/features/workspace/AutomaticUpdates";

function Page({ route }: { route: Route }) {
  const { dataMode } = useLocalLibrary();
  if (dataMode === "real" && route.source !== "demo") {
    switch (route.page) {
      case "dashboard":
        return <AddGameHome />;
      case "search":
        return <CatalogSearchPage initialQuery={route.query} />;
      case "game":
        return route.source === "catalog" ? (
          <CatalogGameDetailPage appId={route.appId ?? ""} />
        ) : (
          <LocalGameDetailPage appId={route.appId} />
        );
      case "lua":
        return <NativeFiles initialQuery={route.query} />;
      case "manifests":
        return <NativeFiles manifests initialQuery={route.query} />;
      case "sources":
        return <NativeSources />;
      case "online-fixes":
        return <OnlineFixesPage />;
      case "activity":
        return <NativeActivity initialQuery={route.query} />;
      case "tools":
        return <NativeTools />;
      case "settings":
        return <NativeSettings />;
    }
  }
  switch (route.page) {
    case "dashboard":
      return <DashboardPage />;
    case "library":
      return dataMode === "real" ? (
        <LocalLibraryPage initialQuery={route.query} />
      ) : (
        <CatalogPage />
      );
    case "search":
      return <CatalogPage search initialQuery={route.query} />;
    case "game":
      return route.source === "demo" ||
        (route.source !== "local" && dataMode === "demo") ? (
        <GameDetailPage appId={route.appId} />
      ) : (
        <LocalGameDetailPage appId={route.appId} />
      );
    case "lua":
      return <LuaStudioPage appId={route.query} />;
    case "manifests":
      return <ManifestPage initialQuery={route.query} />;
    case "sources":
      return <SourcesPage />;
    case "online-fixes":
      return <p>Online Fixes uses installed games in the desktop library.</p>;
    case "activity":
      return <ActivityPage initialQuery={route.query} />;
    case "tools":
      return <ToolsPage />;
    case "settings":
      return <SettingsPage />;
    default:
      return (
        <>
          <h1 data-page-heading tabIndex={-1}>
            Page not found
          </h1>
          <EmptyState
            description="This page is not part of the SteamHub workspace."
            action={
              <Button asChild>
                <a href="#/dashboard">Go to Dashboard</a>
              </Button>
            }
          />
        </>
      );
  }
}

function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { games } = useDemo();
  const { dataMode, snapshot } = useLocalLibrary();
  const [query, setQuery] = useState("");
  const commandItems = [
    ...navigation.map((item) => ({
      title: item.label,
      href: `#/${item.id}`,
      category: "Page",
      icon: item.icon,
    })),
    ...(dataMode === "real"
      ? (snapshot?.games ?? []).map((game) => ({
          title: game.name ?? game.appId,
          href: gameHref(game.appId, "local"),
          category: `Local record · ${game.appId}`,
          icon: Gamepad2,
        }))
      : games.map((game) => ({
          title: game.name ?? game.appId,
          href: gameHref(game.appId),
          category: `Fixture · ${game.appId}`,
          icon: Gamepad2,
        }))),
  ].filter((item) =>
    `${item.title} ${item.category}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  function choose(href: string) {
    window.location.assign(href);
    onOpenChange(false);
    setQuery("");
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="command-trigger"
          aria-label="Open command palette"
        >
          <Command />
          <kbd>Ctrl K</kbd>
        </Button>
      </DialogTrigger>
      <DialogContent className="command-dialog">
        <DialogHeader>
          <DialogTitle>Go anywhere</DialogTitle>
          <DialogDescription>
            Navigate pages and games. Use Tab or arrow keys to move through
            results.
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Search commands and games"
          placeholder="Type a page, game, or AppID…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              document
                .querySelector<HTMLButtonElement>("[data-command-item]")
                ?.focus();
            }
          }}
        />
        <div
          className="command-results"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button",
                ),
              );
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              buttons[
                (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                  buttons.length
              ]?.focus();
              event.preventDefault();
            }
          }}
        >
          {commandItems.map(({ title, href, category, icon: Icon }) => (
            <button data-command-item key={href} onClick={() => choose(href)}>
              <Icon />
              <span>
                {title}
                <small>{category}</small>
              </span>
              <ArrowRight />
            </button>
          ))}
          {!commandItems.length && (
            <p className="command-empty">No matching page or sample game.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DesktopShell() {
  const route = useRoute();
  const { mode, setMode, jobs, theme, setTheme, loaded } = useDemo();
  const { dataMode, setDataMode } = useLocalLibrary();
  const workspace = useWorkspace();
  const localView = dataMode === "real" && route.source !== "demo";
  const [query, setQuery] = useState("");
  const [commandsOpen, setCommandsOpen] = useState(false);
  const main = useRef<HTMLElement>(null);
  const activeJobs =
    dataMode === "real"
      ? Number(workspace.busy)
      : jobs.filter((job) => ["queued", "running"].includes(job.status)).length;
  useEffect(() => {
    main.current?.scrollTo?.({ top: 0 });
    main.current
      ?.querySelector<HTMLElement>("[data-page-heading]")
      ?.focus({ preventScroll: true });
  }, [route.key, mode, loaded, dataMode]);
  useEffect(() => {
    if (localView) return;
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandsOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [localView]);
  function submitSearch(event: FormEvent) {
    event.preventDefault();
    navigate(dataMode === "real" ? "library" : "search", query.trim());
  }
  return (
    <div className="desktop-shell">
      <a
        href="#main"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          main.current?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="brand" href="#/dashboard" aria-label="SteamHub Dashboard">
          <span>
            <Gamepad2 />
          </span>
          <strong>SteamHub</strong>
        </a>
        <nav aria-label="Main navigation">
          {["Workspace", "Manage", "System"].map((group) => (
            <div className="nav-group" key={group}>
              {navigation
                .filter((item) => item.group === group)
                .map(({ id, label, icon: Icon }) => (
                  <a
                    key={id}
                    href={`#/${id}`}
                    aria-label={
                      localView && id === "dashboard" ? "Home" : label
                    }
                    className={
                      route.page === id ||
                      (route.page === "game" && id === "library")
                        ? "active"
                        : ""
                    }
                    aria-current={route.page === id ? "page" : undefined}
                  >
                    <Icon aria-hidden="true" />
                    <span>
                      {localView && id === "dashboard" ? "Home" : label}
                    </span>
                    {id === "activity" && activeJobs > 0 && <b>{activeJobs}</b>}
                  </a>
                ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="workspace-main">
        {!localView && (
          <header className="topbar">
            <form onSubmit={submitSearch} className="global-search">
              <Search aria-hidden="true" />
              <Input
                aria-label="Unified game search"
                placeholder="Search games, titles, or AppID…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="submit"
                aria-label={
                  dataMode === "real"
                    ? "Search local games"
                    : "Search sample games"
                }
              >
                <ArrowRight />
              </button>
            </form>
            <CommandPalette
              open={commandsOpen}
              onOpenChange={setCommandsOpen}
            />
            <div className="topbar-divider" />
            <Button variant="ghost" size="icon" asChild>
              <a
                href="#/activity"
                aria-label={`Activity, ${activeJobs} active ${dataMode === "real" ? "operations" : "simulations"}`}
                className="activity-shortcut"
              >
                <Activity />
                {activeJobs > 0 && <span className="notification-dot" />}
              </a>
            </Button>
            <Button variant="ghost" size="icon" asChild>
              <a href="#/tools" aria-label="Open diagnostics">
                <Wrench />
              </a>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="profile-button"
                  aria-label="Workspace preferences"
                >
                  <span className="profile-avatar">SH</span>
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Session preferences</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <a href="#/settings">
                    <Settings />
                    Open Settings
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    if (dataMode === "real" && workspace.snapshot) {
                      const settings = workspace.snapshot.settings;
                      void workspace.perform(
                        () =>
                          saveSettings({
                            ...settings,
                            theme: settings.theme === "dark" ? "light" : "dark",
                          }),
                        "Appearance saved.",
                      );
                    } else setTheme(theme === "dark" ? "light" : "dark");
                  }}
                >
                  Use{" "}
                  {(dataMode === "real"
                    ? (workspace.snapshot?.settings.theme ?? "dark")
                    : theme) === "dark"
                    ? "light"
                    : "dark"}{" "}
                  appearance
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>
        )}
        {!localView && (
          <div className="demo-banner">
            <div>
              <FlaskConical aria-hidden="true" />
              <strong>
                {localView ? "Desktop workspace" : "Demo workspace"}
              </strong>
              <span>
                {localView
                  ? "Steam library · Configuration vault · Catalog · Backups"
                  : dataMode === "demo" || route.source === "demo"
                    ? "Fictional data & simulated actions. Only desktop health is live."
                    : "This page uses demo data. Real records are available in Game Library."}
              </span>
            </div>
            <div className="inline-controls">
              <FilterSelect
                label="Data mode"
                value={dataMode}
                onChange={(value) => setDataMode(value as "real" | "demo")}
                options={[
                  { value: "real", label: "Local library" },
                  { value: "demo", label: "Demo workspace" },
                ]}
              />
              {!localView && (
                <FilterSelect
                  label="Demo state"
                  value={mode}
                  onChange={(value) => setMode(value as PreviewState)}
                  options={[
                    { value: "ready", label: "Sample data" },
                    { value: "loading", label: "Loading preview" },
                    { value: "empty", label: "Empty preview" },
                    { value: "error", label: "Error preview" },
                  ]}
                />
              )}
            </div>
          </div>
        )}
        <main
          ref={main}
          id="main"
          tabIndex={-1}
          className="page-scroll"
          data-route={route.page}
        >
          <div className="page-content">
            {localView && <WorkspaceNotice />}
            {localView && <AutomaticUpdates />}
            {localView ? (
              <Page key={`${route.key}:${dataMode}`} route={route} />
            ) : (
              <DemoBoundary
                title={
                  route.page === "game"
                    ? "Game Details"
                    : (navigation.find((item) => item.id === route.page)
                        ?.label ?? "Page not found")
                }
              >
                <Page key={route.key} route={route} />
              </DemoBoundary>
            )}
          </div>
        </main>
      </div>
      <ToastStack />
    </div>
  );
}

export function App() {
  return (
    <LibraryProvider>
      <DemoProvider>
        <WorkspaceProvider>
          <DesktopShell />
        </WorkspaceProvider>
      </DemoProvider>
    </LibraryProvider>
  );
}
