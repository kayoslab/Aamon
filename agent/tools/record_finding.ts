import { defineTool } from "eve/tools";
import { FindingSchema, appendFinding, logActivity } from "../lib/engagement";

/**
 * Record a single finding. Findings are the product of the
 * engagement. In assist mode they are first-iteration drafts for a human
 * pentester to confirm or reject; keep `status: "draft"`/`"needs_review"` and be
 * honest about `confidence`. Follow the QA principle: do not report things that
 * are not actually vulnerabilities.
 */
export default defineTool({
  description:
    "Record a single security finding with severity, CVSS 3.1 score and vector, CWE, affected assets, " +
    "evidence, reproducible steps, impact, remediation, and references. " +
    "Findings get sequential IDs (A-01, A-02, …). One call per distinct issue. Use draft/needs_review " +
    "and honest confidence for first-iteration findings a human will validate.",
  inputSchema: FindingSchema,
  label: { start: (f) => `Finding [${f.severity}]: ${f.title}` },
  async execute(finding, ctx) {
    const sandbox = await ctx.getSandbox();
    const id = await appendFinding(sandbox, finding);
    await logActivity(sandbox, `finding recorded ${id}: [${finding.severity}] ${finding.title}`);
    return { recorded: true, id, path: `engagement/findings/${id}.md` };
  },
});
