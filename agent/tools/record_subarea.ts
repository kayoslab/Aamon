import { defineTool } from "eve/tools";
import { z } from "zod";
import { logActivity } from "../lib/engagement";
import { SubareaInput, appendDiscovered } from "../lib/areas";

/**
 * Report a DEEPER sub-area of interest discovered while working an area.
 *
 * A dispatched worker runs in a fresh context and must not chase every thread it
 * finds, nor touch the shared plan (that would race the orchestrator). When it
 * uncovers a deeper weakness or sub-problem worth its own investigation, it calls
 * this: the sub-area is appended to the worker's OWN area file
 * (engagement/areas/<parentAreaId>/discovered.jsonl), which is race-safe because
 * each worker only writes under the area it was dispatched to. The orchestrator
 * reads these back and opens the worthwhile ones as child areas (depth+1) with a
 * fresh-context worker of their own — that is how the investigation recurses.
 *
 * Available to subagents (this is the worker's way to deepen); the orchestrator
 * does the actual opening with open_area.
 */
export default defineTool({
  description:
    "Report a deeper sub-area of interest you uncovered while working the current area (a weakness/sub-problem " +
    "that deserves its own dedicated deep-dive). Pass parentAreaId = the id of the area you are working. The " +
    "orchestrator will open the worthwhile ones as child areas. Use this instead of chasing the thread yourself.",
  availableInSubagents: true,
  inputSchema: SubareaInput.extend({
    parentAreaId: z.string().describe("The id of the area you are currently working (from your brief)."),
  }),
  label: { start: ({ area, parentAreaId }) => `Sub-area: ${area} (under ${parentAreaId})` },
  async execute({ parentAreaId, area, hypothesis, why, priority }, ctx) {
    const sandbox = await ctx.getSandbox();
    const count = await appendDiscovered(sandbox, parentAreaId, { area, hypothesis, why, priority, at: new Date().toISOString() });
    await logActivity(sandbox, `sub-area reported under ${parentAreaId}: ${area}`);
    return {
      recorded: true,
      parentAreaId,
      discoveredCount: count,
      message: "Reported. Keep working your current area; the orchestrator will dispatch a deep-dive for this sub-area.",
    };
  },
});
