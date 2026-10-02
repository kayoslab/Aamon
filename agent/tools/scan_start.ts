import { defineTool } from "eve/tools";
import { z } from "zod";
import { newScanId, startScan } from "../lib/scans";
import { logActivity } from "../lib/engagement";

/**
 * Launch a potentially long-running command (nuclei, ffuf, sqlmap, a big loop)
 * as a DETACHED process in the sandbox and return immediately. The scan then
 * runs in the sandbox independently of any function invocation, so it cannot hit
 * the ~800s per-invocation timeout. Poll it with scan_poll. Use this for
 * anything that might run more than a couple of minutes, instead of a blocking
 * bash call.
 */
export default defineTool({
  description:
    "Start a long-running shell command as a detached sandbox process and return a scan id immediately " +
    "(does NOT wait for it). Use for scans/commands that may run more than ~2 minutes (nuclei, ffuf, " +
    "sqlmap, large loops) so they don't block an invocation or hit the platform timeout. Poll with " +
    "scan_poll; stop early with scan_stop. A watchdog kills the scan after maxSeconds.",
  inputSchema: z.object({
    command: z.string().min(1).describe("The shell command to run (executed with bash)."),
    label: z.string().default("").describe("Short description for the audit trail."),
    maxSeconds: z
      .number()
      .int()
      .min(30)
      .max(3000)
      .default(1500)
      .describe("Hard wall-clock cap; the process is killed if it runs longer."),
  }),
  label: { start: ({ label, command }) => `Start scan: ${label || command.slice(0, 60)}` },
  async execute({ command, label, maxSeconds }, ctx) {
    const sandbox = await ctx.getSandbox();
    const id = newScanId();
    await startScan(sandbox, id, command, maxSeconds);
    await logActivity(sandbox, `scan started ${id} (max ${maxSeconds}s)${label ? `: ${label}` : ""}`);
    return {
      started: true,
      id,
      maxSeconds,
      message: `Scan ${id} launched detached. Poll it with scan_poll({ id: "${id}" }); do other useful work between polls.`,
    };
  },
});
