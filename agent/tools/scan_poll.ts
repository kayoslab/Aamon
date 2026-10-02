import { defineTool } from "eve/tools";
import { z } from "zod";
import { scanStatus, SCANS_DIR } from "../lib/scans";
import { logActivity } from "../lib/engagement";

/**
 * Check a detached scan started by scan_start: whether it finished, its exit
 * code, whether it's still running, and the tail of its output. Each call is a
 * short sandbox read, so polling never risks the invocation timeout.
 */
export default defineTool({
  description:
    "Poll a detached scan (from scan_start) by id: returns finished/running, exit code, and the tail of " +
    "its output. Call periodically until finished is true; full output is at engagement/.scans/<id>.out.",
  inputSchema: z.object({
    id: z.string().min(1).describe("The scan id returned by scan_start."),
    tailBytes: z.number().int().min(500).max(20000).default(6000).describe("How much of the output tail to return."),
  }),
  label: { start: ({ id }) => `Poll scan ${id}` },
  async execute({ id, tailBytes }, ctx) {
    const sandbox = await ctx.getSandbox();
    const s = await scanStatus(sandbox, id, tailBytes);
    if (s.finished) {
      await logActivity(sandbox, `scan ${id} finished (exit ${s.exitCode})`);
    }
    return {
      id,
      finished: s.finished,
      running: s.running,
      exitCode: s.exitCode,
      output: s.output,
      outputFile: `${SCANS_DIR}/${id}.out`,
      message: s.finished
        ? `Finished (exit ${s.exitCode}). Full output: ${SCANS_DIR}/${id}.out`
        : s.running
          ? "Still running — do other work and poll again shortly."
          : "Not finished and no live process found — it may have just completed; poll once more or read the output file.",
    };
  },
});
