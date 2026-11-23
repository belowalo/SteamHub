import { useContext, useState } from "react";
import { WorkspaceContext } from "@/app/workspace-context";
import { saveSettings } from "@/api/workspace";
import { saveStoreCountry, storeCountries } from "@/api/store-prices";
import { useStoreCountry } from "./useStoreCountry";

export function StoreRegionSettings() {
  const country = useStoreCountry();
  const workspace = useContext(WorkspaceContext);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  async function change(value: string) {
    setSaved(false);
    setSaving(true);
    try {
      if (workspace?.snapshot) {
        const settings = {
          ...workspace.snapshot.settings,
          storeCountry: value,
        };
        if (!(await workspace.perform(() => saveSettings(settings), "")))
          return;
      }
      saveStoreCountry(value);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="form-stack">
      <label>
        Store country
        <select
          className="native-select"
          aria-label="Steam store country"
          value={country}
          disabled={saving || (!!workspace && !workspace.snapshot)}
          onChange={(event) => {
            void change(event.target.value);
          }}
        >
          {storeCountries.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <p>Used for Steam prices and store links throughout the app.</p>
      {saved && (
        <span className="settings-saved" role="status">
          Region saved
        </span>
      )}
    </div>
  );
}
