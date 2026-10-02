import { defineAgent } from "eve";

/**
 * Aamon — a senior offensive-security operator ("lead penetration tester").
 *
 * The model here is the variable under test. The whole point of this project is
 * to compare how different frontier models perform the same engagement, so keep
 * this to a single, easily swapped line. See MODELS.md for the candidate roster
 * and the comparison protocol. Swap it with any of:
 *   eve set model anthropic/claude-opus-5.5 --reasoning high
 *   /model openai/gpt-5.5          (from the dev TUI)
 *
 * The default is a strong general-reasoning model; recon/exploitation reasoning
 * benefits from high effort.
 */
export default defineAgent({
  // Open-weight model. Content-filter/data-inspection results so far:
  //   anthropic/claude-opus-5.5  -> BLOCKED (provider content-filter, turn 0)
  //   alibaba/qwen3.8-max-prime  -> BLOCKED (Alibaba DataInspectionFailed, turn 0)
  //   alibaba/qwen3.8-max        -> ran mild passes, but Alibaba DataInspectionFailed kills
  //                                 aggressive intrusive runs MID-RUN (non-retryable 400)
  //   deepseek/deepseek-v4-pro   -> different provider, no Alibaba inspection; runs the offensive
  //                                 profile clean. Default for intrusive/offensive engagements.
  model: "deepseek/deepseek-v4-pro",
  reasoning: "high",
  limits: {
    // A single engagement can run long and fan out to subagents. Keep a cost
    // ceiling so an autonomous run cannot spend without bound, and a long
    // session lifetime so a durable test is not cut off mid-flight. Tune these
    // per engagement or set to `false` to disable.
    maxTokenCostUsdPerSession: 150,
    sessionTimeoutMs: 7 * 24 * 60 * 60 * 1_000,
  },
});
