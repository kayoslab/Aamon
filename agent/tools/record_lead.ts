import { defineTool } from "eve/tools";
import { z } from "zod";
import { logActivity } from "../lib/engagement";
import { LeadInput, upsertLeads, leadResolved, LEADS_MD } from "../lib/campaign";

/**
 * Record or update exploitation leads — the ranked backlog produced by triaging
 * the recon corpus, and worked during exploitation. In triage you create leads
 * (CVEs prioritized by KEV/EPSS, weaknesses, chains); in exploitation you update
 * each lead's status to exploited / ruled_out / deferred. The campaign cannot
 * leave triage until enough leads exist, nor exploitation until all are resolved.
 * Root-only so parallel work doesn't race on the shared backlog.
 */
export default defineTool({
  description:
    "Create or update exploitation leads (the triage backlog): known CVEs (KEV/EPSS-first), weaknesses, and " +
    "chains, each with target, priority, hypothesis, and status. Create them in triage; resolve them " +
    "(exploited/ruled_out/deferred, with evidence in note) during exploitation. One call can add/update many.",
  availableInSubagents: false,
  inputSchema: z.object({
    leads: z.array(LeadInput).min(1).describe("Leads to add (omit id) or update (include id)."),
  }),
  label: { start: ({ leads }) => `Record ${leads.length} lead(s)` },
  async execute({ leads }, ctx) {
    const sandbox = await ctx.getSandbox();
    const all = await upsertLeads(sandbox, leads);
    const open = all.filter((l) => !leadResolved(l)).length;
    const byPriority = Object.fromEntries(
      (["kev", "critical", "high", "medium", "low"] as const).map((p) => [p, all.filter((l) => l.priority === p).length]),
    );
    await logActivity(sandbox, `leads updated: total=${all.length} open=${open} ${JSON.stringify(byPriority)}`);
    return {
      ok: true,
      path: LEADS_MD,
      total: all.length,
      open,
      resolved: all.length - open,
      byPriority,
      message:
        open > 0
          ? `${open} lead(s) still open. In exploitation, drive each to exploited/ruled_out/deferred.`
          : "All leads resolved. If the exploitation gate and coverage gate pass, advance to reporting.",
    };
  },
});
