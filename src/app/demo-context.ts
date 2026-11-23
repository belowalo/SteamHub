import { createContext, useContext } from "react";
import type { JobSummary, ProviderInfo } from "@/contracts";
import type { DemoGame } from "@/api/demo/fixtures";
import type { PreviewState } from "@/api/demo/service";

export interface DemoPreferences {
  workspace: string;
  autoCheck: boolean;
  autoDownload: boolean;
  autoApply: boolean;
}
export interface Notice {
  id: string;
  message: string;
}
export interface DemoWorkspace {
  games: DemoGame[];
  loaded: boolean;
  mode: PreviewState;
  setMode: (mode: PreviewState) => void;
  jobs: JobSummary[];
  runAction: (kind: string, appId?: string) => void;
  cancelJob: (id: string) => void;
  retryJob: (id: string) => void;
  providers: ProviderInfo[];
  toggleProvider: (id: string) => void;
  preferences: DemoPreferences;
  savePreferences: (value: DemoPreferences) => void;
  theme: "dark" | "light";
  setTheme: (theme: "dark" | "light") => void;
  notices: Notice[];
  notify: (message: string) => void;
  dismiss: (id: string) => void;
}
export const DemoContext = createContext<DemoWorkspace | null>(null);
export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error("Demo workspace provider missing");
  return context;
}
