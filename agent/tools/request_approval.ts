import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";

/**
 * Durable human-in-the-loop gate for actions that risk the do-not-take-it-down line.
 *
 * Non-destructive intrusive testing — the way IN and the climb up — proceeds on
 * its own: auth bypass, broken access control, IDOR/BOLA, token forgery,
 * non-destructive injection/SSRF reads, known-CVE checks, chaining. This gate is
 * for anything that could affect availability, integrity, or other users' data —
 * volume/brute-force, state-changing or destructive actions, request smuggling,
 * cache poisoning, mass exfiltration, or anything the operator flagged. In an
 * attended run those steps park here until a human answers, then resume exactly
 * where they left off. In an unsupervised run there
 * is no one to answer, so such steps are skipped and logged instead of calling
 * this tool.
 */
export default defineWorkflowTool({
  description:
    "OPTIONAL, attended runs only. Ordinary intrusive testing — exploitation, auth bypass, escalation, " +
    "chaining — needs NO approval; just do it. Use this only in an attended engagement if you want a " +
    "human's go-ahead for a narrow destructive-edge action you would otherwise skip (volume brute-force, " +
    "request smuggling, cache poisoning, a state-changing action). The engagement pauses until a person " +
    "answers, so never call it in an unsupervised run — no one is there to respond.",
  inputSchema: z.object({
    action: z.string().min(1).describe("Precisely what you intend to do."),
    target: z.string().min(1).describe("The specific in-scope target/asset."),
    risk: z.string().describe("Why this needs approval: possible impact, reversibility, RoE relevance."),
    command: z.string().optional().describe("The exact command or request you will run, if applicable."),
  }),
  label: { start: ({ action, target }) => `Approval: ${action} on ${target}` },
  async execute({ action, target, risk, command }, ctx) {
    "use workflow";
    const answer = await ctx.ask({
      prompt:
        `Approve this action?\n\n` +
        `Action:  ${action}\n` +
        `Target:  ${target}\n` +
        `Risk:    ${risk}\n` +
        (command ? `Command: ${command}\n` : ``),
      display: "confirmation",
      options: [
        { id: "approve", label: "Approve", style: "primary" },
        { id: "deny", label: "Deny" },
      ],
    });

    const approved = answer.status === "answered" && answer.optionId === "approve";
    return {
      approved,
      decision: approved ? "approved" : "denied",
      note: approved
        ? "Human approved. Proceed, stay within the stated action and scope, and record evidence."
        : "Not approved. Do not perform the action. Note it as a suggested next step for a human tester.",
    };
  },
});
