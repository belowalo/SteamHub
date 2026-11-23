import type { GameStatusSummary } from "@/api/workspace";

export function compatibilityLabel(summary?: GameStatusSummary) {
  const requirements = summary?.compatibility.requirements ?? [];
  if (requirements.some((r) => r.kind === "known_issue")) return "Known issue";
  if (requirements.some((r) => ["account", "launcher"].includes(r.kind)))
    return "Launcher / account required";
  if (requirements.some((r) => ["drm", "anticheat"].includes(r.kind)))
    return "Protection requirements";
  return summary?.compatibility.complete && !summary.stale
    ? "No known restrictions"
    : "Unknown / untested";
}
