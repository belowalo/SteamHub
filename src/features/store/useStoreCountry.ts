import { useContext, useSyncExternalStore } from "react";
import { WorkspaceContext } from "@/app/workspace-context";
import { savedStoreCountry, subscribeStoreCountry } from "@/api/store-prices";

export function useStoreCountry() {
  const workspace = useContext(WorkspaceContext);
  const cached = useSyncExternalStore(
    subscribeStoreCountry,
    savedStoreCountry,
    () => "US",
  );
  return workspace?.snapshot?.settings.storeCountry ?? cached;
}
