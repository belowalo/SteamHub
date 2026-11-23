import { createContext, useContext } from "react";
import type {
  AppError,
  LibrarySnapshot,
  LibraryScanRequest,
} from "@/contracts";
export interface LocalLibraryState {
  dataMode: "real" | "demo";
  setDataMode: (mode: "real" | "demo") => void;
  snapshot: LibrarySnapshot | null;
  loading: boolean;
  scanning: boolean;
  error: AppError | null;
  scanMessage: string | null;
  refresh: () => Promise<void>;
  scan: (request?: LibraryScanRequest) => Promise<void>;
}
export const LibraryContext = createContext<LocalLibraryState | null>(null);
export function useLocalLibrary() {
  const value = useContext(LibraryContext);
  if (!value) throw new Error("Local library provider missing");
  return value;
}
