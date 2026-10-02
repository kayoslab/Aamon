import { callSlackApi } from "eve/channels/slack";
import { connectSlackCredentials } from "@vercel/connect/eve";
import { SEVERITY_LABEL, severityRank, type Engagement, type StoredFinding } from "./engagement";

export type NotifyResult = { sent: boolean; channel?: string; ts?: string; error?: string };

/**
 * Post a completion notification to the team's Slack channel via the standard
 * eve Slack connection. The main message carries a headline and the severity
 * summary; the full report markdown follows as threaded replies (chunked to
 * Slack's message limit) so the whole document lands without the deprecated
 * file-upload API — only the `chat:write` bot scope is required.
 *
 * Credentials resolve the same way as the Slack channel: a Vercel Connect
 * connector (AAMON_SLACK_CONNECTOR, default `slack/aamon`), or SLACK_BOT_TOKEN
 * when you manage the token yourself. Set AAMON_SLACK_CHANNEL_ID to the target
 * channel. A function-form Connect token is resolved with AAMON_SLACK_TEAM_ID
 * when that installation must be selected.
 */
export async function postSlackNotification(opts: {
  engagement: Engagement | null;
  findings: StoredFinding[];
  reportMarkdown: string;
  note?: string;
  title?: string;
  signal?: AbortSignal;
}): Promise<NotifyResult> {
  const channel = process.env.AAMON_SLACK_CHANNEL_ID;
  if (!channel) {
    return { sent: false, error: "No Slack channel configured (set AAMON_SLACK_CHANNEL_ID)." };
  }

  const connectorUid = process.env.AAMON_SLACK_CONNECTOR ?? "slack/aamon";
  const botToken = process.env.SLACK_BOT_TOKEN ?? connectSlackCredentials(connectorUid).botToken;
  const teamId = process.env.AAMON_SLACK_TEAM_ID;
  const context = teamId ? { teamId } : undefined;

  const lang = opts.engagement?.reportLanguage ?? "en";
  const SL = SEVERITY_LABEL[lang];
  const findings = [...opts.findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const name = opts.engagement?.name ?? "engagement";
  const counts = (["critical", "high", "medium", "low", "info"] as const)
    .map((s) => ({ s, n: findings.filter((f) => f.severity === s).length }))
    .filter((c) => c.n > 0)
    .map((c) => `${c.n} ${SL[c.s]}`)
    .join(" · ");
  const heading = opts.title ?? `Aamon — ${name}: first-iteration findings`;
  const top = findings.slice(0, 10).map((f) => `• ${f.id} [${SL[f.severity]}] ${f.title}`);

  const headline = [
    `*${heading}*`,
    opts.note,
    `Findings: ${findings.length}${counts ? ` (${counts})` : ""}`,
    ...top,
    findings.length ? "_Draft / needs_review findings require human validation. Full report follows in-thread._" : "",
  ]
    .filter(Boolean)
    .join("\n");

  const post = async (text: string, threadTs?: string) => {
    const res = await callSlackApi({
      botToken,
      context,
      operation: "chat.postMessage",
      body: { channel, text, ...(threadTs ? { thread_ts: threadTs } : {}) },
    });
    if (!res.ok) throw new Error(String(res.error));
    return String((res as { ts?: unknown }).ts ?? "");
  };

  try {
    const rootTs = await post(headline);
    // Full report as threaded replies, chunked under Slack's ~3000-char block limit.
    if (opts.reportMarkdown.trim()) {
      for (const chunk of chunkMarkdown(opts.reportMarkdown, 2800)) {
        if (opts.signal?.aborted) break;
        await post("```\n" + chunk + "\n```", rootTs);
      }
    }
    return { sent: true, channel, ts: rootTs };
  } catch (e) {
    return { sent: false, channel, error: `Slack post failed: ${(e as Error).message}` };
  }
}

/** Split markdown into chunks no larger than `max`, preferring line boundaries. */
function chunkMarkdown(md: string, max: number): string[] {
  const out: string[] = [];
  let buf = "";
  for (const line of md.split("\n")) {
    const piece = line.length > max ? line.slice(0, max) : line;
    if (buf.length + piece.length + 1 > max) {
      if (buf) out.push(buf);
      buf = piece;
    } else {
      buf = buf ? `${buf}\n${piece}` : piece;
    }
  }
  if (buf) out.push(buf);
  return out;
}
