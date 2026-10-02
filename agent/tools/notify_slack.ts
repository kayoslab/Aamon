import { defineTool } from "eve/tools";
import { z } from "zod";
import { readEngagement, readFindings, logActivity, REPORT_PATH } from "../lib/engagement";
import { postSlackNotification } from "../lib/notify";

/**
 * Post the report summary and findings to the team's Slack channel via the
 * standard eve Slack connection, with the full report delivered as threaded
 * replies. Prefer `finalize_engagement`, which compiles and notifies together;
 * use this alone only to re-send a notification. Root-only so a fan-out
 * subagent cannot post duplicates.
 */
export default defineTool({
  description:
    "Post the compiled report summary and findings to the team's Slack channel (full report follows " +
    "in-thread). Prefer finalize_engagement; use this alone only to re-send a notification.",
  availableInSubagents: false,
  inputSchema: z.object({
    note: z.string().default("").describe("Short headline note to lead with (e.g. top risks)."),
    title: z.string().optional().describe("Override the message title."),
  }),
  label: { start: () => `Notify Slack` },
  async execute({ note, title }, ctx) {
    const sandbox = await ctx.getSandbox();
    const engagement = await readEngagement(sandbox);
    const findings = await readFindings(sandbox);
    const reportRes = await sandbox.run({ command: `cat ${JSON.stringify(REPORT_PATH)} 2>/dev/null` });
    const reportMarkdown = reportRes.exitCode === 0 ? reportRes.stdout : "";
    const result = await postSlackNotification({ engagement, findings, reportMarkdown, note, title, signal: ctx.abortSignal });
    await logActivity(sandbox, `slack notify: sent=${result.sent}${result.error ? ` err=${result.error}` : ""}`);
    return result;
  },
});
