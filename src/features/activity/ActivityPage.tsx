import { useState } from "react";
import { Activity, Search } from "lucide-react";
import { useDemo } from "@/app/demo-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmptyState,
  FilterSelect,
  InspectDialog,
  JobProgress,
  PageHeader,
  SimulateAction,
  StatusBadge,
} from "@/components/workspace/Primitives";

export function ActivityPage({ initialQuery }: { initialQuery: string }) {
  const { jobs, games, cancelJob, retryJob } = useDemo();
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState("all");
  const matches = jobs.filter(
    (job) =>
      (status === "all" || job.status === status) &&
      `${job.kind} ${job.appId ?? ""} ${games.find((game) => game.appId === job.appId)?.name ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const renderJobs = (downloads: boolean) => {
    const visible = matches.filter(
      (job) => !downloads || job.kind.toLowerCase().includes("download"),
    );
    return visible.length ? (
      <div className="job-list">
        {visible.map((job) => (
          <article className="job-card" key={job.id}>
            <div className="job-icon">
              <Activity />
            </div>
            <div className="job-content">
              <div className="job-title">
                <h2>{job.kind}</h2>
                <StatusBadge
                  tone={
                    job.status === "succeeded"
                      ? "green"
                      : job.status === "failed"
                        ? "red"
                        : job.status === "cancelled"
                          ? "neutral"
                          : "blue"
                  }
                >
                  Demo {job.status}
                </StatusBadge>
              </div>
              <p>
                {games.find((game) => game.appId === job.appId)?.name ??
                  "Workspace"}{" "}
                · Simulation only ·{" "}
                {job.errorCode
                  ? `Example error: ${job.errorCode}`
                  : "No files or network requests"}
              </p>
              <JobProgress
                progress={job.progressPercent}
                label={`${job.kind} simulation progress`}
              />
            </div>
            <div className="job-actions">
              {["running", "queued"].includes(job.status) ? (
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      Cancel simulation
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Cancel this simulation?</DialogTitle>
                      <DialogDescription>
                        Only the temporary demo job will stop. No real download
                        or operation is running.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="outline">Keep running</Button>
                      </DialogClose>
                      <DialogClose asChild>
                        <Button onClick={() => cancelJob(job.id)}>
                          Confirm cancellation
                        </Button>
                      </DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              ) : ["failed", "cancelled"].includes(job.status) ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => retryJob(job.id)}
                >
                  Retry simulation
                </Button>
              ) : null}
              <InspectDialog
                trigger={
                  <Button variant="ghost" size="sm">
                    Details
                  </Button>
                }
                title="Simulation details"
                description="This job exists only in frontend memory."
              >
                <dl className="facts">
                  <div>
                    <dt>Kind</dt>
                    <dd>{job.kind}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{job.status}</dd>
                  </div>
                  <div>
                    <dt>AppID</dt>
                    <dd>{job.appId ?? "Not game-specific"}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{new Date(job.updatedAt).toLocaleTimeString()}</dd>
                  </div>
                  <div>
                    <dt>Persistence</dt>
                    <dd>Current session only</dd>
                  </div>
                </dl>
              </InspectDialog>
            </div>
          </article>
        ))}
      </div>
    ) : (
      <EmptyState
        title={downloads ? "No demo downloads" : "No matching demo activity"}
        description={
          downloads
            ? "Real downloads are not connected. Start a simulated download to preview progress and cancellation."
            : "Change the filters or run a simulation from a game page."
        }
        action={
          downloads ? (
            <SimulateAction label="Simulate download" kind="Download preview" />
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                setQuery("");
                setStatus("all");
              }}
            >
              Reset filters
            </Button>
          )
        }
      />
    );
  };
  return (
    <>
      <PageHeader
        title="Activity & Downloads"
        description="Follow every step, with clear progress and history."
        actions={
          <SimulateAction label="New simulation" kind="Download preview" />
        }
      />
      <div className="notice-box">
        Demo activity only. Progress is generated by a browser timer; successful
        simulations do not indicate completed backend work.
      </div>
      <div className="catalog-toolbar">
        <div className="search-field">
          <Search />
          <Input
            aria-label="Filter activity"
            placeholder="Filter by action, game, or AppID…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <FilterSelect
          label="Activity status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "All statuses" },
            ...["queued", "running", "succeeded", "failed", "cancelled"],
          ]}
        />
      </div>
      <Tabs defaultValue="all">
        <TabsList aria-label="Activity type">
          <TabsTrigger value="all">All simulations ({jobs.length})</TabsTrigger>
          <TabsTrigger value="downloads">Downloads</TabsTrigger>
        </TabsList>
        <TabsContent value="all">{renderJobs(false)}</TabsContent>
        <TabsContent value="downloads">{renderJobs(true)}</TabsContent>
      </Tabs>
    </>
  );
}
