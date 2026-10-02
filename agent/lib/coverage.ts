import type { PlanTask } from "./plan";
import type { StoredFinding } from "./engagement";

/**
 * Coverage gate — the machine-enforced depth guardrail.
 *
 * Autonomous runs have no human-approval friction to keep them thorough, so a
 * thin one-task plan could satisfy the "no open tasks" finalize check and the
 * engagement would end after a single finding. This gate replaces that friction:
 * it refuses to finalize until the plan shows real breadth — enough completed
 * tasks, across enough distinct vulnerability classes, over enough of the
 * surface. It gates on EFFORT/COVERAGE, never on finding count, so a thorough
 * run that legitimately finds little still passes (and no false positive is ever
 * manufactured to clear it).
 *
 * All thresholds are env-tunable; set AAMON_COVERAGE_GATE=off to disable.
 */

export const REQUIRED_CLASSES = [
  "authentication",
  "access-control",
  "injection",
  "ssrf",
  "client-side",
  "api",
  "cve",
  "business-logic",
] as const;
export type VulnClass = (typeof REQUIRED_CLASSES)[number];

// Ordered most-specific → most-generic; the first match wins so one task counts
// toward exactly one class. Keywords are matched as lowercased substrings, so
// they are chosen to avoid obvious collisions (e.g. "dom xss" not bare "dom").
const MATCHERS: Array<[VulnClass, string[]]> = [
  ["ssrf", ["ssrf", "server-side request", "metadata endpoint", "169.254.169.254"]],
  ["api", ["graphql", "soap", "wsdl", "swagger", "openapi", "apis", " api", "api ", "api-", "web service", "webservice", "web_service"]],
  ["access-control", ["authz", "idor", "bola", "bfla", "privilege", "escalat", "multi-tenant", "tenant isolation", "mass assign", "forced brows", "broken access", "access control", "horizontal", "vertical priv"]],
  ["injection", ["sqli", "sql inj", "sqlmap", " sql ", "nosql", "command inj", "commix", "ssti", "template inj", "xxe", "ldap inj", "xpath", "crlf", "deserial", "injection"]],
  ["client-side", ["xss", "dom xss", "dom-based", "csrf", "clickjack", "cors", "open redirect", "prototype pollut", "postmessage", "client-side", "tabnab"]],
  ["cve", ["cve", "wpscan", "nuclei", "outdated", "known vuln", "component version", "version disclosure", "plugin", "theme", "n-day", "1-day"]],
  ["authentication", ["authentication", "authn", "login", "jwt", "oauth", "oidc", "saml", "single sign", "session", "mfa", "2fa", "password", "reset", "credential", "token", "brute", "auth bypass", "account takeover"]],
  ["business-logic", ["business", "logic flaw", "logic bug", "workflow", "race condition", "race-condition", "price", "quantity", "replay", "state abuse", "coupon", "discount", "rate limit"]],
];

/** Classify a plan task's area+task text into one vulnerability class, or null. */
export function classifyArea(text: string): VulnClass | null {
  const t = ` ${text.toLowerCase()} `;
  for (const [cls, kws] of MATCHERS) {
    if (kws.some((k) => t.includes(k))) return cls;
  }
  return null;
}

/** Count distinct endpoint-like tokens referenced by completed work and findings. */
export function countEndpoints(doneTasks: PlanTask[], findings: StoredFinding[]): number {
  const bag = new Set<string>();
  const re = /https?:\/\/[^\s)'"`]+|\/[A-Za-z0-9_][A-Za-z0-9_\-./]{2,}/g;
  const add = (s: string | undefined) => {
    if (!s) return;
    for (const m of s.matchAll(re)) {
      let tok = m[0].toLowerCase().replace(/[.,;:)\]]+$/, "").replace(/[?#].*$/, "");
      if (tok.length >= 3) bag.add(tok);
    }
  };
  for (const f of findings) for (const a of f.affected) add(a);
  for (const t of doneTasks) {
    add(t.task);
    add(t.note);
  }
  return bag.size;
}

export type CoverageConfig = { enabled: boolean; minDone: number; minClasses: number; minEndpoints: number };

export function loadCoverageConfig(): CoverageConfig {
  const num = (v: string | undefined, d: number) => {
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : d;
  };
  return {
    enabled: (process.env.AAMON_COVERAGE_GATE ?? "on").toLowerCase() !== "off",
    minDone: num(process.env.AAMON_MIN_DONE_TASKS, 8),
    minClasses: num(process.env.AAMON_MIN_CLASSES, 5),
    minEndpoints: num(process.env.AAMON_MIN_ENDPOINTS, 5),
  };
}

export type CoverageResult = {
  pass: boolean;
  doneCount: number;
  classesCovered: VulnClass[];
  classesMissing: VulnClass[];
  endpoints: number;
  reasons: string[];
  config: CoverageConfig;
};

export function evaluateCoverage(
  plan: PlanTask[],
  findings: StoredFinding[],
  cfg: CoverageConfig = loadCoverageConfig(),
): CoverageResult {
  const done = plan.filter((t) => t.status === "done");
  const covered = new Set<VulnClass>();
  for (const t of done) {
    const c = classifyArea(`${t.area} ${t.task}`);
    if (c) covered.add(c);
  }
  const classesCovered = REQUIRED_CLASSES.filter((c) => covered.has(c));
  const classesMissing = REQUIRED_CLASSES.filter((c) => !covered.has(c));
  const endpoints = countEndpoints(done, findings);

  const reasons: string[] = [];
  if (cfg.enabled) {
    if (done.length < cfg.minDone)
      reasons.push(
        `Only ${done.length} task(s) completed; at least ${cfg.minDone} are required. Enumerate more of the surface and actually test it.`,
      );
    if (classesCovered.length < cfg.minClasses)
      reasons.push(
        `Only ${classesCovered.length} of ${cfg.minClasses} required vulnerability classes tested. Still untested: ${classesMissing.join(", ")}. Add and complete a task for each — testing a class to rule it out counts.`,
      );
    if (endpoints < cfg.minEndpoints)
      reasons.push(
        `Only ~${endpoints} distinct endpoint(s)/path(s) exercised; at least ${cfg.minEndpoints} expected. Test across the enumerated surface, not a single endpoint.`,
      );
  }
  return { pass: reasons.length === 0, doneCount: done.length, classesCovered, classesMissing, endpoints, reasons, config: cfg };
}
