import { defineTool } from "eve/tools";
import { z } from "zod";
import { readEngagement, readFindings, logActivity, TestedAreaSchema, REPORT_PATH } from "../lib/engagement";
import { buildReportMarkdown, severityCounts } from "../lib/report";

/**
 * Compile all recorded findings into a first-iteration report at
 * engagement/report.md, in the engagement's language and standard report structure.
 *
 * Prefer `finalize_engagement`, which compiles AND notifies in one call so the
 * notification step cannot be dropped. Use compile_report on its own only when
 * you explicitly want the report without notifying.
 */
export default defineTool({
  description:
    "Compile every recorded finding into a first-iteration report (engagement/report.md), ordered by " +
    "severity. Prefer finalize_engagement, which also notifies; use this alone only " +
    "to (re)generate the report without sending a notification.",
  inputSchema: z.object({
    managementSummary: z.string().describe("What was tested, overall posture, headline risks (a few sentences)."),
    recommendations: z.array(z.string()).default([]).describe("Prioritized, actionable recommendations (highest first)."),
    methodology: z.string().default("").describe("Approach, standards, tools, coverage and limits."),
    testedAreas: z.array(TestedAreaSchema).default([]).describe("The 'tested areas' overview with a status per area."),
  }),
  label: { start: () => `Compile engagement report` },
  async execute(opts, ctx) {
    const sandbox = await ctx.getSandbox();
    const engagement = await readEngagement(sandbox);
    const findings = await readFindings(sandbox);
    const lang = engagement?.reportLanguage ?? "en";
    const report = buildReportMarkdown(engagement, findings, opts, lang);
    await sandbox.writeTextFile({ path: REPORT_PATH, content: report });
    await logActivity(sandbox, `report compiled: ${findings.length} findings [lang=${lang}]`);
    return { compiled: true, path: REPORT_PATH, findingCount: findings.length, severityCounts: severityCounts(findings), language: lang };
  },
});
