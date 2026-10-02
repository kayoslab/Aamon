import { defineTool } from "eve/tools";
import { z } from "zod";
import { stopScan } from "../lib/scans";
import { logActivity } from "../lib/engagement";

/** Stop a detached scan early (kills the process group). */
export default defineTool({
  description: "Stop a detached scan (from scan_start) early by id, killing its process group in the sandbox.",
  inputSchema: z.object({ id: z.string().min(1).describe("The scan id to stop.") }),
  label: { start: ({ id }) => `Stop scan ${id}` },
  async execute({ id }, ctx) {
    const sandbox = await ctx.getSandbox();
    await stopScan(sandbox, id);
    await logActivity(sandbox, `scan ${id} stopped by request`);
    return { stopped: true, id };
  },
});
