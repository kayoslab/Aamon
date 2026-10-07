import { defineTool } from "eve/tools";
import { z } from "zod";
import { logActivity } from "../lib/engagement";
import { upsertTasks, PlanPriority } from "../lib/plan";
import { composeBrief, writeAreaBrief, reconContextFor, briefPath } from "../lib/areas";

/**
 * Open an AREA OF INTEREST for a fresh-context deep-dive.
 *
 * This is the deepening primitive. It (1) records the area as a plan task — a
 * child of `parentId` when it deepens another area, so the plan stays a tree and
 * depth is capped — and (2) writes the worker's brief at
 * engagement/areas/<id>/brief.md, seeded with the originating finding, the
 * relevant slice of recon (pulled from the recon corpus at the file level), the
 * hypothesis, scope, and the worker contract. It returns a `dispatchMessage` to
 * hand straight to the built-in `agent` tool, so the area is investigated in a
 * fresh context that doesn't inherit the orchestrator's history.
 *
 * Root-only: only the orchestrator opens areas and owns the plan. A dispatched
 * worker reports deeper sub-areas with `record_subarea` instead; the orchestrator
 * reads those and opens the ones worth pursuing (as children, depth+1).
 */
export default defineTool({
  description:
    "Open an area of interest for a fresh-context deep-dive: record it as a (tree) plan task and write the " +
    "worker's brief (origin finding + relevant recon + hypothesis + scope) to engagement/areas/<id>/brief.md. " +
    "Returns a dispatchMessage to pass to the `agent` tool. Use this to deepen a finding/weakness into its own " +
    "investigation; pass parentId to nest it under the area it came from (depth is capped).",
  availableInSubagents: false,
  inputSchema: z.object({
    area: z.string().describe("Vulnerability class / area, e.g. 'ssrf', 'idor', 'cve:oxygen', 'auth-bypass'."),
    task: z.string().describe("The concrete objective for this area (what to prove), not a vague topic."),
    hypothesis: z.string().describe("The specific weakness to prove and the access/impact it would yield."),
    parentId: z.string().optional().describe("Parent area id when this deepens another area (makes it a child, depth+1)."),
    originFindingId: z.string().optional().describe("Finding id that spawned this area (e.g. 'A-03'), when born from a finding."),
    priority: PlanPriority.optional().describe("Worklist priority (default medium)."),
    briefNotes: z.string().default("").describe("Anything extra the worker should know that isn't in recon (optional)."),
    reconTerms: z
      .array(z.string())
      .default([])
      .describe("Extra tokens (components, endpoints, hosts) to grep the recon corpus for when seeding the brief."),
  }),
  label: { start: ({ area, parentId }) => `Open area: ${area}${parentId ? ` (child of ${parentId})` : ""}` },
  async execute({ area, task, hypothesis, parentId, originFindingId, priority, briefNotes, reconTerms }, ctx) {
    const sandbox = await ctx.getSandbox();

    const { tasks, rejected, resultIds } = await upsertTasks(
      sandbox,
      [{ area, task, status: "open", note: "", parentId, originFindingId, priority }],
      1,
    );
    if (rejected.length > 0 || !resultIds[0]) {
      return { opened: false, reason: rejected[0]?.reason ?? "Could not create the area task." };
    }
    const areaId = resultIds[0];
    const created = tasks.find((t) => t.id === areaId)!;

    const reconExcerpt = await reconContextFor(sandbox, [area, task, ...(reconTerms ?? [])]);
    const brief = composeBrief({ task: created, hypothesis, briefNotes, originFindingId, reconExcerpt });
    await writeAreaBrief(sandbox, areaId, brief);
    await logActivity(sandbox, `area opened ${areaId} (depth ${created.depth}): ${area}`);

    const dispatchMessage =
      `Investigate the area of interest described in ${briefPath(areaId)}. Read that file FIRST — it carries the ` +
      `hypothesis, the relevant recon, the scope rules, and your contract. Work ONLY this area, in scope and ` +
      `non-destructively. Record each verified finding with record_finding. For any deeper sub-problem you uncover, ` +
      `call record_subarea with parentAreaId="${areaId}" (do not chase it yourself). Do not call update_plan, ` +
      `open_area, advance_phase, or finalize_engagement. Finish with a compact summary of what you proved, ruled ` +
      `out, and reported.`;

    return {
      opened: true,
      areaId,
      depth: created.depth,
      briefPath: briefPath(areaId),
      dispatchMessage,
      next: `Dispatch a fresh-context worker: call the \`agent\` tool with message = dispatchMessage. On completion, ` +
        `read engagement/areas/${areaId}/discovered.jsonl, open the worthwhile sub-areas (open_area with ` +
        `parentId="${areaId}"), then mark this area done via update_plan (id="${areaId}", status="done", with evidence).`,
    };
  },
});
