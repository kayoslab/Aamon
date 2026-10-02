---
description: Use when writing up findings or compiling the report — the report structure, the required fields per finding, CVSS 3.1 severity bands, the tested-areas status overview, and how first-iteration drafts differ from confirmed findings.
---

# Findings and reporting

## Anatomy of a finding

Each `record_finding` call is one distinct issue and gets a sequential ID (A-01, A-02, …). Fill every
field with substance — these map directly to the report:

- **title** — specific and outcome-oriented ("Unauthenticated account takeover via password-reset token
  reuse"), not a bare category.
- **severity** + **cvssScore** + **cvssVector** — rate with CVSS 3.1 and give the full vector
  (e.g. `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N`). The band follows the score (see below).
- **category** — the area it belongs to (Authentication, Authorization, Injection, SSRF, Client-side,
  API, Business logic, …), so it rolls up into the coverage overview and the findings table.
- **confidence** + **status** — `confirmed` only when you actually validated it; first-iteration leads
  are `draft`/`needs_review`; cleared leads are `false_positive`.
- **affected** — exact host / URL / endpoint / parameter.
- **cwe** and **references** — CWE id plus OWASP references: the WSTG test id, OWASP Top 10 category, or
  API Security Top 10 id that classifies the finding.
- **evidence** — concrete and anonymized where appropriate: the request/response, tool output, or an
  artifact path under `engagement/`. No evidence, no finding.
- **description** — the technical detail behind the one-line summary.
- **reproduction** — numbered, reproducible steps.
- **impact** — what an attacker gains, tied to the client's risk (note GDPR where personal data is
  involved). For access and escalation findings, state exactly what access was obtained and from what
  starting position.
- **remediation** — specific and actionable.

## CVSS 3.1 severity bands

| Band | Score |
| --- | --- |
| Critical / Kritisch | ≥ 9.0 |
| High / Hoch | 7.0 – 8.9 |
| Medium / Mittel | 4.0 – 6.9 |
| Low / Niedrig | 0.1 – 3.9 |
| Informational / Information | 0.0 |

Beyond the raw score, prioritize by business impact and protection need of the affected system. A
proven credential-less foothold or privilege escalation is a headline result — rate and present it as
one, above configuration and header hygiene.

## The report

`compile_report` / `finalize_engagement` produces a conventional professional pentest report in the
engagement's language (`de`/`en`), in this order:

1. **Executive summary** — non-technical: what was tested, overall risk posture, headline risks, and a
   risk snapshot (finding counts by severity). Lead with any access obtained.
2. **Scope** — target, in/out of scope, box level, environment, window, effort.
3. **Methodology** — approach and standards (OWASP WSTG / Top 10 / API Top 10 / ASVS, CVSS 3.1).
4. **Findings overview** — severity-count table plus a findings-at-a-glance table (ID, severity+CVSS,
   category, title).
5. **Recommendations** — prioritized, highest-impact first.
6. **Detailed findings** — ordered by severity, each with the fields above.
7. **Coverage of tested areas** — status per area examined (see below).
8. **Appendix: CVSS 3.1 scoring bands.**

Pass a `testedAreas` list so the overview shows a status per area you examined — use the statuses `ok`
(Fehlerfrei), `partial` (Teilweise fehlerhaft), `faulty` (Fehlerhaft), `improvements` (Verbesserungen
möglich), `performed` (Durchgeführt), `not_tested`. List the areas you tested even when they were clean,
so coverage is visible.

## First iteration vs. final

You produce a **first iteration** — it saves the human team time, it does not replace their judgment.

- Drive findings to a verified or exploited conclusion wherever you can — proof beats suspicion. Reserve
  `needs_review` for leads you genuinely could not confirm, each with a clear next step. Do not inflate
  severity or confidence — a precise `low`/suspected beats an overstated `high`, and a verified `high`
  beats a vague one.
- In **autonomous_light** mode you may confirm low-risk issues yourself, but exploitation still needs
  approval and anything you could not safely verify stays `needs_review`.

Follow the QA principle: **never report something that is not actually a vulnerability.** In the
management summary, state plainly what was covered, what was not, the headline risks (lead with any
access obtained), and the recommended next steps for the human team (including denied approvals and
out-of-scope leads).
