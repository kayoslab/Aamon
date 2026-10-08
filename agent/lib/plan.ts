import { z } from "zod";
import type { RuntimeSandboxSession } from "eve/sandbox";
import { ROOT, ensureDirs, readTextOrNull } from "./engagement";

/**
 * The living test plan: a backlog of concrete test tasks the agent must build
 * before deep execution, work across multiple iterations, expand as it learns,
 * and drive to resolution (done or deferred) before it may finalize. Stored as
 * engagement/plan.jsonl (source of truth) and rendered to engagement/plan.md.
 *
 * The plan is a TREE, not a flat list. A task may carry a `parentId` (the area
 * of interest it deepens) and the `originFindingId` that spawned it, so a
 * verified finding becomes its own sub-plan. `depth` is computed from the parent
 * chain (top-level tasks are depth 1) and capped at MAX_AREA_DEPTH — this is how
 * "go deep" is bounded without a recursive tree of agent processes. The recursion
 * lives in the data; the orchestrator drains the frontier by dispatching a
 * fresh-context worker per area (see lib/areas.ts and tools/open_area.ts).
 */

export const PLAN_INDEX = `${ROOT}/plan.jsonl`;
export const PLAN_MD = `${ROOT}/plan.md`;

/** Maximum area-of-interest depth. Env-tunable; default 15 (deep rather than wide). */
export const MAX_AREA_DEPTH = (() => {
  const v = Number(process.env.AAMON_MAX_AREA_DEPTH);
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 15;
})();

export const PlanStatus = z
  .enum(["open", "in_progress", "done", "deferred"])
  .describe("open/in_progress = still owed work; done = tested with evidence; deferred = can't do now (record a follow-up).");

export const PlanPriority = z
  .enum(["kev", "critical", "high", "medium", "low"])
  .describe("Worklist priority. The deepening loop works higher priority first; on a tie it drills the deeper thread.");
export type PlanPriority = z.infer<typeof PlanPriority>;

export const PlanTaskInput = z.object({
  id: z.string().optional().describe("Omit to create a new task; pass an existing id to update it."),
  area: z.string().describe("Area/phase or vulnerability class, e.g. 'authz', 'injection', 'ssrf', 'cve:really-simple-security'."),
  task: z.string().describe("The concrete, specific test to perform (not a vague area)."),
  status: PlanStatus.optional().describe("Omit on an update to keep the task's current status; a new task defaults to open."),
  note: z.string().optional().describe("Result/evidence path when done, or reason + follow-up when deferred. Omit on an update to keep the current note."),
  parentId: z
    .string()
    .optional()
    .describe("Id of the parent area this task deepens. Omit for a top-level plan task. Setting it makes this a sub-plan of that area."),
  originFindingId: z
    .string()
    .optional()
    .describe("Id of the finding/weakness that spawned this area of interest (e.g. 'A-03'), when it was born from a finding."),
  priority: PlanPriority.optional().describe("Worklist priority (default medium)."),
});
export type PlanTaskInput = z.infer<typeof PlanTaskInput>;

export type PlanTask = {
  id: string;
  area: string;
  task: string;
  status: z.infer<typeof PlanStatus>;
  note: string;
  parentId?: string;
  originFindingId?: string;
  priority: PlanPriority;
  depth: number;
  iteration: number;
  updatedAt: string;
};

const PRIO_RANK: Record<PlanPriority, number> = { kev: 0, critical: 1, high: 2, medium: 3, low: 4 };

export async function readPlan(sandbox: RuntimeSandboxSession): Promise<PlanTask[]> {
  const raw = await readTextOrNull(sandbox, PLAN_INDEX);
  if (raw === null) return [];
  return raw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const t = JSON.parse(l) as Partial<PlanTask>;
      // Backward-compatible defaults for plans written before the tree fields existed.
      return {
        id: t.id!,
        area: t.area ?? "",
        task: t.task ?? "",
        status: t.status ?? "open",
        note: t.note ?? "",
        parentId: t.parentId,
        originFindingId: t.originFindingId,
        priority: t.priority ?? "medium",
        depth: typeof t.depth === "number" ? t.depth : 1,
        iteration: t.iteration ?? 1,
        updatedAt: t.updatedAt ?? new Date().toISOString(),
      } as PlanTask;
    });
}

export type PlanCounts = { open: number; in_progress: number; done: number; deferred: number; total: number; maxDepth: number };

export function countPlan(tasks: PlanTask[]): PlanCounts {
  const c: PlanCounts = { open: 0, in_progress: 0, done: 0, deferred: 0, total: tasks.length, maxDepth: 0 };
  for (const t of tasks) {
    c[t.status]++;
    if (t.depth > c.maxDepth) c.maxDepth = t.depth;
  }
  return c;
}

/** Tasks that still owe work and block finalize. */
export function openTasks(tasks: PlanTask[]): PlanTask[] {
  return tasks.filter((t) => t.status === "open" || t.status === "in_progress");
}

/**
 * The worklist frontier: open tasks the deepening loop should work next, ordered
 * by priority, then DEEPER first (so the agent drills a promising thread to the
 * bottom before broadening — "deep rather than wide"), then most-recent.
 */
export function frontier(tasks: PlanTask[]): PlanTask[] {
  return openTasks(tasks).sort((a, b) => {
    const pr = PRIO_RANK[a.priority] - PRIO_RANK[b.priority];
    if (pr !== 0) return pr;
    if (b.depth !== a.depth) return b.depth - a.depth;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });
}

