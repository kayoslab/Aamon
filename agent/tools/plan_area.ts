import { defineTool } from "eve/tools";
import { z } from "zod";
import { logActivity } from "../lib/engagement";
import { AreaTaskInput, upsertAreaTasks, areaPlanMdPath } from "../lib/areas";

/**
 * Plan and track the sub-plan for the ONE area you are working.
 *
 * When you are dispatched to an area of interest (at or above the sub-planning
 * depth), you start by laying out a scoped backlog of the concrete tests the
 * hypothesis implies, then work it, updating each test's status as you go. This
 * is that backlog: it lives under your own area directory
 * (engagement/areas/<areaId>/plan.jsonl), so it is race-safe — you only ever
 * touch the plan of the area you were sent to work, never the global plan.
 *
 * Available to subagents (this is the worker's planning step). The global test
 * plan and the area tree stay with the orchestrator (update_plan / open_area).
 */
export default defineTool({
  description:
    "Create or update the sub-plan for the area you are currently working: a scoped backlog of concrete " +
    "tests for THIS area, with statuses (open/in_progress/done/deferred). Call it first to plan how you'll " +
    "expand the area, then again to mark tests done (with evidence) and add tests a result opens up. Writes " +
    "only to your own area's directory. (A genuinely deeper thread goes out via record_subarea, not here.)",
  availableInSubagents: true,
  inputSchema: z.object({
    areaId: z.string().describe("The id of the area you are working (from your brief)."),
    tasks: z.array(AreaTaskInput).min(1).describe("Tests to add (omit id) or update (include id)."),
  }),
  label: { start: ({ areaId, tasks }) => `Plan area ${areaId}: ${tasks.length} test(s)` },
  async execute({ areaId, tasks }, ctx) {
    const sandbox = await ctx.getSandbox();
    const { tasks: all, open } = await upsertAreaTasks(sandbox, areaId, tasks);
    await logActivity(sandbox, `area sub-plan ${areaId}: ${all.length} tests, ${open} open`);
    return {
      ok: true,
      areaId,
      path: areaPlanMdPath(areaId),
      total: all.length,
      open,
      message:
        open > 0
          ? `${open} sub-plan test(s) still open/in_progress. Work them, then report. Don't report this area complete until all are done or deferred.`
          : "All sub-plan tests resolved. Report your findings and any deeper sub-areas, then finish.",
    };
  },
});
