import { useEffect, useState, type ReactNode } from "react";
import { DemoContext, type DemoPreferences, type Notice } from "./demo-context";
import { demoJobs, demoProviders, type DemoGame } from "@/api/demo/fixtures";
import { loadDemoCatalog, type PreviewState } from "@/api/demo/service";

export function DemoProvider({ children }: { children: ReactNode }) {
  const [games, setGames] = useState<DemoGame[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<PreviewState>("ready");
  const [jobs, setJobs] = useState(() => structuredClone(demoJobs));
  const [providers, setProviders] = useState(() =>
    structuredClone(demoProviders),
  );
  const [preferences, setPreferences] = useState<DemoPreferences>({
    workspace: "D:\\DemoWorkspace",
    autoCheck: false,
    autoDownload: false,
    autoApply: false,
  });
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [notices, setNotices] = useState<Notice[]>([]);
  const hasActiveJobs = jobs.some(
    (job) => job.status === "queued" || job.status === "running",
  );
  function notify(message: string) {
    setNotices((items) => [
      ...items.slice(-3),
      { id: crypto.randomUUID(), message },
    ]);
  }
  useEffect(() => {
    const controller = new AbortController();
    void loadDemoCatalog(controller.signal)
      .then((items) => {
        setGames(items);
        setLoaded(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setMode("error");
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
  useEffect(() => {
    if (!hasActiveJobs) return;
    const timer = setInterval(
      () =>
        setJobs((items) =>
          items.map((job) => {
            if (job.status !== "queued" && job.status !== "running") return job;
            const progress = Math.min(job.progressPercent + 10, 100);
            return {
              ...job,
              progressPercent: progress,
              status: progress === 100 ? "succeeded" : "running",
              updatedAt: new Date().toISOString(),
            };
          }),
        ),
      650,
    );
    return () => clearInterval(timer);
  }, [hasActiveJobs]);
  useEffect(() => {
    if (!notices.length) return;
    const timer = setTimeout(() => setNotices((items) => items.slice(1)), 6000);
    return () => clearTimeout(timer);
  }, [notices]);

  function runAction(kind: string, appId?: string) {
    const now = new Date().toISOString();
    setJobs((items) => [
      {
        id: crypto.randomUUID(),
        kind,
        appId: appId ?? null,
        status: "queued",
        progressPercent: 0,
        errorCode: null,
        createdAt: now,
        updatedAt: now,
      },
      ...items,
    ]);
    notify(
      `Simulation queued: ${kind}. Track it in Activity. No files or network requests are involved.`,
    );
  }
  return (
    <DemoContext.Provider
      value={{
        games,
        loaded,
        mode,
        setMode,
        jobs,
        runAction,
        cancelJob: (id) => {
          setJobs((items) =>
            items.map((job) =>
              job.id === id && ["queued", "running"].includes(job.status)
                ? {
                    ...job,
                    status: "cancelled",
                    updatedAt: new Date().toISOString(),
                  }
                : job,
            ),
          );
          notify("Simulation cancelled. No real operation was affected.");
        },
        retryJob: (id) => {
          const job = jobs.find((item) => item.id === id);
          if (job) runAction(job.kind, job.appId ?? undefined);
        },
        providers,
        toggleProvider: (id) => {
          setProviders((items) =>
            items.map((provider) =>
              provider.id === id
                ? { ...provider, enabled: !provider.enabled }
                : provider,
            ),
          );
          notify(
            "Demo provider preference updated for this session. No connection was made.",
          );
        },
        preferences,
        savePreferences: (value) => {
          setPreferences(value);
          notify(
            "Demo preferences saved for this session. No backend settings were changed.",
          );
        },
        theme,
        setTheme,
        notices,
        notify,
        dismiss: (id) =>
          setNotices((items) => items.filter((notice) => notice.id !== id)),
      }}
    >
      {children}
    </DemoContext.Provider>
  );
}
