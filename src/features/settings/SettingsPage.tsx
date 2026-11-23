import { useState, type FormEvent } from "react";
import { KeyRound, Monitor, Moon, Sun } from "lucide-react";
import { useDemo } from "@/app/demo-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  InspectDialog,
  PageHeader,
  Panel,
  StatusBadge,
} from "@/components/workspace/Primitives";

export function SettingsPage() {
  const { preferences, savePreferences, theme, setTheme, notify } = useDemo();
  const [draft, setDraft] = useState(preferences);
  const [error, setError] = useState("");
  function save(event: FormEvent) {
    event.preventDefault();
    if (!/^(?:[a-z]:\\|\\\\[^\\]+\\[^\\]+)/i.test(draft.workspace.trim())) {
      setError(
        "Use an absolute Windows path, such as D:\\DemoWorkspace. This preview checks format only.",
      );
      return;
    }
    setError("");
    savePreferences({ ...draft, workspace: draft.workspace.trim() });
  }
  return (
    <>
      <PageHeader
        title="Settings"
        description="Make the workspace feel like yours, with deliberate defaults."
        actions={<StatusBadge tone="amber">Session preferences</StatusBadge>}
      />
      <Panel
        title="Appearance"
        description="These controls change the interface immediately for this session."
        action={<Monitor className="size-5 muted" />}
      >
        <div className="theme-picker">
          <button
            aria-pressed={theme === "dark"}
            onClick={() => {
              setTheme("dark");
              notify("Dark appearance selected for this session.");
            }}
          >
            <span className="theme-preview dark-preview">
              <Moon />
            </span>
            <strong>Dark</strong>
            <small>Focused, calm, familiar</small>
          </button>
          <button
            aria-pressed={theme === "light"}
            onClick={() => {
              setTheme("light");
              notify("Light appearance selected for this session.");
            }}
          >
            <span className="theme-preview light-preview">
              <Sun />
            </span>
            <strong>Light</strong>
            <small>A brighter workspace</small>
          </button>
        </div>
      </Panel>
      <form onSubmit={save} noValidate>
        <Panel
          title="Demo workspace path"
          description="A path-format preview. No folders are opened, created, or verified."
        >
          <label htmlFor="workspace-path" className="field-label">
            Sample export workspace
          </label>
          <Input
            id="workspace-path"
            value={draft.workspace}
            onChange={(event) => {
              setDraft({ ...draft, workspace: event.target.value });
              setError("");
            }}
            aria-invalid={!!error}
            aria-describedby={error ? "path-error" : "path-help"}
          />
          <p id="path-help" className="field-help">
            Session-only example · actual path settings are scheduled for a
            future phase.
          </p>
          {error && (
            <p id="path-error" className="form-error" role="alert">
              {error}
            </p>
          )}
        </Panel>
        <Panel
          title="Automation policy preview"
          description="Independent opt-ins for the interface model only. No real automation is enabled."
        >
          {(
            [
              {
                field: "autoCheck",
                title: "Check for catalog updates",
                description:
                  "Preview automatic checking separately from downloads.",
              },
              {
                field: "autoDownload",
                title: "Download approved packages",
                description: "Preview a separate download preference.",
              },
            ] as const
          ).map(({ field, title, description }) => (
            <div className="setting-row" key={field}>
              <div>
                <label htmlFor={field}>{title}</label>
                <p>{description}</p>
              </div>
              <Switch
                id={field}
                checked={draft[field]}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, [field]: checked })
                }
              />
            </div>
          ))}
        </Panel>
        <div className="settings-actions">
          <p>Demo preferences reset when the app closes.</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraft(preferences);
              setError("");
              notify("Unsaved demo changes discarded.");
            }}
          >
            Discard changes
          </Button>
          <Button type="submit">Save demo preferences</Button>
        </div>
      </form>
      <Panel
        title="Credentials & privacy"
        description="No credentials are requested or stored by this UI phase."
        action={<KeyRound className="size-5 muted" />}
      >
        <p className="body-copy">
          Game data comes from offline fixtures. Only desktop health uses the
          real Rust backend. There is no telemetry or external game API access.
        </p>
        <InspectDialog
          trigger={<Button variant="outline">Credential storage status</Button>}
          title="Credential storage is not connected"
          description="Platform-backed secret storage belongs to the later Settings phase."
        >
          <p className="body-copy">
            No API-key entry field is enabled here. Do not paste secrets into
            the demo editors or scratchpad.
          </p>
        </InspectDialog>
      </Panel>
    </>
  );
}
