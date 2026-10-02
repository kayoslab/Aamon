import { defineHook } from "eve/hooks";
import type { HookContext } from "eve/hooks";

/**
 * Traceability: auto-log every tool call and its result to engagement/audit.log,
 * without relying on the agent to remember. Each command the agent runs (bash),
 * every tool it uses or builds (write_file/read_file/nuclei/sqlmap/…), and the
 * outcome is appended as one JSON line, correlated by callId, with the activity
 * label (the agent's bounded "what I'm doing"). This runs in the root agent and
 * in every root-copy subagent (they share the sandbox), so parallel workstreams
 * all land in the same audit trail.
 *
 * Fuller reasoning lives in eve's Agent Runs / traces; this file is the portable,
 * in-workspace audit record the human team can review and reproduce from.
 */

const AUDIT = "engagement/audit.log";

function clip(v: unknown, n: number): string {
  let s = typeof v === "string" ? v : v === undefined ? "" : JSON.stringify(v);
  if (s.length > n) s = `${s.slice(0, n)}…[+${s.length - n}]`;
  return s.replace(/\r?\n/g, "\\n");
}

/** Atomic append of one small line, so parallel subagents don't clobber the log. */
async function appendLine(ctx: HookContext, record: Record<string, unknown>): Promise<void> {
  try {
    const sandbox = await ctx.getSandbox();
    const tmp = `engagement/.audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.tmp`;
    await sandbox.run({ command: `mkdir -p engagement` });
    await sandbox.writeTextFile({ path: tmp, content: JSON.stringify(record) + "\n" });
    await sandbox.run({ command: `cat ${JSON.stringify(tmp)} >> ${JSON.stringify(AUDIT)} && rm -f ${JSON.stringify(tmp)}` });
  } catch {
    // best-effort: auditing must never break a run
  }
}

export default defineHook({
  events: {
    // The model asked to run tools — capture the command/input and the intent label.
    async "actions.requested"(event, ctx) {
      const data = event.data as {
        turnId?: string;
        actions?: ReadonlyArray<Record<string, unknown>>;
        presentation?: Record<string, { label?: string }>;
      };
      const pres = data.presentation ?? {};
      for (const a of data.actions ?? []) {
        const callId = (a.callId ?? a.id) as string | undefined;
        const input = a.input ?? a.arguments ?? a.args ?? a.message;
        await appendLine(ctx, {
          t: new Date().toISOString(),
          ev: "call",
          turn: data.turnId,
          callId,
          tool: a.toolName ?? a.tool ?? a.kind,
          intent: callId && pres[callId]?.label ? clip(pres[callId]!.label, 300) : undefined,
          input: clip(input, 1200),
        });
      }
    },
    // The tool returned — capture the outcome.
    async "action.result"(event, ctx) {
      const data = event.data as {
        turnId?: string;
        status?: string;
        error?: unknown;
        result?: Record<string, unknown>;
        presentation?: Record<string, { label?: string }>;
      };
      const r = data.result ?? {};
      const callId = r.callId as string | undefined;
      const pres = data.presentation ?? {};
      await appendLine(ctx, {
        t: new Date().toISOString(),
        ev: "result",
        turn: data.turnId,
        callId,
        tool: r.toolName ?? r.tool,
        status: data.status,
        error: data.error ? true : undefined,
        intent: callId && pres[callId]?.label ? clip(pres[callId]!.label, 300) : undefined,
        output: clip(r.output, 1200),
      });
    },
  },
});
