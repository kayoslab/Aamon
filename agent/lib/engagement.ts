import { z } from "zod";
import type { RuntimeSandboxSession } from "eve/sandbox";

/**
 * Engagement state, findings, and report model for a web penetration test,
 * aligned to OWASP (WSTG / Top 10 / API Top 10 / ASVS) and CVSS 3.1.
 *
 * Everything is stored as files under `/workspace/engagement/` in the shared
 * sandbox. The root agent and every root-copy subagent share one sandbox, so a
 * file written by a testing subagent is immediately visible to the orchestrator
 * and the reporter. Durable session state is NOT shared with subagents, so the
 * filesystem is the right medium here.
 */

export const ROOT = "engagement";
export const ENGAGEMENT_PATH = `${ROOT}/engagement.json`;
export const BRIEFING_PATH = `${ROOT}/briefing.md`;
export const FINDINGS_DIR = `${ROOT}/findings`;
export const REPORT_PATH = `${ROOT}/report.md`;
export const LOG_PATH = `${ROOT}/activity.log`;

// ---- enums --------------------------------------------------------------

export const OperatingMode = z.enum(["autonomous_light", "assist"]).describe(
  "autonomous_light: unsupervised run that exploits autonomously end to end (no human in the loop). " +
    "assist: same autonomous testing with a human available, producing a first iteration for a pentester to drive.",
);

/** Web penetration-testing surfaces this agent covers. */
export const PentestType = z.enum([
  "web_app", // browser-facing web applications
  "web_services", // REST / SOAP / GraphQL APIs
]);

export const TestBox = z
  .enum(["blackbox", "greybox", "whitebox"])
  .describe("Knowledge/access level the tester starts from, per the service description.");

export const ReportLanguage = z.enum(["de", "en"]);

export const AttackerModel = z
  .enum(["external", "internal"])
  .describe("external: from the internet. internal: also has access to the operator's/user's network.");

// ---- engagement (intake) ------------------------------------------------

export const EngagementSchema = z.object({
  name: z.string().min(1).describe("Short engagement name, e.g. 'ACME Q1 Web-App Pentest'."),
  client: z
    .object({
      organization: z.string().min(1).describe("Client / system owner organization."),
      primaryContact: z.string().describe("Primary contact at the client."),
    })
    .describe("Who the engagement is for and who to talk to."),
  mode: OperatingMode,
  reportLanguage: ReportLanguage.default("en"),

  systemPurpose: z
    .string()
    .default("")
    .describe("What the system is for: use-cases and functionality."),
  pentestTypes: z
    .array(PentestType)
    .min(1)
    .describe("Which web surfaces this engagement covers: web_app and/or web_services (APIs)."),
  box: TestBox.default("greybox"),

  authorization: z
    .object({
      authorizedBy: z.string().describe("Name/role who authorized this test."),
      reference: z.string().optional().describe("SoW / RoE / ticket reference."),
      expectedDate: z.string().optional().describe("Expected date/window for conduction."),
      windowStart: z.string().optional(),
      windowEnd: z.string().optional(),
    })
    .describe("Proof this engagement is authorized. Do not test without it."),

  scope: z
    .object({
      inScope: z
        .array(z.string())
        .describe("Endpoints to be tested: IPs, CIDRs, hostnames, *.wildcards, or URLs."),
      outOfScope: z
        .array(z.string())
        .default([])
        .describe("Explicitly forbidden targets/techniques. Always win over in-scope."),
    })
    .describe("The authorized attack surface."),

  availability: z
    .enum(["internet", "internal_network", "both"])
    .default("internet")
    .describe("How the target is reachable."),
  environment: z
    .enum(["production", "staging", "qa", "testing", "unknown"])
    .default("unknown")
    .describe("Which environment is under test."),
  targetGroup: z
    .string()
    .default("")
    .describe("Intended users: public users, company internal, service provider."),

  attackerModel: z
    .array(AttackerModel)
    .default([])
    .describe("Attacker model(s) to evaluate against: unauthenticated external, or an authenticated low-privilege user."),
  protectionGoals: z
    .array(z.string())
    .default([])
    .describe("Protection goals in scope, e.g. confidentiality/integrity/availability of specific assets."),
  worstCase: z
    .string()
    .default("")
    .describe("Worst-case scenario the client fears. Seeds the abuse cases."),
  abuseCases: z
    .array(z.string())
    .default([])
    .describe("Attacker goals to prove/disprove (like user stories for attackers)."),

  access: z
    .object({
      method: z
        .enum(["credentials", "certificate", "vpn", "onsite", "binary", "none"])
        .default("none")
        .describe("How access to the target is granted."),
      details: z.string().default("").describe("How access/test data is provided (reference, not raw secrets)."),
    })
    .default({ method: "none", details: "" }),
  roles: z
    .array(z.string())
    .default([])
    .describe("Roles / test accounts to use. Web tests usually need one account per role (+admin)."),
  underlyingTechnology: z
    .string()
    .default("")
    .describe("Tech stack / hosting / topology. Drives technology-specific testing."),

  objectives: z.array(z.string()).default([]).describe("What the test aims to find/prove."),
  constraints: z
    .array(z.string())
    .default([])
    .describe("Rules of engagement: no-DoS, rate limits, testing windows, contact/escalation chain, abort criteria."),
  effortPersonDays: z.number().optional().describe("Agreed test depth in person-days, if defined."),
  knowledge: z
    .object({
      credentials: z.array(z.string()).default([]).describe("Provided test credentials/keys (by reference)."),
      priorFindings: z.string().default("").describe("Knowledge already obtained / prior results."),
      notes: z.string().default("").describe("Any other briefing context."),
    })
    .default({ credentials: [], priorFindings: "", notes: "" }),
});

