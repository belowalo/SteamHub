import { useId } from "react";
import { ArrowUpRight, Clock3, MoreHorizontal } from "lucide-react";
import type { DemoGame } from "@/api/demo/fixtures";
import { gameHref } from "@/app/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "./Primitives";
import { useDemo } from "@/app/demo-context";

export function GameArt({
  game,
  hero = false,
}: {
  game: DemoGame;
  hero?: boolean;
}) {
  const gradient = useId().replaceAll(":", "");
  return (
    <div
      className={`game-art art-${game.palette} ${hero ? "hero-art" : ""}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 600 330" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={gradient} x2="0.7" y2="1">
            <stop stopColor="var(--art-top)" />
            <stop offset="1" stopColor="var(--art-bottom)" />
          </linearGradient>
        </defs>
        <rect width="600" height="330" fill={`url(#${gradient})`} />
        <circle cx="405" cy="105" r="62" fill="var(--art-glow)" opacity=".65" />
        <circle
          cx="405"
          cy="105"
          r="86"
          fill="none"
          stroke="var(--art-line)"
          opacity=".25"
        />
        <path
          d="M0 270L140 130 230 225 340 140 470 265 600 180V330H0Z"
          fill="var(--art-far)"
        />
        <path
          d="M0 310L150 230 255 270 380 185 600 320V330H0Z"
          fill="var(--art-near)"
        />
        {game.palette === "neon" && (
          <g fill="#0d1229" stroke="#d45afa" strokeWidth="2">
            {[90, 150, 215, 280, 350, 465, 530].map((x, i) => (
              <path key={x} d={`M${x} 330V${100 + (i % 3) * 35}h40V330`} />
            ))}
          </g>
        )}
        <path
          d="M-30 270Q300 110 640 250"
          fill="none"
          stroke="var(--art-line)"
          opacity=".5"
          strokeWidth="2"
        />
        <g fill="white" opacity=".5">
          {[35, 120, 270, 315, 530, 560].map((x, i) => (
            <circle key={x} cx={x} cy={25 + (i % 3) * 30} r="1.5" />
          ))}
        </g>
      </svg>
      <span className="art-wordmark">{game.monogram}</span>
      <span className="art-caption">{game.tagline}</span>
    </div>
  );
}
export function GameCard({ game }: { game: DemoGame }) {
  const { runAction } = useDemo();
  return (
    <article className="game-card">
      <a href={gameHref(game.appId)} aria-label={`Open ${game.name}`}>
        <GameArt game={game} />
        <div className="game-card-body">
          <div className="game-card-title">
            <h3>{game.name}</h3>
            <ArrowUpRight aria-hidden="true" className="size-4" />
          </div>
          <p>{game.genre}</p>
          <div className="game-card-footer">
            <StatusBadge tone={game.demoInstalled ? "green" : "neutral"}>
              {game.demoInstalled ? "Demo installed" : "Demo not installed"}
            </StatusBadge>
            <span>
              <Clock3 className="size-3" />
              {game.hours}h
            </span>
          </div>
        </div>
      </a>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="icon-sm"
            className="game-menu"
            aria-label={`Actions for ${game.name}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <a href={gameHref(game.appId)}>Open game details</a>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => runAction("Metadata preview", game.appId)}
          >
            Simulate metadata refresh
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  );
}
export function GameTable({ games }: { games: DemoGame[] }) {
  return (
    <div className="table-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Game</TableHead>
            <TableHead>Genre</TableHead>
            <TableHead>Demo installation</TableHead>
            <TableHead>Sample playtime</TableHead>
            <TableHead>
              <span className="sr-only">Details</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {games.map((game) => (
            <TableRow key={game.appId}>
              <TableCell>
                <a className="table-game" href={gameHref(game.appId)}>
                  <span className={`mini-art art-${game.palette}`}>
                    {game.monogram}
                  </span>
                  <span>
                    <strong>{game.name}</strong>
                    <small>AppID {game.appId} · fixture</small>
                  </span>
                </a>
              </TableCell>
              <TableCell>{game.genre}</TableCell>
              <TableCell>
                <StatusBadge tone={game.demoInstalled ? "green" : "neutral"}>
                  {game.demoInstalled ? "Demo installed" : "Demo not installed"}
                </StatusBadge>
              </TableCell>
              <TableCell>{game.hours} hours</TableCell>
              <TableCell>
                <Button asChild size="icon-sm" variant="ghost">
                  <a
                    href={gameHref(game.appId)}
                    aria-label={`Open ${game.name}`}
                  >
                    <ArrowUpRight />
                  </a>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
