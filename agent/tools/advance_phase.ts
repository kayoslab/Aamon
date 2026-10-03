import { defineTool } from "eve/tools";
import { z } from "zod";
import { logActivity } from "../lib/engagement";
import { readCampaign, initCampaign, setPhase, nextPhase, canLeavePhase, type Phase } from "../lib/campaign";

/**
 * Advance the campaign to its next phase. Refuses unless the current phase's
 * exit criteria are met (read from real artifacts), so recon cannot be skipped,
 * triage cannot be skipped, and the run cannot jump to reporting after one pass.
 * Root-only: the orchestrator owns phase progression.
 */
const GUIDANCE: Record<Phase, string> = {
  planning:
    "PLANNING: build a large, concrete attack plan with update_plan (one task per endpoint x vulnerability " +
    "class, per role x boundary, per abuse case, per fingerprinted component). This is the backbone of the campaign.",
  recon:
    "RECON: fan out with the agent tool (up to 4 parallel subagents across distinct surfaces/subdomains) and " +
    "enumerate exhaustively — subdomains, crawl (katana), historical URLs (gau), content + parameter discovery " +
    "(ffuf/arjun + SecLists), JS endpoint mining, API schemas, and precise fingerprinting of every component. " +
    "Each recon worker records what it finds with record_recon. LAUNCH THE BIG DETACHED SCANS with scan_start " +
    "(full nuclei template sets, large ffuf wordlists, deep crawl) and let them run to completion (scan_poll) — " +
    "this is what makes the campaign take hours, and the gate will not let you leave recon until they finish.",
  triage:
    "TRIAGE: read the whole recon corpus and turn it into a ranked exploitation backlog with record_lead — " +
    "every applicable CVE (query live, prioritize CISA KEV then EPSS), every weakness, and every candidate chain, " +
    "each with the access it would yield and the proof it needs.",
  exploitation:
    "EXPLOITATION: work the leads highest-priority first, fanning out across distinct targets. Drive each to a " +
    "demonstrated, non-destructive proof of access; escalate every foothold; chain findings toward full control. " +
    "Update each lead's status (exploited / ruled_out / deferred) with record_lead, and record findings.",
  reporting:
    "REPORTING: consolidate the chain from unauthenticated to control, then call finalize_engagement.",
};

export default defineTool({
  description:
    "Advance the campaign to its next phase (planning → recon → triage → exploitation → reporting). " +
    "Refuses while the current phase's exit criteria are unmet and tells you exactly what is missing. " +
    "This is how the engagement progresses; you cannot finalize before reaching the reporting phase.",
  availableInSubagents: false,
  inputSchema: z.object({
    note: z.string().default("").describe("Optional note on what this phase accomplished."),
  }),
  label: { start: () => `Advance campaign phase` },
  async execute({ note }, ctx) {
    const sandbox = await ctx.getSandbox();
    const campaign = (await readCampaign(sandbox)) ?? (await initCampaign(sandbox));
    const from = campaign.phase;
    const to = nextPhase(from);
    if (to === null) {
      return { advanced: false, phase: from, message: "Already in the final phase (reporting). Call finalize_engagement to close." };
    }
    const gate = await canLeavePhase(sandbox, from);
    if (!gate.ok) {
      return {
        advanced: false,
        phase: from,
        blocked: true,
        missing: gate.missing,
        message: `Cannot leave the ${from} phase yet. Resolve the items below, then advance.`,
      };
    }
    await setPhase(sandbox, to);
    await logActivity(sandbox, `campaign phase: ${from} -> ${to}${note ? ` (${note})` : ""}`);
    return { advanced: true, from, to, guidance: GUIDANCE[to] };
  },
});