export type Engagement = z.infer<typeof EngagementSchema>;

// ---- findings -----------------------------------------------------------

export const Severity = z.enum(["info", "low", "medium", "high", "critical"]);
export const FindingStatus = z
  .enum(["draft", "confirmed", "needs_review", "false_positive"])
  .describe("draft/needs_review are first-iteration; a human confirms or rejects.");

export const FindingSchema = z.object({
  title: z.string().min(1),
  severity: Severity,
  status: FindingStatus.default("draft"),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  affected: z.array(z.string()).describe("Affected asset(s): host, URL, endpoint, parameter."),
  cwe: z.string().optional().describe("CWE id, e.g. CWE-89."),
  cvssScore: z.number().min(0).max(10).optional().describe("CVSS 3.1 base score 0.0–10.0."),
  cvssVector: z
    .string()
    .optional()
    .describe("Full CVSS 3.1 vector, e.g. CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N."),
  category: z
    .string()
    .default("")
    .describe("Tested area this belongs to, e.g. 'Authentication', 'Authorization', 'Injection', 'SSRF'."),
  summary: z.string().describe("The weakness in one or two sentences."),
  description: z.string().default("").describe("Detailed technical explanation."),
  evidence: z.string().describe("Concrete evidence: request/response, tool output, artifact path."),
  reproduction: z.string().describe("Numbered, reproducible steps."),
  impact: z.string().describe("Business/technical impact if exploited."),
  remediation: z.string().describe("Concrete remediation."),
  references: z.array(z.string()).default([]).describe("OWASP/CWE references, e.g. WSTG test id, OWASP Top 10 category."),
});

export type Finding = z.infer<typeof FindingSchema>;
export type StoredFinding = Finding & { id: string; createdAt: string };

// ---- tested-area overview (geprüfte Bereiche) ---------------------------

export const AreaStatus = z.enum(["ok", "partial", "faulty", "improvements", "performed", "not_tested"]);
export type AreaStatusT = z.infer<typeof AreaStatus>;

export const TestedAreaSchema = z.object({
  area: z.string().describe("Name of the tested area, e.g. 'Authentication (incl. MFA, recovery)'."),
  status: AreaStatus,
  note: z.string().default(""),
});
export type TestedArea = z.infer<typeof TestedAreaSchema>;

// ---- localization -------------------------------------------------------

type Lang = z.infer<typeof ReportLanguage>;

