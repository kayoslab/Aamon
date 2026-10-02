---
description: Reference for how to test each web vulnerability class and WHICH sandbox tool to use for each use case. Load alongside test-web-and-webservices when attacking a web target. Pick the tool that fits the task — don't run everything blindly.
---

# Web attack techniques — and which tool to use when

Choose the tool that fits the use case; don't fire every tool at everything. Use SecLists payloads
(`/opt/SecLists`), confirm **blind** variants out-of-band with `interactsh-client`, and always try
encoding/WAF-bypass variations. Prove impact and chain findings. Exploit autonomously — the only brake
is do-not-take-it-down. The **destructive-edge** techniques (request smuggling, cache poisoning, volume
brute-force, heavy fuzzing, dropping a live web shell) are the exception: never run them at disruptive
volume; in an unsupervised run skip them and log a follow-up, in an attended run they are the optional
`request_approval` steps. Everything else — bypasses, injection proofs, token forgery, escalation — you
run on your own.

## Tool selection cheat-sheet (use case → tool)

| Use case | Tool |
| --- | --- |
| Tech/stack fingerprint, live-host probing | `httpx`, `whatweb`, `wafw00f` |
| Crawl / discover endpoints | `katana`; historical URLs → `gau` |
| Find hidden directories/files | `ffuf`/`gobuster` + `/opt/SecLists/Discovery/Web-Content` |
| Find hidden parameters | `arjun` |
| Known-CVE / template scan (+ blind via OOB) | `nuclei` (`-dast`, fuzzing templates) + `interactsh-client` |
| WordPress specifics | `wpscan` |
| SQL injection | `sqlmap` |
| OS command injection | `commix` (`/opt/commix/commix.py`) |
| XSS (reflected/stored/DOM) | `dalfox` |
| JWT attacks | `jwt_tool` (`/opt/jwt_tool/jwt_tool.py`) |
| Blind SSRF/XXE/RCE/SQLi confirmation (OOB) | `interactsh-client` (canary domain) |
| TLS/cipher/cert | `testssl.sh`, `openssl s_client` |
| Everything manual (the core of the test) | `curl` + your judgment; the scanners only triage |

Scanners triage; the real findings come from manual testing guided by the classes below.

## Injection
- **SQLi:** every param (incl. `arjun`-found, JSON, headers, cookies) → `sqlmap -u … --batch` (boolean/
  time/error/union; raise `--level/--risk` within pacing). Blind → time-based or OOB (`--dns-domain`).
- **Command injection:** `commix` on suspect params; blind → interactsh canary.
- **SSTI:** detect with the polyglot `${{<%[%'"}}%\\`; identify the engine (Jinja2/Twig/Freemarker/ERB/
  Velocity), then engine-specific RCE payload from SecLists/PayloadsAllTheThings.
- **XXE:** any XML/SOAP/SVG/DOCX intake → external-entity file read + blind OOB exfil via interactsh.
- **NoSQL / LDAP / CRLF / header injection:** operator-injection and CRLF payloads; CRLF → response
  splitting / cache poisoning.

## SSRF
Any URL/host/file param, webhook, importer, PDF/image fetcher, or SSO callback → point at the interactsh
canary (confirm blind), then at cloud metadata (169.254.169.254; IMDSv2 headers), internal ranges, and
alternate schemes (`file://`, `gopher://`, `dict://`). Chain to credentials/internal services.

## Authentication & session
- **JWT:** `jwt_tool` — `alg:none`, HS/RS key confusion, weak-secret crack, `kid`/`jku`/`x5u` injection,
  claim/expiry tampering.
- **OAuth/SSO:** `redirect_uri` validation, `state`/CSRF, code/token leak via redirect/Referer.
- **Password reset:** host-header poisoning of the reset link, token predictability/reuse, user enum.
- **MFA:** logic bypass (skip/reuse/race), backup-code brute (destructive-edge), response tampering.
- **Session:** fixation, no rotation on privilege change, cookie flags, predictable tokens.

## Access control (test from EVERY role against every other)
- **IDOR/BOLA:** increment/swap object ids (numeric, UUID, slug) across accounts on every object-scoped
  endpoint.
- **BFLA / vertical escalation:** call privileged endpoints/methods and admin-ajax actions as a low-priv
  user; force-browse.
- **Mass assignment:** add extra fields (`role`, `is_admin`, `price`, `owner_id`) to JSON/form bodies.

## Client-side
- **XSS:** `dalfox` across reflected/stored/DOM; test each context (HTML/attr/JS/URL/template) and
  encodings; attempt CSP bypass; hunt DOM sinks (`innerHTML`, `eval`, `document.write`, `postMessage`
  without origin check).
- **Prototype pollution:** `__proto__`/`constructor.prototype` via JSON/query → chain to DOM XSS/gadget.
- **CSRF / clickjacking / open redirect:** weak/missing tokens + SameSite; frameable sensitive pages;
  redirect params (chain to OAuth/token theft).

## Request-layer (destructive-edge — disruption risk; attended-only, else skip-and-log)
- **HTTP request smuggling:** CL.TE / TE.CL / H2 desync between CDN/proxy and origin — directly relevant
  where the apex bypasses Cloudflare; timing probes only, and only in an attended run.
- **Web cache poisoning/deception:** unkeyed headers (`X-Forwarded-Host/-Scheme`), cache-key confusion,
  static-extension deception to cache authenticated pages.
- **Host header injection:** poison links / password-reset / routing.

## File & data
- **Upload:** bypass type/extension/magic-byte checks; polyglots; path in filename; served as active
  content → chain to RCE (prove non-destructively; persisting a live web shell is destructive-edge).
- **Path traversal / LFI:** `../` and encodings, PHP wrappers; chain LFI → RCE (log/session poisoning).
- **Deserialization:** spot serialized blobs (cookies, params, viewstate); PHP/Java/Python/.NET/Node
  gadget chains; blind → OOB.

## APIs
- **REST:** full method matrix, BOLA/BFLA, mass assignment, excessive data exposure, missing rate limits,
  injection; abuse batch endpoints.
- **GraphQL:** introspection (or infer schema), field-level authz, injection via resolvers, batching
  (DoS-careful).
- **SOAP:** WSDL-driven, XXE, SOAPAction abuse.

Always: OOB-confirm blind variants, vary encodings/WAF bypasses, prove impact with the least-invasive
PoC, chain findings, and record each attempt (with evidence) in the plan.
