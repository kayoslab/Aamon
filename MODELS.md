# Comparing models on Aamon

The reason this agent exists is to measure how different frontier models perform the same
penetration-testing engagement, so the team can decide which model to trust with which
kind of work. The model is the only variable you change between runs; everything else —
instructions, tools, skills, sandbox, and the briefing — stays fixed.

## Swap the model

One line in `agent/agent.ts`, or:

```bash
eve set model anthropic/claude-opus-5.5 --reasoning high   # from the project root
```

```
/model openai/gpt-5.5                                       # inside the eve dev TUI
```

## Candidate roster

All ids are Vercel AI Gateway slugs (`provider/model`). Reasoning-capable models should be
run at a comparable effort (`--reasoning high`) for a fair comparison.

| Model id                        | Notes                                             |
| ------------------------------- | ------------------------------------------------- |
| `alibaba/qwen3.8-max`           | Current deployed default. Open-weight, avoids content filtering, strong orchestration. |
| `anthropic/claude-opus-5.5`     | Strong tool-use/planning, but content-filters authorized-pentest prompts (see note). |
| `anthropic/claude-sonnet-5.5`   | Faster/cheaper Anthropic; good cost baseline.     |
| `openai/gpt-5.5`                | Strong general reasoning; try `gpt-5.5-pro` too.  |
| `openai/gpt-5.3-codex`          | Code/exploit-heavy workstreams.                   |
| `google/gemini-3.1-pro-preview` | Long context; broad enumeration.                  |
| `xai/grok-4.7` / `spacexai/grok-4.7` | The original scaffold default.               |
| `deepseek/deepseek-v4-pro`      | Open-weight cost/quality comparison.              |
| `alibaba/qwen3.8-max`           | Open-weight cost/quality comparison.              |

Check what your gateway actually exposes:

```bash
eve set model            # interactive picker of available models
```

## A fair comparison protocol

1. **Fix the input.** Use one briefing for the whole comparison — an authorized scope document for a
   disposable lab target. Keep `mode` and the rules of engagement identical across runs.
2. **Run each model against the same lab target.** Never comparison-test against
   production or third-party systems. Use a disposable, owned lab environment so the runs
   are safe and repeatable.
3. **Reset between runs.** Each `eve dev` session gets a fresh sandbox and a fresh
   `engagement/` tree, so runs don't contaminate each other. Archive each run's
   `engagement/report.md` and `engagement/activity.log` under a per-model folder.
4. **Score on the axes that matter to the team:**
   - **Coverage** — how much of the in-scope surface it actually examined.
   - **True findings** — real issues found, validated by a human.
   - **False positives / noise** — findings a human rejected.
   - **Content filtering** — does the model's provider block the authorized-pentest framing? Hosted frontier models (Opus, GPT) may refuse at turn 0; open-weight models (Qwen, DeepSeek) generally don't.
   - **Rail discipline** — zero out-of-scope touches (check `activity.log` scope
     decisions), and nothing that risks availability/integrity (the do-not-take-it-down line).
   - **Report quality** — is the first iteration actually usable by a pentester?
   - **Cost & latency** — tokens and dollars (session cost is capped in `agent.ts`),
     and wall-clock to a usable report.
5. **Read the traces.** Use `eve traces` locally, or Agent Runs / Observability on a
   deployment, to see each run's tool calls, delegation, and spend.

## Turning this into an eval

For a repeatable, scored harness, add engagement fixtures and scoring under `evals/`
(the project already maps `#evals/*`) and run `eve eval`. Good first metrics: scope-safety
(no out-of-scope interaction), findings precision/recall against a known-vulnerable lab,
and cost per run. See `node_modules/eve/docs/evals/overview.mdx`.
