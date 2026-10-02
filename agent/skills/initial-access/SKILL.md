---
description: Use when the goal is to get INSIDE a web application without being given credentials — obtain a valid session, become or impersonate a user, or reach authenticated/privileged state from an unauthenticated start. The primary objective of every engagement. Covers auth bypass, account takeover, token forgery, SSRF/RCE-to-access, and chaining. Progressively deeper than the WSTG checklist.
---

# Initial access — getting in with no credentials

This is the primary objective (see `SPEC.md` §1): reach authenticated state without a password, key, or
token you were given. Think in terms of *paths in*, and pursue each to a proven session or impersonated
user. A minimal non-destructive proof — a session cookie that is not yours, an `id` from an admin-only
endpoint, one record belonging to another user — is the result. Exploit autonomously; stay in scope and
non-destructive, and simply don't run anything that could disrupt availability or integrity.

## The paths in (work them in roughly this order of likelihood)

### 1. Broken access control to authenticated data (often no "login" needed at all)
The most common way in is that the app never really enforced auth on some surface:
- **Forced browsing / missing authz:** request authenticated routes, admin panels, API operations, and
  `admin-ajax`/action endpoints directly, unauthenticated. Many apps protect the UI link, not the route.
- **IDOR / BOLA on unauthenticated endpoints:** object-scoped endpoints that accept an id without a
  session (password-reset status, order lookup, invoice/PDF, profile APIs) leak other users' data.
- **Old/shadow API versions (API9):** `/v1`, `/internal`, staging vhosts, and mobile-only endpoints
  frequently skip the access controls the current app enforces. Enumerate them (`gau`, swagger, JS).
- **Verb/alternate-encoding bypass:** try `GET` vs `POST` vs `PUT`, `X-HTTP-Method-Override`, trailing
  `/`, `%2e`, case, and `..;/` path tricks against a 401/403 route.

### 2. Authentication logic bypass
- **Auth-schema bypass:** set `isAuthenticated`-style cookies/params; reach step 2 of a flow without
  step 1; replay a post-login redirect token; downgrade to a weaker login channel (legacy, mobile API).
- **SQL/NoSQL injection in login:** `' OR '1'='1`, `admin'--`, NoSQL operator injection
  (`{"user":{"$ne":null},"pass":{"$ne":null}}`) — a classic direct path to a session.
- **Response tampering:** flip `{"success":false}`/`2FA_required:true` in a proxied response where the
  client trusts it; skip/replay/brute (volume brute is destructive-edge) an MFA step.
- **Default / seeded credentials:** `admin:admin`, documented defaults for the fingerprinted product,
  install leftovers (`/install`, setup wizards left enabled). Within non-disruptive brute limits.

### 3. Token forgery and confusion (become anyone)
- **JWT:** `alg:none`; HS/RS key confusion (sign with the public key as HMAC secret); weak-secret crack
  (`jwt_tool`, rockyou); `kid`/`jku`/`x5u` injection to point verification at a key you control; claim
  tampering (`sub`, `role`, `admin:true`) with expiry extension. Forge a valid session for any user.
- **Session tokens:** predictable/sequential ids, fixation (set a known id pre-login, inherit the
  authenticated session), tokens leaked in URLs/referrers/logs, missing rotation on privilege change.
- **OAuth/SSO:** `redirect_uri` validation gaps and open redirects to steal the `code`/token; missing
  `state` (login CSRF / account linking); `id_token` audience/issuer confusion; implicit-flow token leak.
- **Password-reset takeover:** host-header poisoning of the reset link (so the token comes to you),
  token predictability/reuse, reset-token not bound to the account, user enumeration to target.

### 4. Server-side flaws that yield access
- **SSRF → secrets → access:** reach cloud metadata (169.254.169.254, IMDSv2), internal auth services,
  or an admin panel bound to localhost; harvest a token/credential and reuse it.
- **SSTI / deserialization / file-upload / LFI → RCE:** a single non-destructive RCE proof (read a
  harmless value, drop a benign canary) is a foothold; from the host, read the app's own session store,
  config secrets, or signing keys and mint a session.
- **Known CVE (`cve-hunting`):** an unauth RCE or auth-bypass CVE in the fingerprinted stack is often the
  shortest path. Prioritize KEV-listed ones.

### 5. Account takeover without touching the password
- Email/username change then reset; unverified-email trust; response-based 2FA disable; registration
  that collides with an existing account; "login with phone/social" linking flaws; cached credentials or
  autofill in a shared kiosk context.

## Method

1. **Map every authentication and object-access surface first** (login, SSO, reset, register, API auth,
   session issuance, every object-scoped endpoint). You can't bypass what you haven't found.
2. **Stand up out-of-band detection** (`interactsh-client`) before testing SSRF/XXE/RCE paths — many of
   these are blind.
3. **Attack each path above** with the tool that fits (`web-attack-techniques` has the cheat-sheet),
   varying encodings and WAF-bypass tricks. A 403/406 is a hint to vary, not to stop.
4. **Prove the access.** Capture the session/token and show one authenticated action you should not be
   able to perform — least-invasive, non-destructive. Never modify or destroy real data to prove it.
5. **The moment you are in, switch to `privilege-escalation`** and re-enumerate from the new vantage —
   the authenticated surface is usually far larger than the anonymous one.

## Chaining to get in

The real foothold is often a chain, not one bug: open redirect → OAuth `code` theft → session; reflected
XSS + permissive CORS → authenticated data/token theft → account takeover; SSRF → metadata creds →
internal admin; LFI → session-file/log read → forged/stolen session; host-header poisoning → reset-link
to attacker → takeover. For every low/medium finding, ask: *does this get me in, or get me closer?*

## Boundaries

Exploit autonomously within two rails you enforce yourself: stay in scope (`check_scope`), and do not
take it down (no credential-stuffing at volume, nothing destructive — least-invasive proofs only; don't
run availability/integrity-risky steps, log them instead). No approval step is needed to get in. Record
every attempt (with evidence) in the plan, and every proven path as a finding with its WSTG/Top-10 id.
