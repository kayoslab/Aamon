import { defineSchedule } from "eve/schedules";
import slack from "../channels/slack";

/**
 * Campaign heartbeat — the scheduled backstop for a long campaign.
 *
 * A campaign's real carrier is its long durable session: the session-owned
 * sandbox persists across turns and deployments, so detached scans and state
 * survive for days. This heartbeat exists to RESUME that session if its turn has
 * parked (e.g. the model stopped after launching hours-long scans). It must
 * reach the campaign's OWN session — a fresh schedule session gets a fresh
 * sandbox and could not see the campaign — so it resumes the campaign's Slack
 * thread by (channelId, threadTs). Sending to an existing thread continues the
 * same session on the same sandbox.
 *
 * It is a safe no-op until you point it at a running campaign: set
 * AAMON_CAMPAIGN_CHANNEL_ID and AAMON_CAMPAIGN_THREAD_TS to the campaign's Slack
 * thread (then redeploy). Unset, it spawns nothing and costs nothing.
 */
export default defineSchedule({
  cron: "*/30 * * * *", // every 30 minutes (UTC on Vercel)
  async run({ to, waitUntil, appAuth }) {
    const channelId = process.env.AAMON_CAMPAIGN_CHANNEL_ID;
    const threadTs = process.env.AAMON_CAMPAIGN_THREAD_TS;
    if (!channelId || !threadTs) return; // no campaign to resume → do nothing

    waitUntil(
      to(slack, { channelId, threadTs }).send(
        "[campaign heartbeat] Keep the campaign moving. Poll any detached scans with scan_poll; when the " +
          "current phase's gate is satisfied, advance_phase; keep working the plan and exploiting leads toward " +
          "control. If the campaign is complete, call finalize_engagement. If there is nothing to do right now " +
          "(scans still running), say so briefly and end — the next heartbeat will check again.",
        { auth: appAuth },
      ),
    );
  },
});
