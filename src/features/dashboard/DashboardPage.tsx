import {
  ArrowRight,
  Braces,
  Gamepad2,
  HardDrive,
  Activity,
} from "lucide-react";
import { useDemo } from "@/app/demo-context";
import { gameHref } from "@/app/navigation";
import { demoLua } from "@/api/demo/fixtures";
import { Button } from "@/components/ui/button";
import { GameArt, GameCard } from "@/components/workspace/Games";
import {
  PageHeader,
  Panel,
  SimulateAction,
  StatusBadge,
} from "@/components/workspace/Primitives";
import { BackendHealth } from "./BackendHealth";

export function DashboardPage() {
  const { games, jobs } = useDemo();
  const featured = games[0];
  if (!featured) return null;
  const stats = [
    {
      label: "Sample games",
      value: games.length,
      note: "In your demo collection",
      href: "#/library",
      icon: Gamepad2,
    },
    {
      label: "Demo installed",
      value: games.filter((game) => game.demoInstalled).length,
      note: "Illustrative local records",
      href: "#/library",
      icon: HardDrive,
    },
    {
      label: "Lua documents",
      value: demoLua.length,
      note: "Synthetic sample files",
      href: "#/lua",
      icon: Braces,
    },
    {
      label: "Active simulations",
      value: jobs.filter((job) => ["running", "queued"].includes(job.status))
        .length,
      note: "No real downloads",
      href: "#/activity",
      icon: Activity,
    },
  ];
  return (
    <>
      <PageHeader
        title="Welcome to your workspace"
        description="Your collection, tools, and game activity. All in one place."
        actions={
          <SimulateAction label="Refresh demo library" kind="Library preview" />
        }
      />
      <div className="stats-grid">
        {stats.map(({ label, value, note, href, icon: Icon }) => (
          <a href={href} className="stat-card" key={label}>
            <div>
              <span>{label}</span>
              <Icon aria-hidden="true" />
            </div>
            <strong>{value.toString().padStart(2, "0")}</strong>
            <small>{note}</small>
          </a>
        ))}
      </div>
      <section className="featured-game">
        <GameArt game={featured} hero />
        <div className="featured-content">
          <StatusBadge tone="blue">FEATURED DEMO GAME</StatusBadge>
          <h2>{featured.name}</h2>
          <p>
            {featured.tagline} Explore a fictional world, then preview
            everything you need from one game page.
          </p>
          <Button asChild>
            <a href={gameHref(featured.appId)}>
              Explore game
              <ArrowRight />
            </a>
          </Button>
        </div>
      </section>
      <div className="section-heading">
        <div>
          <h2>Jump back in</h2>
          <p>A few favorites from the sample collection</p>
        </div>
        <Button variant="ghost" asChild>
          <a href="#/library">
            View library
            <ArrowRight />
          </a>
        </Button>
      </div>
      <div className="game-grid">
        {games.slice(0, 3).map((game) => (
          <GameCard game={game} key={game.appId} />
        ))}
      </div>
      <Panel
        title="Recent activity"
        description="Demo history · no real operations"
        action={
          <Button variant="ghost" asChild>
            <a href="#/activity">
              View all
              <ArrowRight />
            </a>
          </Button>
        }
      >
        <div className="activity-preview">
          {jobs.slice(0, 3).map((job) => (
            <div key={job.id}>
              <span className="activity-dot" />
              <div>
                <strong>{job.kind}</strong>
                <small>
                  Simulation ·{" "}
                  {games.find((game) => game.appId === job.appId)?.name ??
                    "Workspace"}
                </small>
              </div>
              <StatusBadge tone={job.status === "failed" ? "amber" : "green"}>
                {job.status}
              </StatusBadge>
            </div>
          ))}
        </div>
      </Panel>
      <div className="section-heading">
        <div>
          <h2>Desktop diagnostics</h2>
          <p>Real backend health, separate from the demo workspace</p>
        </div>
        <StatusBadge tone="green">Live</StatusBadge>
      </div>
      <BackendHealth />
    </>
  );
}
