---
description: Use when testing a web application, REST/SOAP/GraphQL API, or website. How a senior pentester actually approaches a web test — understand the app, map the full surface and hidden parameters, attack every function systematically with out-of-band detection, and chain findings into impact. Not a scanner pass.
---

# Web applications & webservices — how to actually test one

Standards: OWASP WSTG (work through its test cases, don't just name them — see `owasp-reference`), API
Security Top 10, ASVS L2/L3. A scanner pass is not a pentest. Think like an attacker: understand
what the app does, model how to abuse each function, attack it with real inputs, confirm blind issues
out-of-band, and chain bugs into real impact. Track every test in the plan (`update_plan`); load
`web-attack-techniques` for per-class depth, and `cve-hunting` for the components.

## 1. Understand the application first (before firing anything)

- Walk the whole app: every page, feature, user journey, role, and state transition. What does it *do*?
  Where is the sensitive functionality — auth, account management, payments, uploads, admin, data
  access, search, integrations/webhooks, file/report generation?
- Fingerprint the stack precisely (`whatweb`, `httpx`, headers, generator meta, JS bundles) and run
  `cve-hunting` on every component.
- Map **trust boundaries and data flows**: where does user input cross into SQL, OS commands, a
  template engine, a file path, another service/URL, the browser DOM, or a deserializer? Those crossings
  are where the bugs are. Turn each into plan tasks and abuse cases.

## 2. Map the full surface — you can't attack what you haven't found

- **Crawl:** `katana` plus the app's own links, `sitemap.xml`, `robots.txt`, JS-referenced endpoints.
- **Historical/known URLs:** `gau <host>` (wayback, commoncrawl, OTX, URLScan) surfaces old endpoints,
  parameters, backups, and API paths the live app no longer links.
- **Content discovery:** `ffuf`/`gobuster` with SecLists (`/opt/SecLists/Discovery/Web-Content/*`) —
  directories, backups, admin, debug, API docs (swagger/openapi), `.git`, config.
- **Parameter mining:** `arjun -u <url>` finds hidden/undocumented GET/POST/JSON parameters per
  endpoint. Un-scanned params are where un-found bugs live — mine every interesting endpoint.
- **APIs:** pull swagger/openapi/WSDL and GraphQL introspection; enumerate every route, method, and param.

## 3. Set up out-of-band detection (or you miss a whole class of bugs)

Start `interactsh-client` and use its domain as the canary for **blind** SSRF, XXE, RCE, SQLi, and
OOB-over-DNS/HTTP. `nuclei` integrates interactsh automatically. Many of the highest-severity web bugs
are blind — without OOB you will not see them.

## 4. Attack every function systematically

Work WSTG across every input, endpoint, parameter, and role. Load `web-attack-techniques` for exactly
how to test each class with the baked tools. Cover at minimum: authentication (incl. MFA, password
reset, JWT, OAuth/SSO), authorization (vertical + horizontal, IDOR/BOLA/BFLA from every role),
session/CSRF, injection (SQL/NoSQL/command/XXE/SSTI/LDAP/CRLF), SSRF (incl. cloud metadata), file upload,
path traversal/LFI, insecure deserialization, business logic, HTTP request smuggling, cache
poisoning/deception, host-header attacks, CORS, open redirect, client-side (XSS in every context, DOM,
prototype pollution, postMessage), and API-specific (mass assignment, excessive data exposure, rate
limiting, GraphQL).

Depth, not one probe per input: test payload **families** and encodings (`/opt/SecLists/Fuzzing`,
PayloadsAllTheThings patterns). A WAF 406 is a hint to vary encoding/case/path, not to stop (the agent
already found a `//readme.txt` WAF bypass — WAFs are routinely bypassable).

## 5. Exploit to impact and CHAIN

A pile of medium findings is not the goal. For each finding, push to a demonstrated (least-invasive)
proof of impact, then ask what it chains into — e.g. open redirect → OAuth token theft; reflected XSS +
permissive CORS → authenticated data theft/account takeover; SSRF → cloud metadata → credentials →
deeper access; upload + traversal → web shell (prove non-destructively). The findings that matter most are usually chains.

## 6. Gotchas

- Prefer whitebox/source access and a test account **per role** — ask for them; they multiply findings.
- Ask the client to disable the WAF for tester IPs; it masks real application bugs.
- The backend is in scope, not just the frontend. Pace per origin; 429/WAF means back off, not abort.
- Exploit autonomously; the only brake is do-not-take-it-down. The destructive-edge techniques (request
  smuggling, cache poisoning, volume brute-force, heavy fuzzing, persisting a live web shell) are never
  run at disruptive volume: skip-and-log them in an unsupervised run, attended-only otherwise.

## Sandbox toolkit

`curl`, `httpx`, `katana`, `gau`, `arjun`, `ffuf`, `gobuster`, `nuclei` (+ `-dast`/fuzzing templates,
interactsh-integrated), `dalfox`, `sqlmap`, `commix` (`/opt/commix/commix.py`), `jwt_tool`
(`/opt/jwt_tool/jwt_tool.py`), `wpscan`, `wafw00f`, `testssl`, `openssl`, `interactsh-client`. Wordlists
and payloads under `/opt/SecLists` (Discovery/Web-Content, Fuzzing, Usernames, Passwords, Payloads).
