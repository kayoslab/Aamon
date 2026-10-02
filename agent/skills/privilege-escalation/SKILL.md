---
description: Use once you have any foothold in a web application (a session, a low-privilege user, a tenant) and need to climb and solidify — horizontal to other users/tenants, vertical to administrator/superuser, then consolidate and prove full impact. The second half of the mandate after initial-access. Progressively deeper than the WSTG checklist.
---

# Privilege escalation and consolidation

You have a foothold. Now climb (see `SPEC.md` §1–2): reach the highest privilege and the most sensitive
data the application holds, then consolidate that access and demonstrate the real impact. Do not stop at
the first rung — a low-privilege session is the start of the interesting part.

## First move: re-enumerate from inside

The authenticated surface is almost always larger than the anonymous one. Before escalating, re-map:

- Crawl again as the authenticated user (`katana` with the session cookie); diff against the anonymous
  crawl to find newly visible routes, menus, and API operations.
- Pull the client-side bundles again — role gates, feature flags, and admin routes are often all present
  in the JS, merely hidden from your role.
- Re-run `arjun` and content discovery on authenticated endpoints; mine every new parameter.
- Read what your role can see for references to higher-privilege objects, user ids, tenant ids, and
  internal endpoints.

## Horizontal escalation (become other users / reach other tenants)

- **IDOR / BOLA (API1):** on every object-scoped endpoint, swap the object id (numeric, UUID, slug,
  composite) for another user's. Try predictable ids, enumerated ids, and ids leaked elsewhere. UUIDs
  are not a control — they often leak in listings, emails, or other responses.
- **Multi-tenant isolation:** change the tenant/org id in the path, body, header (`X-Tenant-Id`), or JWT
  claim. Cross-tenant reads/writes are high impact. Test every tenant-scoped operation.
- **Parameter/identity confusion:** pass both your id and a victim's; array vs scalar (`user[]=you&user[]=them`);
  second-order where a stored value is later trusted for another user.

## Vertical escalation (low-privilege → admin / superuser)

- **BFLA (API5):** call privileged functions/methods as a low-privilege user — admin API operations,
  `admin-ajax` actions, management endpoints, GraphQL mutations. The function often checks that you are
  logged in, not that you are allowed.
- **Mass assignment / object property-level authz (API3):** add privileged fields to a profile/update
  request body — `role`, `is_admin`, `isAdmin`, `group`, `permissions`, `owner_id`, `verified`,
  `price`, `balance`. JSON and form bodies both; try nested and array forms.
- **Forced browsing to admin:** request admin routes/panels directly with your low-priv session; many
  rely on UI hiding, not server enforcement.
- **Role/claim tampering:** if roles live in a client-controlled place (JWT claim, cookie, hidden field,
  localStorage echoed to the server), change it — then re-check with JWT forgery from `initial-access`.
- **Workflow/state abuse:** reach a privileged state by skipping or reordering steps (approve your own
  request; self-grant; complete a flow that assumes a prior admin action).
- **Second-order / stored escalation:** store a payload or a privileged value as a low-priv user that is
  later rendered or trusted in an admin context (stored XSS hitting an admin session is a classic
  low-to-admin chain).

## Server/host escalation (when the app runs code or fetches for you)

- **SSRF → internal/admin services and cloud metadata** → credentials → broader access.
- **RCE (SSTI, deserialization, upload, LFI→RCE, CVE):** from command execution, read the app's session
  store, signing keys, DB credentials, or config and mint higher-privileged sessions — least-invasive,
  non-destructive proof only; gate anything risky.
- **Secrets harvest:** from any read primitive, look for `.env`, config, keys, `/proc`, backups, source
  maps, and tokens in logs — then reuse them to reach admin or the backend.

## Consolidate and prove impact

Escalation is not the end; show what it means:

- Chain findings into the engagement's worst-case abuse cases (full account takeover, read/modify any
  tenant's data, reach the backend/database, admin of the whole app).
- Demonstrate the reach with a minimal, non-destructive proof for each level: one admin-only record read,
  a benign action in an account that is not yours, an `id`/`whoami` from the host. Never destroy, persist,
  or mass-exfiltrate to prove it.
- Document the full path from unauthenticated → foothold → each escalation → final impact, so the chain
  and its business consequence are unambiguous in the report.

## Boundaries

Escalate autonomously within two rails you enforce yourself: stay in scope (`check_scope`), and do not
take it down (least-invasive proofs only; don't run availability/integrity-risky actions, log them
instead). No approval step is needed to escalate. Record each escalation as a finding with its
WSTG / OWASP Top 10 / API Top 10 reference, CWE, and CVSS 3.1.
