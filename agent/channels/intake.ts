import { defineChannel, GET, POST } from "eve/channels";
import { routeAuth, vercelOidc } from "eve/channels/auth";
import { operatorBasicAuth } from "../lib/auth-config";

/**
 * Fire-and-forget intake for an engagement briefing.
 *
 * POST a briefing document and Aamon starts a durable session that runs to a
 * result on its own — you can close your laptop. The engagement's workstreams
 * run as durable background tasks that continue server-side on Vercel; when they
 * all settle, the agent finalizes: it compiles the report and notifies the team
 * on Slack in one step (see finalize_engagement).
 *
 * Request (JSON):
 *   { "briefing": "<the requirements / scope document text>",
 *     "recipients": ["team@example.com"],   // optional note of who to copy (Slack is the delivery channel)
 *     "name": "ACME Q1 Web-App",            // optional label
 *     "attended": false }                   // default false = unsupervised; exploits autonomously
 *
 * A raw text/markdown body is also accepted as the briefing.
 * Returns { sessionId } immediately. Reconnect to progress at
 * GET /intake/:sessionId/stream.
 */
export default defineChannel({
  turnPolicy: "queue",
  routes: [
    POST("/intake", async (request, { from }) => {
      const auth = await routeAuth(request, [vercelOidc(), operatorBasicAuth()]);
      if (auth instanceof Response) return auth;

      const contentType = request.headers.get("content-type") ?? "";
      let briefing = "";
      let recipients: string[] = [];
      let name = "";
      let attended = false;
      if (contentType.includes("application/json")) {
        const body = (await request.json()) as {
          briefing?: string;
          recipients?: string[];
          name?: string;
          attended?: boolean;
        };
        briefing = body.briefing ?? "";
        recipients = Array.isArray(body.recipients) ? body.recipients : [];
        name = body.name ?? "";
        attended = body.attended === true;
      } else {
        briefing = await request.text();
      }

      if (briefing.trim() === "") {
        return Response.json({ error: "Empty briefing. Provide the requirements document." }, { status: 400 });
      }

      const mode = attended ? "assist" : "autonomous_light";
      const recipientLine = recipients.length
        ? `Note for the write-up — intended recipients: ${recipients.join(", ")}.`
        : `Deliver the report to the team's Slack channel (finalize_engagement handles this).`;
      const unattendedRules = attended
        ? ""
        : "\nThis is an UNSUPERVISED run: work end to end on your own and EXPLOIT AUTONOMOUSLY. Pursue " +
          "the full goal — get inside the application without credentials and then escalate — using every " +
          "offensive technique (auth bypass, broken access control, IDOR/BOLA, token forgery, injection " +
          "and SSRF proofs, known-CVE exploitation, chaining). Do NOT wait for approval and do NOT call " +
          "request_approval; there is no human to answer. The two hard limits still bind absolutely and " +
          "you enforce them yourself: stay in scope (check_scope), and do NOT take it down or harm it — " +
          "anything that could affect availability, integrity, or other users' data (DoS/stress, volume " +
          "brute-force, destructive or state-changing actions, request smuggling, cache poisoning, mass " +
          "exfiltration) you simply do not run; use a least-invasive proof or log it as a follow-up with " +
          "the exact next step.";

      const message =
        `[Automated engagement intake]\n` +
        `Operating mode: ${mode}.${name ? ` Engagement label: ${name}.` : ""}\n` +
        `${recipientLine}${unattendedRules}\n\n` +
        `Run this engagement end to end: read the briefing below, record the engagement (record_engagement), ` +
        `plan, load the relevant domain skill(s), test within scope (check_scope), record findings ` +
        `(record_finding), and finish by calling finalize_engagement — the ONLY way to deliver the report ` +
        `and notify the team; NEVER hand-write engagement/report.md yourself. When you have launched the ` +
        `workstreams, acknowledge and let the background tasks run to completion.\n\n` +
        `--- BRIEFING ---\n${briefing}`;

      const address = `engagement-${crypto.randomUUID()}`;
      const session = await from(address).send(message, { auth, taskDeliveryPolicy: "cohort" });
      return Response.json({ sessionId: session.id, address }, { status: 202 });
    }),

    GET("/intake/:sessionId/stream", async (request, { attachSession, params }) => {
      const auth = await routeAuth(request, [vercelOidc(), operatorBasicAuth()]);
      if (auth instanceof Response) return auth;
      const events = await attachSession(params.sessionId).getEventStream();
      const encoder = new TextEncoder();
      const ndjson = events.pipeThrough(
        new TransformStream<unknown, Uint8Array>({
          transform(event, controller) {
            const line = typeof event === "string" ? event : JSON.stringify(event);
            controller.enqueue(encoder.encode(line + "\n"));
          },
        }),
      );
      return new Response(ndjson, {
        headers: { "content-type": "application/x-ndjson; charset=utf-8" },
      });
    }),
  ],
});
