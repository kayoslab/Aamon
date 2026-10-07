import { defineTool } from "eve/tools";
import { z } from "zod";
import { logActivity } from "../lib/engagement";
import { PlanTaskInput, upsertTasks, openTasks, PLAN_MD } from "../lib/plan";

/**
 * Build and maintain the living test plan (engagement/plan.md). Call it first to
 * lay out the backlog of concrete tests, then after every pass to mark tasks
 * done (with evidence) and ADD the new tasks you discovered. finalize_engagement
 * refuses while any task is still open/in_progress, so this is how you drive an
 * engagement across multiple iterations instead of a single shallow pass.
 *
 * The plan is a tree: pass `parentId` (and `originFindingId`) to deepen an area
 * of interest into a sub-plan. Depth is capped at MAX_AREA_DEPTH; a child beyond
 * the cap is rejected (defer it instead). To spawn a deepening area that a
 * fresh-context worker will investigate, prefer `open_area`, which also writes
 * the worker's brief.
 *
 * Root-only: the orchestrator owns the plan; subagents report back and the
 * orchestrator records their results here (avoids concurrent-write races).
 */
export default defineTool({
  description:
    "Create or update the engagement's test plan — a backlog of concrete test tasks with statuses " +
    "(open/in_progress/done/deferred). Call it once up front to lay out the plan, then after every " +
    "iteration to update statuses (with evidence in `note`) and append newly-discovered tasks. Pass " +
    "`parentId`/`originFindingId` to deepen a finding into a sub-plan (the plan is a tree, depth-capped). " +
    "The engagement cannot be finalized while any task is open or in_progress.",
  availableInSubagents: false,
  inputSchema: z.object({
    tasks: z.array(PlanTaskInput).min(1).describe("Tasks to add (omit id) or update (include id)."),
    iteration: z.number().int().min(1).default(1).describe("Which pass this update belongs to (increment each pass)."),
  }),
  label: { start: ({ tasks, iteration }) => `Update plan: ${tasks.length} task(s), pass ${iteration}` },
  async execute({ tasks, iteration }, ctx) {
    const sandbox = await ctx.getSandbox();
    const { tasks: all, counts, rejected } = await upsertTasks(sandbox, tasks, iteration);
    await logActivity(
      sandbox,
      `plan updated (pass ${iteration}): ${JSON.stringify(counts)}${rejected.length ? ` rejected=${rejected.length}` : ""}`,
    );
    const remaining = openTasks(all).length;
    return {
      ok: true,
      path: PLAN_MD,
      counts,
      ...(rejected.length ? { rejected } : {}),
      message:
        (rejected.length
          ? `${rejected.length} task(s) were rejected (see 'rejected'); fix the parentId or defer at max depth. `
          : "") +
        (remaining > 0
          ? `${remaining} task(s) still open/in_progress. Keep working, and add any new leads you found before the next pass.`
          : "All tasks resolved (done/deferred). Do a review pass for new leads. Note: finalize_engagement " +
            "also runs a coverage gate (enough completed tasks, across enough vulnerability classes, over " +
            "enough endpoints), so if the plan is still narrow, broaden it before finalizing."),
    };
  },
});
