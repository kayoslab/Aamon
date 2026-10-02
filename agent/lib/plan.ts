import { z } from "zod";
import type { RuntimeSandboxSession } from "eve/sandbox";
import { ROOT, ensureDirs, readTextOrNull } from "./engagement";

/**
 * The living test plan: a backlog of concrete test tasks the agent must build
 * before deep execution, work across multiple iterations, expand as it learns,
 * and drive to resolution (done or deferred) before it may finalize. Stored as
 * engagement/plan.jsonl (source of truth) and rendered to engagement/plan.md.
 */

export const PLAN_INDEX = `${ROOT}/plan.jsonl`;
export const PLAN_MD = `${ROOT}/plan.md`;

export const PlanStatus = z
  .enum(["open", "in_progress", "done", "deferred"])
  .describe("open/in_progress = still owed work; done = tested with evidence; deferred = can't do now (record a follow-up).");

export const PlanTaskInput = z.object({
  id: z.string().optional().describe("Omit to create a new task; pass an existing id to update it."),
  area: z.string().describe("Area/phase, e.g. 'authz', 'injection', 'cve:really-simple-security', 'business-logic'."),
  task: z.string().describe("The concrete, specific test to perform (not a vague area)."),
  status: PlanStatus.default("open"),
  note: z.string().default("").describe("Result/evidence path when done, or the reason + follow-up when deferred."),
});
export type PlanTaskInput = z.infer<typeof PlanTaskInput>;

export type PlanTask = PlanTaskInput & { id: string; iteration: number; updatedAt: string };

export async function readPlan(sandbox: RuntimeSandboxSession): Promise<PlanTask[]> {
  const raw = await readTextOrNull(sandbox, PLAN_INDEX);
  if (raw === null) return [];
  return raw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as PlanTask);
}

export type PlanCounts = { open: number; in_progress: number; done: number; deferred: number; total: number };

export function countPlan(tasks: PlanTask[]): PlanCounts {
  const c: PlanCounts = { open: 0, in_progress: 0, done: 0, deferred: 0, total: tasks.length };
  for (const t of tasks) c[t.status]++;
  return c;
}

/** Tasks that still owe work and block finalize. */
export function openTasks(tasks: PlanTask[]): PlanTask[] {
  return tasks.filter((t) => t.status === "open" || t.status === "in_progress");
}

export async function upsertTasks(
  sandbox: RuntimeSandboxSession,
  inputs: PlanTaskInput[],
  iteration: number,
): Promise<{ tasks: PlanTask[]; counts: PlanCounts }> {
  await ensureDirs(sandbox);
  const existing = await readPlan(sandbox);
  const byId = new Map(existing.map((t) => [t.id, t]));
  const now = new Date().toISOString();
  for (const input of inputs) {
    const id = input.id && byId.has(input.id) ? input.id : `T-${(byId.size + 1).toString().padStart(3, "0")}-${Math.random().toString(36).slice(2, 5)}`;
    byId.set(id, {
      id,
      area: input.area,
      task: input.task,
      status: input.status,
      note: input.note ?? "",
      iteration,
      updatedAt: now,
    });
  }
  const tasks = [...byId.values()];
  await sandbox.writeTextFile({ path: PLAN_INDEX, content: tasks.map((t) => JSON.stringify(t)).join("\n") + "\n" });
  await sandbox.writeTextFile({ path: PLAN_MD, content: renderPlanMd(tasks) });
  return { tasks, counts: countPlan(tasks) };
}

export function renderPlanMd(tasks: PlanTask[]): string {
  const c = countPlan(tasks);
  const order = ["in_progress", "open", "deferred", "done"] as const;
  const label: Record<string, string> = {
    open: "Open",
    in_progress: "In progress",
    done: "Done",
    deferred: "Deferred (follow-up)",
  };
  const sections = order
    .map((s) => {
      const rows = tasks.filter((t) => t.status === s);
      if (!rows.length) return "";
      const body = rows
        .map((t) => `- [${t.id}] **${t.area}** — ${t.task}${t.note ? `  _(${t.note})_` : ""}`)
        .join("\n");
      return `## ${label[s]} (${rows.length})\n${body}`;
    })
    .filter(Boolean)
    .join("\n\n");
  return [
    `# Test plan`,
    `Updated: ${new Date().toISOString()}`,
    `Open ${c.open} · In progress ${c.in_progress} · Done ${c.done} · Deferred ${c.deferred} · Total ${c.total}`,
    ``,
    sections || "_No tasks yet._",
  ].join("\n");
}
