import { defineTool } from "eve/tools";
import { z } from "zod";
import { evaluateScope } from "../lib/scope";
import { readEngagement, logActivity } from "../lib/engagement";

/**
 * The scope gate. Every active interaction with a target — a scan, a request, a
 * connection, an exploit attempt — must be checked here first. Out-of-scope
 * rules always win. A target that matches no in-scope rule is treated as NOT
 * authorized. This is a safe, read-only tool available to subagents.
 */
export default defineTool({
  description:
    "Check whether one or more targets (IP, CIDR, hostname, wildcard domain, or URL) are inside the " +
    "authorized engagement scope. ALWAYS call this before any active testing of a target. Out-of-scope " +
    "rules override in-scope; a target matching no rule is NOT authorized.",
  inputSchema: z.object({
    targets: z.array(z.string().min(1)).min(1).describe("Targets to check: hosts, IPs, CIDRs, or URLs."),
  }),
  label: { start: ({ targets }) => `Scope check: ${targets.join(", ").slice(0, 60)}` },
  async execute({ targets }, ctx) {
    const sandbox = await ctx.getSandbox();
    const engagement = await readEngagement(sandbox);
    if (!engagement) {
      return {
        ready: false,
        message:
          "No engagement recorded yet. Read the briefing and call record_engagement first; without a " +
          "recorded scope, nothing is authorized.",
        results: [],
      };
    }

    const results = targets.map((t) => evaluateScope(t, engagement.scope));
    const blocked = results.filter((r) => !r.allowed);
    await logActivity(
      sandbox,
      `scope check: ${results.map((r) => `${r.normalizedHost}=${r.allowed ? "ALLOW" : "BLOCK"}`).join(", ")}`,
    );

    return {
      ready: true,
      allAllowed: blocked.length === 0,
      results,
      message:
        blocked.length === 0
          ? "All targets are in scope."
          : `BLOCKED: ${blocked.map((r) => r.normalizedHost).join(", ")}. Do not test these.`,
    };
  },
});
