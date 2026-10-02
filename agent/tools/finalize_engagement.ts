import { defineTool } from "eve/tools";
import { z } from "zod";
import { readEngagement, readFindings, logActivity, TestedAreaSchema, REPORT_PATH } from "../lib/engagement";
import { buildReportMarkdown, severityCounts } from "../lib/report";
import { postSlackNotification } from "../lib/notify";
import { readPlan, openTasks } from "../lib/plan";
import { evaluateCoverage } from "../lib/coverage";

/**
 * The single, mandatory closing step of every engagement: compile the report
 * AND deliver the notification in one call, so the notification can never be
 * dropped by forgetting a second tool call. Always end an engagement here.
 *
 * Root-only so a fan-out subagent cannot finalize or double-notify.
 */
export default defineTool({
  description:
    "FINALIZE the engagement: compile the first-iteration report (engagement/report.md) AND send the " +
    "completion notification to the team's Slack channel (full report delivered in-thread) in one call. " +
    "This is the required last step of every engagement — always end here instead of calling compile_report " +
    "and notify_slack separately.",
  availableInSubagents: false,
  inputSchema: z.object({
    managementSummary: z.string().describe("What was tested, overall posture, headline risks (a few sentences)."),
    recommendations: z.array(z.string()).default([]).describe("Prioritized, actionable recommendations (highest first)."),
    methodology: z.string().default("").describe("Approach, standards, tools, coverage and limits."),
    testedAreas: z.array(TestedAreaSchema).default([]).describe("The 'tested areas' overview with a status per area."),
    note: z.string().default("").describe("Short headline note for the notification (e.g. top risks)."),
  }),
  label: { start: () => `Finalize engagement (compile + notify)` },
  async execute({ managementSummary, recommendations, methodology, testedAreas, note }, ctx) {
    const sandbox = await ctx.getSandbox();

    // Gate: a plan must exist and be fully worked before an engagement can finalize.
    // This forces an explicit plan and real iteration instead of a single shallow pass.
    const plan = await readPlan(sandbox);
    if (plan.length === 0) {
      return {
        finalized: false,
        reason:
          "No test plan recorded. Build one with update_plan (a task per area × vulnerability class × " +
          "endpoint/abuse case), work it across iterations, then finalize.",
      };
    }
    const stillOpen = openTasks(plan);
    if (stillOpen.length > 0) {
      return {
        finalized: false,
        reason:
          `${stillOpen.length} plan task(s) are still open/in_progress. Keep testing: resolve each as ` +
          `done (with evidence in its note) or deferred (with a follow-up), and add any new leads you ` +
          `found, via update_plan. Only finalize once the plan is fully worked and a review pass surfaces ` +
          `no new leads.`,
        openTasks: stillOpen.slice(0, 25).map((t) => ({ id: t.id, area: t.area, task: t.task, status: t.status })),
      };
    }

    const engagement = await readEngagement(sandbox);
    const findings = await readFindings(sandbox);
    const lang = engagement?.reportLanguage ?? "en";

    // Coverage gate: a fully-worked plan is not enough — it must be a BROAD plan.
    // This is the machine-enforced depth guardrail that replaces human-approval
    // friction, so an autonomous run can't finish after a shallow sweep. It gates
    // on coverage, never on finding count. Tunable via AAMON_* env (see lib/coverage).
    const coverage = evaluateCoverage(plan, findings);
    if (!coverage.pass) {
      await logActivity(
        sandbox,
        `finalize blocked by coverage gate: done=${coverage.doneCount} classes=${coverage.classesCovered.length} endpoints=${coverage.endpoints}`,
      );
      return {
        finalized: false,
        reason:
          "Coverage gate — the engagement is not broad enough to finalize yet. " +
          coverage.reasons.join(" ") +
          " Expand the plan with update_plan, complete those tests across several passes, then finalize. " +
          "This gate is tunable via AAMON_COVERAGE_GATE / AAMON_MIN_DONE_TASKS / AAMON_MIN_CLASSES / AAMON_MIN_ENDPOINTS.",
        coverage: {
          completedTasks: coverage.doneCount,
          classesCovered: coverage.classesCovered,
          classesMissing: coverage.classesMissing,
          endpointsTested: coverage.endpoints,
        },
      };
    }

    const report = buildReportMarkdown(engagement, findings, { managementSummary, recommendations, methodology, testedAreas }, lang);
    await sandbox.writeTextFile({ path: REPORT_PATH, content: report });
    await logActivity(sandbox, `finalize: report compiled (${findings.length} findings, lang=${lang})`);

    const notify = await postSlackNotification({ engagement, findings, reportMarkdown: report, note, signal: ctx.abortSignal });
    await logActivity(sandbox, `finalize: notify sent=${notify.sent}${notify.error ? ` err=${notify.error}` : ""}`);

    return {
      finalized: true,
      report: { path: REPORT_PATH, findingCount: findings.length, severityCounts: severityCounts(findings), language: lang },
      notification: notify,
      message: notify.sent
        ? "Report compiled and notification delivered."
        : `Report compiled, but notification was not delivered: ${notify.error}. Tell the operator the report path.`,
    };
  },
});
