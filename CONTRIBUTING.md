# Contributing to Aamon

Thanks for your interest in Aamon — an autonomous web-application penetration tester built on the
[eve](https://eve.dev) agent framework. This document covers how to get set up, the conventions the
codebase follows, and the one thing that is non-negotiable: the safety boundary.

## Read this first: responsible use and the safety boundary

Aamon is an **offensive** security tool that performs real exploitation. It is built to be run **only**
against systems you own or are explicitly authorized to test. Two rules are the heart of the design, and
the agent enforces them itself:

1. **Authorization and scope.** Every target is gated through `check_scope` before any action; out-of-scope
   always wins.
2. **Do no harm.** No denial-of-service, no destructive or state-changing actions, no mass exfiltration —
   non-destructive proofs only.

**Contributions must preserve both.** A change that removes, weakens, or lets the agent bypass the scope
gate or the do-no-harm rule will not be accepted. If you are adding a capability that could cross those
lines (a new scanner, an exploit primitive, a tool that writes to a target), make the non-destructive,
in-scope path the default and the only one the agent takes autonomously.

If you find a security issue **in Aamon itself** (for example, a way the scope gate can be bypassed), please
report it privately to the maintainer rather than opening a public issue, and give us a chance to fix it.

## Getting set up

Requires **Node.js 24+**. `eve` is installed as a local dependency.

```bash
npm install
npm run dev        # launches the eve dev TUI; paste a briefing to begin
```

Before you open a PR, make sure the project still compiles:

```bash
npm run typecheck  # tsc, must pass clean
npm run build      # eve build (optional locally; it prepares the sandbox template)
```

## Project layout

Everything that defines the agent lives under `agent/` and eve compiles and runs it:

```
agent/
├── instructions.md    persona, mandate, boundaries, how it runs an engagement
├── agent.ts           model selection and per-session cost/time limits
├── sandbox.ts         the disposable /workspace and its baked toolkit
├── channels/          how you reach it (Slack, HTTP intake, the eve session API)
├── tools/             the agent's tools (defineTool + a zod inputSchema each)
├── lib/               shared, typed helpers (engagement/plan/areas/campaign/coverage/report)
├── skills/            loadable knowledge, one SKILL.md per skill directory
├── schedules/         cron-like background work (the campaign heartbeat)
└── hooks/             the audit log of every command, tool, and result
```

`AGENTS.md` has the framework-level guidance, and the installed eve docs (`ls node_modules/eve/docs`) are
the reference for authoring tools, channels, skills, subagents, and deployment. Read the routed page before
writing new framework code.

## Conventions

- **TypeScript, strict.** Keep `npm run typecheck` green. Prefer typed helpers in `lib/` over inline logic
  in tools.
- **Tools** are `defineTool({ description, inputSchema, execute })` with a **zod** `inputSchema`. Write the
  `description` for the model — it is how the agent decides when to call the tool.
- **Root-only vs. worker tools.** Tools that own shared state (the plan, the leads, phase transitions,
  opening areas, finalizing, notifying) set `availableInSubagents: false` so a fan-out worker can't race or
  double-act. Tools a dispatched worker needs (`check_scope`, `record_recon`, `record_finding`,
  `record_subarea`, scans) stay available to subagents. Keep that discipline when adding a tool.
- **Shared sandbox, non-overlapping writes.** The root and its workers share one `/workspace`. When workers
  run in parallel, give each a write scope it owns (for example, each area writes only under
  `engagement/areas/<its-id>/`) so there are no write races.
- **Config via `AAMON_*` env vars**, read in `lib/` with a sane default (see `lib/campaign.ts`,
  `lib/coverage.ts`, `lib/plan.ts`). Document any new one in the README's Configuration table.
- **Skills** are a directory under `agent/skills/<name>/` with a `SKILL.md`. Add a skill when the knowledge
  is loadable on demand rather than always in the prompt.
- **Keep the model swappable.** The model under test is a single line in `agent/agent.ts` — don't scatter
  model assumptions through the code. See `MODELS.md` for the comparison protocol.

## Pull requests

1. Branch off `main`.
2. Make the change, keep it focused, and update the README/SPEC when you change behavior or add an env var
   or a tool.
3. Run `npm run typecheck` (and `npm run build` if you touched `sandbox.ts`).
4. Open a PR with a clear description of what changed and why. If it touches exploitation behavior, say how
   it stays within the two safety rules above.

Small, well-scoped PRs are easiest to review. If you're planning something large, open an issue first to
discuss the approach.

## License

By contributing, you agree that your contributions are licensed under the project's [MIT License](./LICENSE).
