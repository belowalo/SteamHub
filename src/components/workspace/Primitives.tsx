import type { ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FlaskConical,
  FolderOpen,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useDemo } from "@/app/demo-context";
import { cn } from "@/lib/utils";

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "green" | "amber" | "red";
}) {
  return (
    <Badge variant="outline" className={cn("status-badge", `status-${tone}`)}>
      {children}
    </Badge>
  );
}
export function PageHeader({
  title,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1 tabIndex={-1} data-page-heading>
          {title}
        </h1>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel", className)}>
      {title && (
        <header className="panel-header">
          <div>
            <h2>{title}</h2>
          </div>
          {action}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}
export function EmptyState({
  title = "Nothing here yet",
  description,
  action,
}: {
  title?: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <FolderOpen aria-hidden="true" />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function LoadingSkeleton() {
  return (
    <div aria-label="Loading demo data" role="status" className="skeleton-grid">
      {[0, 1, 2].map((item) => (
        <div className="skeleton-card" key={item}>
          <div />
          <span />
          <span />
        </div>
      ))}
      <span className="sr-only">Loading demo data</span>
    </div>
  );
}
export function DemoBoundary({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  const { mode, loaded, setMode, notify } = useDemo();
  const heading = (
    <div>
      <p className="eyebrow">WORKSPACE PREVIEW</p>
      <h1 data-page-heading tabIndex={-1}>
        {title}
      </h1>
    </div>
  );
  if (mode !== "error" && (!loaded || mode === "loading"))
    return (
      <>
        {heading}
        <LoadingSkeleton />
      </>
    );
  if (mode === "error")
    return (
      <>
        {heading}
        <div role="alert" className="empty-state">
          <div className="empty-icon error">
            <AlertCircle />
          </div>
          <h2>Demo source unavailable</h2>
          <p>
            This is a simulated error. No live source was contacted. Try
            restoring the sample workspace.
          </p>
          <Button
            onClick={() => {
              setMode("ready");
              notify("Demo workspace restored.");
            }}
          >
            <RefreshCw />
            Retry demo
          </Button>
        </div>
      </>
    );
  if (mode === "empty")
    return (
      <>
        {heading}
        <EmptyState
          title="Your demo workspace is empty"
          description="This preview shows a fresh workspace with no sample records. Load the fixtures to explore the interface."
          action={
            <Button onClick={() => setMode("ready")}>
              <FlaskConical />
              Load sample data
            </Button>
          }
        />
      </>
    );
  return children;
}
export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<string | { value: string; label: string }>;
}) {
  return (
    <label className="filter-select">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((item) => {
          const option =
            typeof item === "string" ? { value: item, label: item } : item;
          return (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          );
        })}
      </select>
    </label>
  );
}
export function SourceAttribution() {
  return (
    <span className="source-attribution">
      <FlaskConical aria-hidden="true" className="size-3" />
      Synthetic fixture · freshness unknown
    </span>
  );
}
export function FilePreview({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  return (
    <div className="file-preview">
      <div>
        {title}
        <StatusBadge tone="amber">Demo file</StatusBadge>
      </div>
      <pre tabIndex={0}>
        <code>{content}</code>
      </pre>
    </div>
  );
}
export function InspectDialog({
  trigger,
  title,
  description,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="inspection-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Done</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function SimulateAction({
  label,
  kind,
  appId,
  variant = "outline",
}: {
  label: string;
  kind: string;
  appId?: string;
  variant?: "default" | "outline" | "secondary";
}) {
  const { runAction } = useDemo();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant={variant}>
          <Play aria-hidden="true" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Simulate {kind.toLowerCase()}?</DialogTitle>
          <DialogDescription>
            This UI preview creates a temporary demo job in Activity. It does
            not scan, parse, download, export, patch, or change any files.
          </DialogDescription>
        </DialogHeader>
        <div className="notice-box">
          <FlaskConical />
          Simulation only · resets when the application closes
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button onClick={() => runAction(kind, appId)}>
              Run simulation
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function JobProgress({
  progress,
  label,
}: {
  progress: number;
  label: string;
}) {
  return (
    <div className="job-progress">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <span>{progress}%</span>
    </div>
  );
}
export function ToastStack() {
  const { notices, dismiss } = useDemo();
  return (
    <div className="toast-stack" aria-live="polite" aria-relevant="additions">
      {notices.map((notice) => (
        <div role="status" className="toast" key={notice.id}>
          <CheckCircle2 className="size-5 text-primary" aria-hidden="true" />
          <p>{notice.message}</p>
          <button
            aria-label="Dismiss notification"
            onClick={() => dismiss(notice.id)}
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
