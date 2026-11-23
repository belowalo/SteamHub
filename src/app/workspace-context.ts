import { createContext, useContext } from "react";
import type {
  OperationResult,
  WorkspaceAction,
  WorkspaceSnapshot,
} from "@/api/workspace";
export interface WorkspaceState {
  snapshot: WorkspaceSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string;
  message: string;
  refresh: () => Promise<void>;
  run: (
    action: WorkspaceAction,
    ids?: string[],
    paths?: string[],
  ) => Promise<OperationResult | undefined>;
  perform: (
    action: () => Promise<unknown>,
    success: string,
  ) => Promise<boolean>;
  dismiss: () => void;
}
export const WorkspaceContext = createContext<WorkspaceState | null>(null);
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Workspace provider missing");
  return value;
}
