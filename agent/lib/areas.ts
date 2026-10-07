import { z } from "zod";
import type { RuntimeSandboxSession } from "eve/sandbox";
import { ROOT, readTextOrNull } from "./engagement";
import { RECON_DIR } from "./campaign";
import { PlanPriority, type PlanTask } from "./plan";

/**
 * Areas of interest — the file-level plumbing for finding-driven deepening.
 *
 * Each area of interest is a plan task worked in a FRESH context by a dispatched
 * worker (the built-in `agent` tool). The orchestrator hands the worker its
 * context at the FILE level, not by stuffing it into the prompt: it writes a
 * brief at engagement/areas/<taskId>/brief.md (the originating finding, the
 * relevant slice of recon, the hypothesis, scope, and the worker contract). The
 * worker reports any deeper sub-areas it uncovers by appending to its own
 * engagement/areas/<taskId>/discovered.jsonl — each worker owns its own area
 * directory, so parallel workers never race on the same file. The orchestrator
 * reads those back and opens the ones worth pursuing as child areas (depth+1).
 */

export const AREAS_DIR = `${ROOT}/areas`;
export const areaDir = (taskId: string) => `${AREAS_DIR}/${taskId}`;
export const briefPath = (taskId: string) => `${areaDir(taskId)}/brief.md`;
export const discoveredPath = (taskId: string) => `${areaDir(taskId)}/discovered.jsonl`;

export const SubareaInput = z.object({
  area: z.string().describe("Vulnerability class / area of the deeper sub-problem, e.g. 'ssrf', 'idor', 'cve:oxygen'."),
  hypothesis: z.string().describe("The specific deeper weakness this sub-area would prove, and the access it would yield."),
  why: z.string().describe("What you just observed that makes this worth a dedicated deeper investigation."),
  priority: PlanPriority.optional().describe("How urgent this sub-area is (default inherits medium)."),
});
export type SubareaInput = z.infer<typeof SubareaInput>;
export type Subarea = SubareaInput & { at: string };

async function ensureAreaDir(sandbox: RuntimeSandboxSession, taskId: string): Promise<void> {
  await sandbox.run({ command: `mkdir -p ${JSON.stringify(areaDir(taskId))}` });
}

export async function writeAreaBrief(sandbox: RuntimeSandboxSession, taskId: string, content: string): Promise<string> {
  await ensureAreaDir(sandbox, taskId);
  await sandbox.writeTextFile({ path: briefPath(taskId), content });
  return briefPath(taskId);
}

export async function readDiscovered(sandbox: RuntimeSandboxSession, taskId: string): Promise<Subarea[]> {
  const raw = await readTextOrNull(sandbox, discoveredPath(taskId));
  if (!raw) return [];
  return raw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Subarea);
}

/**
 * Append a discovered sub-area to this area's own file. Safe under parallel
 * workers because each worker only ever appends to the directory of the area it
 * was dispatched to work (non-overlapping write scopes).
 */
export async function appendDiscovered(sandbox: RuntimeSandboxSession, taskId: string, entry: Subarea): Promise<number> {
  await ensureAreaDir(sandbox, taskId);
  const existing = (await readTextOrNull(sandbox, discoveredPath(taskId))) ?? "";
  const content = existing + JSON.stringify(entry) + "\n";
  await sandbox.writeTextFile({ path: discoveredPath(taskId), content });
  return content.split("\n").filter((l) => l.trim() !== "").length;
}

/**
 * Pull the slice of the recon corpus relevant to this area, so the brief carries
 * the recon insight at the file level. Greps the recon slices for the area's
 * distinctive tokens (component names, endpoints, the target) and returns a
 * capped, de-duplicated excerpt.
 */
export async function reconContextFor(sandbox: RuntimeSandboxSession, terms: string[]): Promise<string> {
  const tokens = terms
    .flatMap((t) => (t ?? "").split(/[\s,]+/))
    .map((t) => t.replace(/[^\w.\-/:]/g, "").trim())
    .filter((t) => t.length >= 3)
    .slice(0, 12);
  if (tokens.length === 0) return "";
  const pattern = tokens.join("|");
  const res = await sandbox.run({
    command: `grep -rhiE ${JSON.stringify(pattern)} ${JSON.stringify(RECON_DIR)} 2>/dev/null | sort -u | head -40`,
  });
  return res.exitCode === 0 ? res.stdout.trim() : "";
}

/** Compose the worker's brief file for an area of interest. */
export function composeBrief(opts: {
  task: PlanTask;
  hypothesis: string;
  briefNotes?: string;
  originFindingId?: string;
  reconExcerpt?: string;
}): string {
  const { task, hypothesis, briefNotes, originFindingId, reconExcerpt } = opts;
  return [
    `# Area of interest: ${task.area}`,
    ``,
    `- Area id: \`${task.id}\`  ·  depth ${task.depth}  ·  priority ${task.priority}`,
    originFindingId ? `- Born from finding: \`${originFindingId}\`` : `- Seeded from triage.`,
    ``,
    `## Hypothesis`,
    hypothesis,
    ``,
    ...(briefNotes ? [`## Notes from the orchestrator`, briefNotes, ``] : []),
    ...(reconExcerpt ? [`## Relevant recon (from the shared recon corpus)`, "```", reconExcerpt, "```", ``] : []),
    `## Your contract (read carefully)`,
    `You are investigating THIS ONE area in a fresh context. You do not see the rest of the engagement's history —`,
    `everything you need is in this brief and in the shared sandbox (engagement/recon/, engagement/findings/).`,
    ``,
    `- Gate every target through \`check_scope\` before you touch it. Out-of-scope always wins.`,
    `- Non-destructive only: prove access with a minimal, safe proof; never run anything that could change state`,
    `  or take the target down. Pace against the one shared egress IP / rate-limit bucket; back off on 429/WAF.`,
    `- Drive this area to a demonstrated proof (or honestly rule it out). Record each VERIFIED finding with`,
    `  \`record_finding\` (evidence, reproduction, impact, CVSS/CWE/OWASP). No speculation, no false positives.`,
    `- When you uncover a DEEPER weakness or sub-problem, do NOT chase it here. Report it with \`record_subarea\``,
    `  (parentAreaId = \`${task.id}\`) so the orchestrator can dispatch a dedicated fresh-context deep-dive.`,
    `- Do NOT call update_plan, open_area, advance_phase, or finalize_engagement — those are the orchestrator's.`,
    ``,
    `When finished, return a compact summary: what you proved, what you ruled out, and the sub-areas you reported.`,
  ].join("\n");
}
