# Running an attended (assist) engagement

Unattended runs already drive hard at the goal — getting in without credentials and escalating — using
every non-disruptive technique on their own. Run **attended** when you also want the steps that sit on
the do-not-take-it-down line: volume brute-force, request smuggling, cache poisoning, and anything
state-changing or destructive, which Aamon performs only behind `request_approval`. That means a human
must be available to answer prompts.

Write an attended briefing (your authorized scope and rules of engagement, with test accounts per
role) and run it one of these three ways.

## Option A — Slack (recommended)

Use the standard eve Slack channel: `@mention` Aamon in the engagement channel (or DM it) and paste the
briefing. Approvals from `request_approval` render as **Approve / Deny** buttons in the thread, so an
attended run is just a conversation. See the README for channel setup.

## Option B — interactive TUI

- Locally: `npm run dev` (the eve TUI), then paste the attended briefing. Approve/deny inline.
- Or from a client app built on the eve client SDK against the deployment.

## Option C — via the intake API, then answer approvals over HTTP

1. Submit with `attended: true` (JSON form, so the flag is set), reading your briefing from a local file:

   ```bash
   curl -u "$OPERATOR" https://<deployment>/intake \
     -H 'content-type: application/json' \
     -d "{ \"name\": \"ACME staging web-app\", \"attended\": true,
           \"briefing\": $(python3 -c 'import json;print(json.dumps(open("my-briefing.md").read()))') }"
   ```

   It returns a `sessionId`.

2. Watch the session stream and look for `input.requested` events (each carries a `requestId` and the
   approval options):

   ```bash
   curl -N -u "$OPERATOR" https://<deployment>/intake/<sessionId>/stream
   ```

3. Answer each approval by posting `inputResponses` to the session:

   ```bash
   curl -u "$OPERATOR" -X POST https://<deployment>/eve/v1/session/<sessionId> \
     -H 'content-type: application/json' \
     -d '{"inputResponses":[{"requestId":"<requestId>","optionId":"approve"}]}'
   ```

   Use `"optionId":"deny"` to refuse a step. A plain follow-up `message` whose text matches an option
   (e.g. `approve`) also works.

Because the run pauses for you, do **not** walk away from an attended engagement — it will park at
each approval until answered. When it finishes it finalizes and notifies exactly like an unattended run.