export type UpsertResult = {
  tasks: PlanTask[];
  counts: PlanCounts;
  rejected: Array<{ area: string; task: string; reason: string }>;
  /** The resulting task id for each input, in order; null for a rejected input. */
  resultIds: Array<string | null>;
};

export async function upsertTasks(
  sandbox: RuntimeSandboxSession,
  inputs: PlanTaskInput[],
  iteration: number,
): Promise<UpsertResult> {
  await ensureDirs(sandbox);
  const existing = await readPlan(sandbox);
  const byId = new Map(existing.map((t) => [t.id, t]));
  const now = new Date().toISOString();
  const rejected: UpsertResult["rejected"] = [];
  const resultIds: Array<string | null> = [];

  for (const input of inputs) {
    const isUpdate = !!(input.id && byId.has(input.id));
    const prev = isUpdate ? byId.get(input.id!) : undefined;
    const id = isUpdate
      ? input.id!
      : `T-${(byId.size + 1).toString().padStart(3, "0")}-${Math.random().toString(36).slice(2, 5)}`;

    // Resolve depth from the parent chain. A new parentId recomputes depth; an
    // update with no parentId keeps the task's existing depth.
    let depth: number;
    if (input.parentId) {
      const parent = byId.get(input.parentId);
      if (!parent) {
        rejected.push({ area: input.area, task: input.task, reason: `parentId '${input.parentId}' not found in the plan.` });
        resultIds.push(null);
        continue;
      }
      // Cycle guard: a task may not be made its own ancestor — that would orphan
      // the subtree from the roots and stack-overflow the tree render.
      let anc: string | undefined = input.parentId;
      const walked = new Set<string>();
      let cyclic = false;
      while (anc) {
        if (anc === id) {
          cyclic = true;
          break;
        }
        if (walked.has(anc)) break;
        walked.add(anc);
        anc = byId.get(anc)?.parentId;
      }
      if (cyclic) {
        rejected.push({ area: input.area, task: input.task, reason: `parentId '${input.parentId}' would make the task its own ancestor (cycle).` });
        resultIds.push(null);
        continue;
      }
      depth = parent.depth + 1;
    } else {
      depth = prev?.depth ?? 1;
    }

    // Cap recursion depth. Updates to existing tasks are never blocked.
    if (!isUpdate && depth > MAX_AREA_DEPTH) {
      rejected.push({
        area: input.area,
        task: input.task,
        reason:
          `depth ${depth} exceeds maxDepth ${MAX_AREA_DEPTH}. Stop deepening this thread — record it as a 'deferred' ` +
          `follow-up on the parent area (with a note on what a human should pick up) instead of opening a deeper child.`,
      });
      resultIds.push(null);
      continue;
    }

    byId.set(id, {
      id,
      area: input.area,
      task: input.task,
      // Merge, don't clobber: an update that omits status/note keeps the task's
      // current values (a new task defaults). This is what makes done/in_progress stick.
      status: input.status ?? prev?.status ?? "open",
      note: input.note ?? prev?.note ?? "",
      parentId: input.parentId ?? prev?.parentId,
      originFindingId: input.originFindingId ?? prev?.originFindingId,
      priority: input.priority ?? prev?.priority ?? "medium",
      depth,
      iteration,
      updatedAt: now,
    });
    resultIds.push(id);
  }

  const tasks = [...byId.values()];
  await sandbox.writeTextFile({ path: PLAN_INDEX, content: tasks.map((t) => JSON.stringify(t)).join("\n") + "\n" });
  await sandbox.writeTextFile({ path: PLAN_MD, content: renderPlanMd(tasks) });
  return { tasks, counts: countPlan(tasks), rejected, resultIds };
}

const STATUS_BADGE: Record<string, string> = {
  open: "☐",
  in_progress: "◐",
  done: "☑",
  deferred: "⏸",
};

export function renderPlanMd(tasks: PlanTask[]): string {
  const c = countPlan(tasks);
  const byParent = new Map<string, PlanTask[]>();
  const roots: PlanTask[] = [];
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    if (t.parentId && ids.has(t.parentId)) {
      const arr = byParent.get(t.parentId) ?? [];
      arr.push(t);
      byParent.set(t.parentId, arr);
    } else {
      roots.push(t);
    }
  }
  const sortSiblings = (xs: PlanTask[]) =>
    [...xs].sort((a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || (a.updatedAt < b.updatedAt ? 1 : -1));

  const lines: string[] = [];
  const seen = new Set<string>();
  const emit = (t: PlanTask, indent: number) => {
    if (seen.has(t.id)) return; // defence in depth: never recurse a cycle
    seen.add(t.id);
    const pad = "  ".repeat(indent);
    const origin = t.originFindingId ? ` ←${t.originFindingId}` : "";
    const note = t.note ? ` _(${t.note})_` : "";
    lines.push(`${pad}- ${STATUS_BADGE[t.status] ?? "·"} [${t.id}] **${t.priority}** _${t.area}_ — ${t.task}${origin}${note}`);
    for (const child of sortSiblings(byParent.get(t.id) ?? [])) emit(child, indent + 1);
  };
  for (const r of sortSiblings(roots)) emit(r, 0);

  return [
    `# Test plan`,
    `Updated: ${new Date().toISOString()}`,
    `Open ${c.open} · In progress ${c.in_progress} · Done ${c.done} · Deferred ${c.deferred} · Total ${c.total} · Max depth ${c.maxDepth}/${MAX_AREA_DEPTH}`,
    ``,
    lines.length ? lines.join("\n") : "_No tasks yet._",
  ].join("\n");
}
