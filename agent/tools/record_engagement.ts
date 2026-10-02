import { defineTool } from "eve/tools";
import { EngagementSchema, writeEngagement, logActivity, BRIEFING_PATH } from "../lib/engagement";

/**
 * Intake for the briefing / checklist. The model reads the briefing the user
 * provides (a scope / requirements document) and records the
 * structured engagement here. This is the single source of truth every other
 * tool and subagent reads from, and a prerequisite for any active testing:
 * check_scope reads the scope written here.
 */
export default defineTool({
  description:
    "Record the structured engagement extracted from the briefing: client, system purpose, " +
    "web pentest types (web_app / web_services), box level, scope, availability/environment, attacker model, " +
    "worst-case/abuse cases, access and roles, technology, rules of engagement, and operating mode. " +
    "Call this once after reading the briefing and confirming authorization, before any active testing.",
  inputSchema: EngagementSchema,
  label: { start: (e) => `Record engagement: ${e.name}` },
  async execute(engagement, ctx) {
    const sandbox = await ctx.getSandbox();
    await writeEngagement(sandbox, engagement);

    const list = (xs: string[]) => (xs.length ? xs.map((s) => `- ${s}`).join("\n") : "- (none)");
    const auth = engagement.authorization;
    const md = [
      `# Engagement: ${engagement.name}`,
      ``,
      `- **Client:** ${engagement.client.organization} (contact: ${engagement.client.primaryContact || "n/a"})`,
      `- **Types:** ${engagement.pentestTypes.join(", ")}  ·  **Box:** ${engagement.box}  ·  **Mode:** ${engagement.mode}`,
      `- **Report language:** ${engagement.reportLanguage}` +
        (engagement.effortPersonDays ? `  ·  **Effort:** ${engagement.effortPersonDays} person-days` : ``),
      `- **Authorized by:** ${auth.authorizedBy}` + (auth.reference ? ` (${auth.reference})` : ``),
      `- **Window:** ${auth.windowStart ?? auth.expectedDate ?? "n/a"} → ${auth.windowEnd ?? "n/a"}`,
      `- **Availability:** ${engagement.availability}  ·  **Environment:** ${engagement.environment}  ·  **Target group:** ${engagement.targetGroup || "n/a"}`,
      `- **Attacker model:** ${engagement.attackerModel.join(", ") || "n/a"}`,
      `- **Access:** ${engagement.access.method}${engagement.access.details ? ` — ${engagement.access.details}` : ``}`,
      ``,
      `## System purpose`,
      engagement.systemPurpose || "(not specified)",
      ``,
      `## In scope (endpoints to be tested)`,
      list(engagement.scope.inScope),
      ``,
      `## Out of scope`,
      list(engagement.scope.outOfScope),
      ``,
      `## Underlying technology`,
      engagement.underlyingTechnology || "(not specified)",
      ``,
      `## Roles / test accounts`,
      list(engagement.roles),
      ``,
      `## Worst-case scenario`,
      engagement.worstCase || "(not specified)",
      ``,
      `## Abuse cases`,
      list(engagement.abuseCases),
      ``,
      `## Protection goals`,
      list(engagement.protectionGoals),
      ``,
      `## Objectives`,
      list(engagement.objectives),
      ``,
      `## Rules of engagement / constraints`,
      list(engagement.constraints),
      ``,
      `## Prior knowledge`,
      engagement.knowledge.priorFindings || "(none)",
      engagement.knowledge.notes ? `\n${engagement.knowledge.notes}` : ``,
    ]
      .filter((l) => l !== ``)
      .join("\n");
    await sandbox.writeTextFile({ path: BRIEFING_PATH, content: md });
    await logActivity(
      sandbox,
      `engagement recorded: ${engagement.name} [types=${engagement.pentestTypes.join("/")}, mode=${engagement.mode}]`,
    );

    return {
      recorded: true,
      mode: engagement.mode,
      pentestTypes: engagement.pentestTypes,
      box: engagement.box,
      inScopeCount: engagement.scope.inScope.length,
      outOfScopeCount: engagement.scope.outOfScope.length,
      message:
        "Engagement recorded. All active testing must pass check_scope against these targets. " +
        "Confirm the scope, box level, attacker model, and rules of engagement with the operator, and " +
        "load the domain skill(s) for the recorded pentest types before planning.",
    };
  },
});
