---
description: Use when starting an engagement from a briefing — what a well-structured web-pentest scoping / Rules of Engagement document contains, how to read it, how to map it to the engagement record, and how to verify authorization before any testing.
---

# Reading the briefing (scope & Rules of Engagement)

A good web-pentest briefing is a short scoping / Rules of Engagement (RoE) document. The input may be a
form, an email, or a paragraph — your job is to extract these sections into `record_engagement`, and to
chase down anything missing before you touch the target. A well-structured briefing covers:

### 1. Engagement overview & objectives
What the application is and does, and what the test should achieve (e.g. "prove whether an anonymous
attacker can reach another customer's data"). → `systemPurpose`, `objectives`.

### 2. Targets & scope
The exact authorized surface, and everything explicitly off-limits.
- **In scope:** base URLs, hostnames, API base paths, specific apps/subdomains. → `scope.inScope`.
- **Out of scope:** domains, endpoints, third-party/SaaS dependencies, and techniques that are forbidden
  (out-of-scope always wins). → `scope.outOfScope`.
- **Environment:** production, staging, QA, or a dedicated test environment. → `environment`.
- **Reachability:** internet-facing or internal-only. → `availability`.

### 3. Rules of engagement
The limits that shape how you test.
- Testing window / allowed hours, and the do-not-take-it-down rule (no DoS/stress; non-destructive proofs).
- Rate limits and whether a WAF will be relaxed / tester IPs allowlisted.
- Data-handling rules (what may be read, screenshotted, or exfiltrated as proof; PII/GDPR constraints).
- Abort criteria and the contact / escalation chain. → `constraints`.

### 4. Access & test identities
- **Box level:** black / grey / white box. Prefer whitebox + source where offered. → `box`.
- **Credentials & roles:** a test account **per role** (plus admin) multiplies coverage — many
  high-impact bugs (IDOR, type juggling, custom-auth flaws) need authenticated, multi-role testing.
  → `roles`, `access.method`, `access.details`, `knowledge.credentials` (by reference, never raw secrets).

### 5. Threat model & abuse cases
- **Attacker model(s):** unauthenticated external, and/or an authenticated low-privilege user.
  → `attackerModel`.
- **Protection goals** and the **worst-case scenario** the client fears → `protectionGoals`, `worstCase`,
  then derive concrete **abuse cases** to prove or disprove (especially "get in without credentials" and
  "escalate to admin / another tenant"). → `abuseCases`.

### 6. Logistics & authorization
- Client organization and primary contact. → `client`.
- **Authorization:** who signed off, and the reference (SoW / RoE / ticket). → `authorization`.
- Reporting preferences: language (`de`/`en`) and depth/effort. → `reportLanguage`, `effortPersonDays`.
- Technology stack / hosting, if known — it drives technology-specific testing. → `underlyingTechnology`.

This agent tests **web applications and their APIs only** — set `pentestTypes` to `web_app` and/or
`web_services`. If the briefing asks for a non-web surface (infrastructure, AD, wireless, mobile,
hardening), note it is out of this agent's scope and record only the web portion.

## Verify before you record

If you cannot identify an **authorizer** and an **owned/authorized scope**, stop and ask — never proceed
on assumption. For production targets, recommend a backup beforehand and that the WAF be relaxed for the
tester's source IPs so real application bugs are not masked.

## Recording

Call `record_engagement` once with the structured result, then read the scope, box, attacker model, and
rules of engagement back to the operator in plain language. In an unsupervised run, proceed directly
once scope and authorization are established; re-record if more knowledge is handed over. Reference
credentials by role, not raw secrets.
