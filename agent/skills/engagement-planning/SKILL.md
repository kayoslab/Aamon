---
description: Use at the start of execution and throughout — build the living test plan, then work it across multiple iterations, expanding it as you learn, so the engagement reaches real depth instead of a single shallow pass.
---

# Planning and iteration

A real pentest is many iterations, not one sweep. A human tester spends days: they map the surface,
plan dozens of concrete tests, work them, and — critically — each test spawns new leads they chase. You
must do the same, tracked in a plan the `finalize_engagement` gate enforces.

## 1. Build the plan first (before deep testing)

After enumerating the surface, call `update_plan` with the initial backlog. Derive **concrete, specific
tasks** — one test each, not vague areas:

- One task per in-scope **host/endpoint × vulnerability class** (see `SPEC.md` §4).
- **Front-load the goal:** explicit tasks for credential-less initial access (`initial-access`) and, for
  each foothold you expect or reach, privilege escalation and consolidation (`privilege-escalation`).
- One task per **role × data boundary** (authz matrix) — from every role against every other role.
- One task per **abuse case** from the briefing's worst-case scenario.
- One task per **fingerprinted component** for the `cve-hunting` flow (and one per in-range CVE to verify).
- One task per **business-logic flow** (forms, workflows, state, redirects, multi-step).

Good: `area: injection, task: "test the /v2/search filter param for SQLi (boolean + time-based), via API with low-priv token"`.
Bad: `area: injection, task: "test for injection"`.

## 2. Work it in iterations

Pick tasks (fan out across distinct hosts with the `agent` tool), test them, and after each pass call
`update_plan` again to:

- Mark each attempted task **done** — put the evidence path or result in its `note`.
- **Defer** a task only for a genuine block (no credentials, RoE forbids it, needs client coordination) —
  put the reason and the exact follow-up in its `note`. Deferral is not an escape hatch for "hard."
- **Add the new tasks you just discovered**: new endpoints/parameters surfaced by enumeration, variations
  worth trying, chains between findings, deeper follow-ups on a lead, the next step after a foothold.

Then do another pass. **Expect several passes.** A first pass that finds "some" issues is the start, not
the end — the second and third passes, driven by what the first revealed, are where depth comes from.

## 3. Depth heuristics (what a 2-day human tester does that one pass misses)

- For each input, try many payload families and encodings, not one probe.
- For each finding, ask: can I escalate it, chain it with another, or reach higher impact?
- Re-run enumeration after any new access or new knowledge — the surface grows.
- Vary roles, tenants, and states; test negative and edge cases, not just the happy path.
- Follow every "interesting" response (odd status, timing, error, header) to a conclusion.

## 4. When you may finalize

`finalize_engagement` refuses while any task is `open` or `in_progress`. You may finalize only when:

- every task is `done` (with evidence) or `deferred` (with a follow-up), **and**
- a deliberate review pass over the plan and findings surfaces **no new leads** worth a task.

If a review pass still generates new tasks, you are not done — keep going. Do not mark tasks done without
evidence, and do not mass-defer to get past the gate; the point is depth, and the plan is the record of it.

Deliver **only** via `finalize_engagement` — it is the single action that compiles the report and
notifies the team. Never hand-write `engagement/report.md` yourself: a report file you create delivers
nothing and notifies no one. The engagement is complete only when `finalize_engagement` returns success.
