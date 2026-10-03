import { z } from "zod";
import type { RuntimeSandboxSession } from "eve/sandbox";
import { ROOT, ensureDirs, readTextOrNull, readFindings } from "./engagement";
import { readPlan } from "./plan";
import { evaluateCoverage } from "./coverage";
import { SCANS_DIR } from "./scans";

/**
 * The campaign state machine — the structural depth driver.
 *
 * A real assessment is a multi-hour/multi-day campaign, not a quick sweep. An
 * autonomous agent left to "do the engagement" satisfices and finalizes fast.
 * So the engagement is forced through explicit phases, each with machine-checked
 * exit criteria read from real artifacts in the sandbox:
 *
 *   planning  → build a large attack plan
 *   recon     → fan out, enumerate exhaustively, and RUN THE BIG DETACHED SCANS
 *               to completion (this is what makes a run take hours)
 *   triage    → evaluate the recon corpus into a ranked exploitation backlog
 *               (CVEs prioritized by KEV/EPSS, weaknesses, chains)
 *   exploitation → drive every lead to demonstrated access, escalate, chain
 *   reporting → consolidate and finalize
 *
 * `advance_phase` refuses to move on until the current phase's criteria are met,
 * and `finalize_engagement` refuses unless the campaign is in `reporting`. The
 * agent cannot skip recon, cannot skip triage, and cannot finish after one pass.
 * All thresholds are env-tunable.
 */

export const PHASES = ["planning", "recon", "triage", "exploitation", "reporting"] as const;
export type Phase = (typeof PHASES)[number];

export const CAMPAIGN_PATH = `${ROOT}/campaign.json`;
export const RECON_DIR = `${ROOT}/recon`;
export const RECON_ENDPOINTS = `${RECON_DIR}/endpoints.txt`;
export const LEADS_PATH = `${ROOT}/leads.jsonl`;
export const LEADS_MD = `${ROOT}/leads.md`;

export type Campaign = {
  phase: Phase;
  startedAt: string;
  updatedAt: string;
  history: Array<{ phase: Phase; at: string }>;
};

export function nextPhase(p: Phase): Phase | null {
  const i = PHASES.indexOf(p);
  return i >= 0 && i < PHASES.length - 1 ? PHASES[i + 1] : null;
}

// ---- thresholds (env-tunable) ------------------------------------------

function envInt(name: string, d: number): number {
  const v = process.env[name];
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : d;
}

export type CampaignThresholds = {
  minPlanTasks: number;
  minReconEndpoints: number;
  minReconScans: number;
  minLeads: number;
};

export function loadThresholds(): CampaignThresholds {
  return {
    minPlanTasks: envInt("AAMON_MIN_PLAN_TASKS", 20),
    minReconEndpoints: envInt("AAMON_MIN_RECON_ENDPOINTS", 50),
    minReconScans: envInt("AAMON_MIN_RECON_SCANS", 3),
    minLeads: envInt("AAMON_MIN_LEADS", 8),
  };
}

// ---- state IO ----------------------------------------------------------

export async function readCampaign(sandbox: RuntimeSandboxSession): Promise<Campaign | null> {
  const raw = await readTextOrNull(sandbox, CAMPAIGN_PATH);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as Campaign;
  } catch {
    return null;
  }
}

export async function initCampaign(sandbox: RuntimeSandboxSession): Promise<Campaign> {
  const existing = await readCampaign(sandbox);
  if (existing) return existing;
  await ensureDirs(sandbox);
  const now = new Date().toISOString();
  const c: Campaign = { phase: "planning", startedAt: now, updatedAt: now, history: [{ phase: "planning", at: now }] };
  await sandbox.writeTextFile({ path: CAMPAIGN_PATH, content: JSON.stringify(c, null, 2) });
  return c;
}

export async function setPhase(sandbox: RuntimeSandboxSession, phase: Phase): Promise<Campaign> {
  const c = (await readCampaign(sandbox)) ?? (await initCampaign(sandbox));
  const now = new Date().toISOString();
  c.phase = phase;
  c.updatedAt = now;
  c.history.push({ phase, at: now });
  await sandbox.writeTextFile({ path: CAMPAIGN_PATH, content: JSON.stringify(c, null, 2) });
  return c;
}

// ---- leads (the triage backlog) ----------------------------------------

export const LeadKind = z.enum(["cve", "weakness", "chain"]);
export const LeadPriority = z.enum(["kev", "critical", "high", "medium", "low"]);
export const LeadStatus = z.enum(["open", "in_progress", "exploited", "ruled_out", "deferred"]);

export const LeadInput = z.object({
  id: z.string().optional().describe("Omit to create; pass an existing id to update it."),
  title: z.string().describe("Specific lead, e.g. 'CVE-2024-XXXX unauth RCE in plugin foo 1.2'."),
  kind: LeadKind.describe("cve = known CVE; weakness = a discovered flaw; chain = a multi-step path."),
  target: z.string().describe("The exact host/URL/endpoint/component the lead concerns."),
  priority: LeadPriority.describe("kev (actively exploited) > critical > high > medium > low."),
  hypothesis: z.string().describe("What access/impact this would yield, and the proof it needs."),
  status: LeadStatus.default("open"),
  note: z.string().default("").describe("Evidence/result when resolved; reason+follow-up when deferred."),
});
export type LeadInput = z.infer<typeof LeadInput>;
export type Lead = LeadInput & { id: string; updatedAt: string };

export async function readLeads(sandbox: RuntimeSandboxSession): Promise<Lead[]> {
  const raw = await readTextOrNull(sandbox, LEADS_PATH);
  if (raw === null) return [];
  return raw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Lead);
}