export const SEVERITY_LABEL: Record<Lang, Record<z.infer<typeof Severity>, string>> = {
  de: { critical: "Kritisch", high: "Hoch", medium: "Mittel", low: "Niedrig", info: "Information" },
  en: { critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Informational" },
};

export const AREA_STATUS_LABEL: Record<Lang, Record<AreaStatusT, string>> = {
  de: {
    ok: "Fehlerfrei",
    partial: "Teilweise fehlerhaft",
    faulty: "Fehlerhaft",
    improvements: "Verbesserungen möglich",
    performed: "Durchgeführt",
    not_tested: "Nicht geprüft",
  },
  en: {
    ok: "No issues",
    partial: "Partially faulty",
    faulty: "Faulty",
    improvements: "Improvements possible",
    performed: "Performed",
    not_tested: "Not tested",
  },
};

/** CVSS 3.1 severity band from a base score. */
export function severityFromCvss(score: number): z.infer<typeof Severity> {
  if (score >= 9.0) return "critical";
  if (score >= 7.0) return "high";
  if (score >= 4.0) return "medium";
  if (score > 0.0) return "low";
  return "info";
}

const SEV_ORDER = ["critical", "high", "medium", "low", "info"] as const;
export function severityRank(s: string): number {
  const i = SEV_ORDER.indexOf(s as (typeof SEV_ORDER)[number]);
  return i === -1 ? SEV_ORDER.length : i;
}

// ---- workspace IO -------------------------------------------------------

export async function readTextOrNull(sandbox: RuntimeSandboxSession, path: string): Promise<string | null> {
  const res = await sandbox.run({ command: `cat ${JSON.stringify(path)} 2>/dev/null` });
  if (res.exitCode !== 0) return null;
  return res.stdout;
}

export async function ensureDirs(sandbox: RuntimeSandboxSession): Promise<void> {
  await sandbox.run({ command: `mkdir -p ${JSON.stringify(FINDINGS_DIR)}` });
}

export async function writeEngagement(sandbox: RuntimeSandboxSession, eng: Engagement): Promise<void> {
  await ensureDirs(sandbox);
  await sandbox.writeTextFile({ path: ENGAGEMENT_PATH, content: JSON.stringify(eng, null, 2) });
}

export async function readEngagement(sandbox: RuntimeSandboxSession): Promise<Engagement | null> {
  const raw = await readTextOrNull(sandbox, ENGAGEMENT_PATH);
  if (raw === null) return null;
  try {
    return EngagementSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function readFindings(sandbox: RuntimeSandboxSession): Promise<StoredFinding[]> {
  // Each finding is its own file (findings/<id>.json), so parallel subagents
  // never race on a shared index. Concatenate them; one JSON object per line.
  const res = await sandbox.run({ command: `cat ${JSON.stringify(FINDINGS_DIR)}/*.json 2>/dev/null` });
  if (res.exitCode !== 0 || res.stdout.trim() === "") return [];
  return res.stdout
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as StoredFinding)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

export async function appendFinding(sandbox: RuntimeSandboxSession, finding: Finding): Promise<string> {
  await ensureDirs(sandbox);
  // Collision-safe unique id (no read-modify-write of a shared file). The
  // sequential A-NN numbering is assigned at report time by severity order.
  const id = `F-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const record: StoredFinding = { id, createdAt: new Date().toISOString(), ...finding };
  await sandbox.writeTextFile({ path: `${FINDINGS_DIR}/${id}.json`, content: JSON.stringify(record) + "\n" });
  await sandbox.writeTextFile({ path: `${FINDINGS_DIR}/${id}.md`, content: renderFinding(record, "en") });
  return id;
}

export async function logActivity(sandbox: RuntimeSandboxSession, line: string): Promise<void> {
  await ensureDirs(sandbox);
  const existing = (await readTextOrNull(sandbox, LOG_PATH)) ?? "";
  await sandbox.writeTextFile({ path: LOG_PATH, content: existing + `[${new Date().toISOString()}] ${line}\n` });
}

// ---- rendering ----------------------------------------------------------

export function renderFinding(f: StoredFinding, lang: Lang, displayId: string = f.id): string {
  const de = lang === "de";
  const L = SEVERITY_LABEL[lang];
  const sev = `${L[f.severity]}${f.cvssScore !== undefined ? ` (${f.cvssScore.toFixed(1)})` : ""}`;
  const lbl = de
    ? { sev: "Schweregrad", cwe: "CWE", affected: "Betroffen", status: "Status", conf: "Konfidenz",
        desc: "Beschreibung", evidence: "Nachweis", repro: "Reproduktion", impact: "Auswirkung",
        fix: "Empfehlung", refs: "Referenzen" }
    : { sev: "Severity", cwe: "CWE", affected: "Affected", status: "Status", conf: "Confidence",
        desc: "Description", evidence: "Evidence", repro: "Steps to reproduce", impact: "Impact",
        fix: "Remediation", refs: "References" };

  const meta: string[] = [`**${lbl.sev}:** ${sev}`];
  if (f.cvssVector) meta.push(`**CVSS:** \`${f.cvssVector}\``);
  if (f.cwe) meta.push(`**${lbl.cwe}:** ${f.cwe}`);
  meta.push(`**${lbl.status}:** ${f.status} · ${lbl.conf}: ${f.confidence}`);

  return [
    `### ${displayId} — ${f.title}`,
    ``,
    meta.join("  ·  "),
    ``,
    `**${lbl.affected}:** ${f.affected.join(", ")}`,
    ``,
    `**${lbl.desc}**`,
    f.description ? `${f.summary}\n\n${f.description}` : f.summary,
    ``,
    `**${lbl.evidence}**`,
    f.evidence,
    ``,
    `**${lbl.repro}**`,
    f.reproduction,
    ``,
    `**${lbl.impact}**`,
    f.impact,
    ``,
    `**${lbl.fix}**`,
    f.remediation,
    f.references.length ? `\n**${lbl.refs}**\n${f.references.map((r) => `- ${r}`).join("\n")}` : ``,
  ]
    .filter((l) => l !== ``)
    .join("\n");
}
