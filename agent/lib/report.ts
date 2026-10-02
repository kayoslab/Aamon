import {
  type Engagement,
  type StoredFinding,
  type TestedArea,
  renderFinding,
  severityRank,
  SEVERITY_LABEL,
  AREA_STATUS_LABEL,
  Severity,
} from "./engagement";

export type ReportOptions = {
  managementSummary: string;
  recommendations: string[];
  methodology: string;
  testedAreas: TestedArea[];
};

type Lang = "de" | "en";

/**
 * Build the penetration-test report markdown from the engagement and findings,
 * following a conventional professional structure: cover → executive summary →
 * scope → methodology → findings overview → prioritized recommendations →
 * detailed findings → coverage → CVSS appendix.
 */
export function buildReportMarkdown(
  engagement: Engagement | null,
  findingsIn: StoredFinding[],
  opts: ReportOptions,
  lang: Lang,
): string {
  const de = lang === "de";
  const SL = SEVERITY_LABEL[lang];
  const AL = AREA_STATUS_LABEL[lang];
  const findings = [...findingsIn].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  const counts = Object.fromEntries(Severity.options.map((s) => [s, 0])) as Record<string, number>;
  for (const f of findings) counts[f.severity]++;
  const overviewRows = (["critical", "high", "medium", "low", "info"] as const)
    .map((s) => `| ${SL[s]} | ${counts[s]} |`)
    .join("\n");
  // Sequential display id assigned here, by severity order — so parallel
  // recording never needs to coordinate ids (findings carry unique F-… ids).
  const did = (i: number) => `A-${String(i + 1).padStart(2, "0")}`;
  const tableRows = findings
    .map(
      (f, i) =>
        `| ${did(i)} | ${SL[f.severity]}${f.cvssScore !== undefined ? ` (${f.cvssScore.toFixed(1)})` : ""} | ${f.category || "—"} | ${f.title} |`,
    )
    .join("\n");
  const areaRows = opts.testedAreas
    .map((a) => `| ${a.area} | ${AL[a.status]}${a.note ? ` — ${a.note}` : ""} |`)
    .join("\n");

  const t = de
    ? {
        title: "PENETRATIONSTESTBERICHT", target: "Zielsystem", generated: "Erstellt",
        exec: "Zusammenfassung für das Management", riskSnapshot: "Risikoüberblick",
        scope: "Prüfumfang (Scope)", inScope: "In Scope", outScope: "Außerhalb des Scopes",
        env: "Umgebung", box: "Testtiefe (Box)", window: "Testzeitraum", effort: "Aufwand", personDays: "Personentage",
        method: "Vorgehen und Methodik", recs: "Empfohlene Maßnahmen (priorisiert)",
        overview: "Überblick der Feststellungen", severity: "Schweregrad", count: "Anzahl",
        table: "Feststellungen auf einen Blick", id: "ID", category: "Kategorie", vuln: "Feststellung",
        details: "Detaillierte Feststellungen", coverage: "Abdeckung der geprüften Bereiche", area: "Bereich", status: "Status",
        scoreMethod: "Anhang: Bewertung (CVSS 3.1)", none: "_Keine Feststellungen erfasst._",
        standards: "Angelehnt an OWASP WSTG, OWASP Top 10, OWASP API Security Top 10 und ASVS; Bewertung nach CVSS 3.1.",
        draft: "> Automatisch erzeugter Erstentwurf des Aamon-Agenten. Als Entwurf/Review markierte Feststellungen bedürfen menschlicher Validierung vor Auslieferung.",
      }
    : {
        title: "PENETRATION TEST REPORT", target: "Target", generated: "Generated",
        exec: "Executive summary", riskSnapshot: "Risk snapshot",
        scope: "Scope", inScope: "In scope", outScope: "Out of scope",
        env: "Environment", box: "Test depth (box)", window: "Testing window", effort: "Effort", personDays: "person-days",
        method: "Methodology", recs: "Recommendations (prioritized)",
        overview: "Findings overview", severity: "Severity", count: "Count",
        table: "Findings at a glance", id: "ID", category: "Category", vuln: "Finding",
        details: "Detailed findings", coverage: "Coverage of tested areas", area: "Area", status: "Status",
        scoreMethod: "Appendix: scoring (CVSS 3.1)", none: "_No findings recorded._",
        standards: "Aligned to OWASP WSTG, OWASP Top 10, OWASP API Security Top 10, and ASVS; rated with CVSS 3.1.",
        draft: "> Automated first-iteration draft produced by the Aamon agent. Findings marked draft/needs_review require human validation before client delivery.",
      };

  const cvssBands = de
    ? [`| Kritisch | ab 9.0 |`, `| Hoch | 7.0 – 8.9 |`, `| Mittel | 4.0 – 6.9 |`, `| Niedrig | 0.1 – 3.9 |`, `| Information | 0.0 |`]
    : [`| Critical | 9.0 and above |`, `| High | 7.0 – 8.9 |`, `| Medium | 4.0 – 6.9 |`, `| Low | 0.1 – 3.9 |`, `| Informational | 0.0 |`];

  const snapshot = (["critical", "high", "medium", "low", "info"] as const)
    .filter((s) => counts[s] > 0)
    .map((s) => `${counts[s]} ${SL[s]}`)
    .join(" · ") || (de ? "keine" : "none");

  // Each entry is one self-contained block; blocks are separated by a blank line
  // so headings and (crucially) the two different-width tables render correctly.
  const scopeLines = [
    engagement ? `- **${t.target}:** ${engagement.client.organization}` : ``,
    engagement ? `- **${t.inScope}:** ${engagement.scope.inScope.join(", ") || "(none)"}` : ``,
    engagement && engagement.scope.outOfScope.length ? `- **${t.outScope}:** ${engagement.scope.outOfScope.join(", ")}` : ``,
    engagement ? `- **${t.box}:** ${engagement.box}` : ``,
    engagement ? `- **${t.env}:** ${engagement.environment}` : ``,
    engagement?.authorization?.windowStart ? `- **${t.window}:** ${engagement.authorization.windowStart}${engagement.authorization.windowEnd ? ` – ${engagement.authorization.windowEnd}` : ""}` : ``,
    engagement?.effortPersonDays ? `- **${t.effort}:** ${engagement.effortPersonDays} ${t.personDays}` : ``,
  ].filter((l) => l !== ``);

  const methodBody = opts.methodology ? `${opts.methodology}\n\n${t.standards}` : t.standards;

  const blocks = [
    `# ${t.title}`,
    engagement ? `## ${engagement.name} — ${engagement.client.organization}` : ``,
    `**${t.generated}:** ${new Date().toISOString()}`,
    t.draft,
    `## ${t.exec}\n\n${opts.managementSummary || (de ? "(nicht angegeben)" : "(not provided)")}\n\n**${t.riskSnapshot}:** ${findings.length} (${snapshot})`,
    `## ${t.scope}\n\n${scopeLines.join("\n")}`,
    `## ${t.method}\n\n${methodBody}`,
    `## ${t.overview}\n\n| ${t.severity} | ${t.count} |\n|---|---|\n${overviewRows}`,
    `| ${t.id} | ${t.severity} (CVSS) | ${t.category} | ${t.vuln} |\n|---|---|---|---|\n${tableRows || "| — | — | — | — |"}`,
    `## ${t.recs}\n\n${opts.recommendations.length ? opts.recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n") : "- (none)"}`,
    `## ${t.details}\n\n${findings.length ? findings.map((f, i) => renderFinding(f, lang, did(i))).join("\n\n---\n\n") : t.none}`,
    opts.testedAreas.length ? `## ${t.coverage}\n\n| ${t.area} | ${t.status} |\n|---|---|\n${areaRows}` : ``,
    `## ${t.scoreMethod}\n\n| ${t.severity} | CVSS 3.1 |\n|---|---|\n${cvssBands.join("\n")}`,
  ].filter((b) => b !== ``);

  return blocks.join("\n\n");
}

export function severityCounts(findings: StoredFinding[]): Record<string, number> {
  const counts = Object.fromEntries(Severity.options.map((s) => [s, 0])) as Record<string, number>;
  for (const f of findings) counts[f.severity]++;
  return counts;
}