export async function upsertLeads(sandbox: RuntimeSandboxSession, inputs: LeadInput[]): Promise<Lead[]> {
  await ensureDirs(sandbox);
  const existing = await readLeads(sandbox);
  const byId = new Map(existing.map((l) => [l.id, l]));
  const now = new Date().toISOString();
  for (const input of inputs) {
    const id = input.id && byId.has(input.id) ? input.id : `L-${(byId.size + 1).toString().padStart(3, "0")}-${Math.random().toString(36).slice(2, 5)}`;
    byId.set(id, { ...input, id, note: input.note ?? "", updatedAt: now });
  }
  const leads = [...byId.values()];
  await sandbox.writeTextFile({ path: LEADS_PATH, content: leads.map((l) => JSON.stringify(l)).join("\n") + "\n" });
  await sandbox.writeTextFile({ path: LEADS_MD, content: renderLeadsMd(leads) });
  return leads;
}

function renderLeadsMd(leads: Lead[]): string {
  const order = { kev: 0, critical: 1, high: 2, medium: 3, low: 4 } as const;
  const sorted = [...leads].sort((a, b) => order[a.priority] - order[b.priority]);
  const rows = sorted
    .map((l) => `- [${l.id}] **${l.priority.toUpperCase()}** (${l.kind}) ${l.title} — \`${l.target}\` — _${l.status}_${l.note ? ` — ${l.note}` : ""}`)
    .join("\n");
  return [`# Exploitation leads (${leads.length})`, `Updated: ${new Date().toISOString()}`, ``, rows || "_No leads yet._"].join("\n");
}

export function leadResolved(l: Lead): boolean {
  return l.status === "exploited" || l.status === "ruled_out" || l.status === "deferred";
}

// ---- recon corpus & scans ----------------------------------------------

/** Distinct endpoints across ALL recon slice files (each subagent writes its own, so no write races). */
export async function countReconEndpoints(sandbox: RuntimeSandboxSession): Promise<number> {
  const res = await sandbox.run({ command: `cat ${JSON.stringify(RECON_DIR)}/*.txt 2>/dev/null` });
  if (res.exitCode !== 0 || res.stdout.trim() === "") return 0;
  const set = new Set(res.stdout.split("\n").map((l) => l.trim()).filter(Boolean));
  return set.size;
}

export async function countScans(sandbox: RuntimeSandboxSession): Promise<{ launched: number; finished: number }> {
  const launched = await sandbox.run({ command: `ls ${JSON.stringify(SCANS_DIR)}/*.cmd 2>/dev/null | wc -l` });
  const finished = await sandbox.run({ command: `ls ${JSON.stringify(SCANS_DIR)}/*.rc 2>/dev/null | wc -l` });
  const n = (s: string) => parseInt(s.trim(), 10) || 0;
  return { launched: n(launched.stdout), finished: n(finished.stdout) };
}

// ---- phase gate --------------------------------------------------------

export type PhaseGate = { ok: boolean; missing: string[] };

/** Can the campaign leave `phase` for the next one? Reads real artifacts. */
export async function canLeavePhase(
  sandbox: RuntimeSandboxSession,
  phase: Phase,
  th: CampaignThresholds = loadThresholds(),
): Promise<PhaseGate> {
  const missing: string[] = [];

  if (phase === "planning") {
    const plan = await readPlan(sandbox);
    if (plan.length < th.minPlanTasks)
      missing.push(`Plan has ${plan.length} tasks; build at least ${th.minPlanTasks} concrete tasks (one per endpoint x class, per role, per abuse case, per component) before recon.`);
  } else if (phase === "recon") {
    const endpoints = await countReconEndpoints(sandbox);
    const scans = await countScans(sandbox);
    if (endpoints < th.minReconEndpoints)
      missing.push(`Only ${endpoints} endpoints recorded in recon/endpoints.txt; enumerate at least ${th.minReconEndpoints} (crawl, gau, content+param discovery, APIs) via parallel recon subagents.`);
    if (scans.launched < th.minReconScans)
      missing.push(`Only ${scans.launched} detached scans launched; launch at least ${th.minReconScans} big ones (full nuclei template sets, large ffuf wordlists, deep katana crawl) with scan_start.`);
    if (scans.launched > 0 && scans.finished < scans.launched)
      missing.push(`${scans.launched - scans.finished} detached scan(s) still running; let them finish (scan_poll) before triage — the depth is in the full scans.`);
  } else if (phase === "triage") {
    const leads = await readLeads(sandbox);
    if (leads.length < th.minLeads)
      missing.push(`Only ${leads.length} exploitation leads recorded; triage the recon corpus into at least ${th.minLeads} ranked leads (record_lead) — CVEs (KEV/EPSS first), weaknesses, and chains.`);
  } else if (phase === "exploitation") {
    const leads = await readLeads(sandbox);
    const unresolved = leads.filter((l) => !leadResolved(l));
    if (unresolved.length > 0)
      missing.push(`${unresolved.length} lead(s) not yet resolved; drive each to exploited, ruled_out, or deferred (with a follow-up) via record_lead.`);
    const findings = await readFindings(sandbox);
    const cov = evaluateCoverage(await readPlan(sandbox), findings);
    if (!cov.pass) missing.push("Coverage gate not yet met: " + cov.reasons.join(" "));
  } else if (phase === "reporting") {
    // terminal; finalize_engagement handles the actual close.
  }

  return { ok: missing.length === 0, missing };
}
