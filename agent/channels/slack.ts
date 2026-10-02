import { connectSlackCredentials } from "@vercel/connect/eve";
import { defaultSlackAuth, slackChannel, type SlackMessage } from "eve/channels/slack";

/**
 * Slack channel — the standard eve Slack connection.
 *
 * This puts Aamon inside a Slack workspace: operators kick off and steer an
 * engagement by @mentioning the bot or DMing it, approvals from
 * `request_approval` render as interactive buttons, and `finalize_engagement`
 * posts the finished report to the engagement channel (see `lib/notify.ts`).
 *
 * Setup is Vercel Connect (recommended): run `eve add channel/slack`, which
 * creates/links the Slack connector and registers `/eve/v1/slack` as a trigger
 * destination. The connector uid defaults to `slack/aamon`; override it with
 * AAMON_SLACK_CONNECTOR. If you manage the bot token yourself instead, set
 * SLACK_BOT_TOKEN + SLACK_SIGNING_SECRET and the channel still works.
 *
 * Fail closed: because a valid Slack signature only proves Slack sent the event
 * (not that the sender is authorized), restrict who can drive the agent with an
 * allowlist. Set AAMON_SLACK_ALLOWED_USERS and/or AAMON_SLACK_ALLOWED_CONVERSATIONS
 * (comma-separated Slack ids). If neither is set, the channel does not restrict
 * by identity and relies on Vercel Deployment Protection / Connect to keep the
 * workspace private — set them before using it against real targets.
 */
const connectorUid = process.env.AAMON_SLACK_CONNECTOR ?? "slack/aamon";

const credentials = process.env.SLACK_BOT_TOKEN
  ? { botToken: process.env.SLACK_BOT_TOKEN }
  : connectSlackCredentials(connectorUid);

const idSet = (env: string | undefined) =>
  new Set((env ?? "").split(",").map((s) => s.trim()).filter(Boolean));

const allowedUsers = idSet(process.env.AAMON_SLACK_ALLOWED_USERS);
const allowedConversations = idSet(process.env.AAMON_SLACK_ALLOWED_CONVERSATIONS);

function permitted(userId: string | undefined, channelId: string | undefined): boolean {
  if (allowedUsers.size > 0 && !(userId && allowedUsers.has(userId))) return false;
  if (allowedConversations.size > 0 && !(channelId && allowedConversations.has(channelId))) return false;
  return true;
}

function gate(ctx: Parameters<typeof defaultSlackAuth>[1], message: SlackMessage) {
  if (!permitted(message.author?.userId, message.channelId)) return null;
  return { auth: defaultSlackAuth(message, ctx) };
}

export default slackChannel({
  credentials,
  turnPolicy: "queue",
  onAppMention: (ctx, message) => gate(ctx, message),
  onDirectMessage: (ctx, message) => gate(ctx, message),
  onInputResponse(ctx, submission) {
    // Apply the same allowlist to HITL answers so someone who cannot start a
    // turn cannot resume one by clicking an approval button.
    if (!permitted(submission.user.id, ctx.slack.channelId)) return null;
    return { auth: ctx.defaultAuth };
  },
});
