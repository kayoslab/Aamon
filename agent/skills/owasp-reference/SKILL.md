---
description: The OWASP knowledge base a senior web pentester carries — Web Security Testing Guide (WSTG) test categories, Top 10 (2021), API Security Top 10 (2023), and ASVS. Load it to turn "test everything" into a concrete, standards-referenced checklist, and to pick the right reference id for each finding. This is the floor, not the ceiling.
---

# OWASP reference — the checklist floor

Use OWASP as the systematic baseline: work every applicable test case, then go beyond it. Every finding
should carry the reference that classifies it (WSTG id, Top 10 category, or API Top 10 id) in its
`references` field. Checklists find the known classes; your judgment and chaining find the rest.

## OWASP Top 10 (2021) — risk categories

| ID | Category | What to prove |
| --- | --- | --- |
| A01 | Broken Access Control | IDOR/BOLA, BFLA, forced browsing, vertical/horizontal escalation, mass assignment, CORS/tenant isolation. The most common serious web flaw — test it hardest. |
| A02 | Cryptographic Failures | Weak/missing TLS, plaintext secrets, weak hashing, predictable tokens, keys in client code. |
| A03 | Injection | SQL/NoSQL/OS-command/LDAP/XPath/CRLF, plus XSS (client-side injection). |
| A04 | Insecure Design | Missing/weak business-logic controls, abusable workflows, insufficient rate-limiting by design. |
| A05 | Security Misconfiguration | Default creds, verbose errors, dir listing, dangerous methods, unpatched features, exposed admin/debug. |
| A06 | Vulnerable & Outdated Components | Known-CVE components (hand off to `cve-hunting`). |
| A07 | Identification & Authentication Failures | Credential stuffing/guessing, broken MFA, weak session mgmt, fixation, exposed/weak JWTs. |
| A08 | Software & Data Integrity Failures | Insecure deserialization, unsigned updates, CI/CD and supply-chain, missing SRI. |
| A09 | Security Logging & Monitoring Failures | Mostly observational in a pentest; note where attacks go unlogged. |
| A10 | Server-Side Request Forgery (SSRF) | Any server-side fetch reachable by user input → internal services, cloud metadata. |

## OWASP API Security Top 10 (2023)

| ID | Category |
| --- | --- |
| API1 | Broken Object Level Authorization (BOLA / IDOR) |
| API2 | Broken Authentication |
| API3 | Broken Object Property Level Authorization (mass assignment + excessive data exposure) |
| API4 | Unrestricted Resource Consumption (careful — do-not-take-it-down) |
| API5 | Broken Function Level Authorization (BFLA) |
| API6 | Unrestricted Access to Sensitive Business Flows |
| API7 | Server-Side Request Forgery |
| API8 | Security Misconfiguration |
| API9 | Improper Inventory Management (shadow/old API versions, undocumented endpoints) |
| API10 | Unsafe Consumption of APIs (trusting third-party API data) |

For APIs: pull the schema (swagger/openapi/WSDL, GraphQL introspection), enumerate every operation and
method, and run the authz matrix (BOLA/BFLA) from every role. API9 is a frequent way in — old `/v1`
endpoints and staging hosts often lack the newer access controls.

## WSTG — test categories (work each applicable one)

The Web Security Testing Guide is the systematic catalogue. Cover the categories that apply:

- **WSTG-INFO** Information Gathering — fingerprinting, recon, metafiles, entry points, app mapping.
- **WSTG-CONF** Configuration & Deployment — platform config, backups/old files, HTTP methods, HSTS,
  admin interfaces, cloud storage, subdomain takeover.
- **WSTG-IDNT** Identity Management — role definitions, registration/provisioning, account enumeration,
  weak username policy.
- **WSTG-ATHN** Authentication — default/guessable creds, lockout bypass, auth-schema bypass, remember-me,
  browser cache, weak password/reset, weaker-alternative channels, MFA.
- **WSTG-ATHZ** Authorization — directory traversal/file include, authz-schema bypass, privilege
  escalation, IDOR.
- **WSTG-SESS** Session Management — cookie attributes, fixation, exposed variables, CSRF, logout,
  timeout, session puzzling, JWT.
- **WSTG-INPV** Input Validation — XSS (reflected/stored/DOM), all injection classes (SQL/NoSQL/ORM/
  LDAP/XML-XXE/SSI/XPath/IMAP-SMTP/code/OS-command/SSTI), HTTP splitting/smuggling, host-header injection.
- **WSTG-ERRH** Error Handling — information leakage via errors and stack traces.
- **WSTG-CRYP** Cryptography — weak TLS, padding oracle, sensitive data over unencrypted channels.
- **WSTG-BUSL** Business Logic — data validation, forged requests, integrity checks, process timing,
  function-use limits, workflow circumvention, upload of malicious/unexpected files.
- **WSTG-CLNT** Client-side — DOM XSS, JS execution, HTML/CSS/URL-redirect injection, clickjacking,
  WebSockets, web messaging, storage, cross-origin resource sharing (CORS), reverse tabnabbing.
- **WSTG-APIT** API testing — the API Top 10 above, applied to discovered operations.

Cite the specific id on findings (e.g. `WSTG-ATHZ-02`, `WSTG-SESS-05`) alongside the CWE.

## ASVS — depth levels

OWASP ASVS defines verification requirements at three levels. Use it to set depth and to argue coverage:

- **L1** — basic, black-box achievable.
- **L2** — the standard for most applications handling sensitive data; the default target depth.
- **L3** — for high-value / high-assurance apps; exhaustive.

Map test depth to the engagement's protection need. For a high-protection-need target, test to L2/L3
requirements (session management, access control, cryptography, and input validation in particular).

## How to use this in practice

1. Turn the applicable WSTG categories and the Top 10 / API Top 10 into concrete `update_plan` tasks per
   endpoint, parameter, and role.
2. Treat A01 (access control) and A07/API2 (authentication) as the richest ground — they are the path to
   the engagement's real goal (`initial-access`, `privilege-escalation`).
3. Record each finding with its WSTG/Top-10 reference so coverage and classification are visible.
4. Then go **beyond** the checklist: business logic, chains, and technology-specific bugs the guide does
   not enumerate are where the highest-impact findings live.
