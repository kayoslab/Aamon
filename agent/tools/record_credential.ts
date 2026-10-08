import { defineTool } from "eve/tools";
import { logActivity } from "../lib/engagement";
import { CredentialInput, appendCredential } from "../lib/credentials";

/**
 * Record a captured credential in the central store (engagement/credentials.jsonl).
 *
 * Call this the MOMENT you obtain any secret — a password, hash, token, key, or
 * cookie — from anywhere (a config file, a crack, a dump, a reused login). The
 * store is shared across the whole engagement, so every other worker can then
 * try it, and it is the trigger to re-examine the attack surface for other
 * hosts/services/logins where the same credential might work (credential reuse
 * is the primary lateral-movement and access-expansion vector).
 *
 * Available to every agent (root and dispatched workers); the append is atomic,
 * so parallel workers can record credentials without clobbering the store.
 */
export default defineTool({
  description:
    "Record a captured credential (password/hash/token/ssh-key/api-key/cookie) in the central, engagement-wide " +
    "store the moment you obtain it. Include where it works (realm) and where it came from (source). Every worker " +
    "reads this store; recording a credential is the trigger to try it against every other host/service/login in " +
    "recon. Call it immediately on any credential capture.",
  availableInSubagents: true,
  inputSchema: CredentialInput,
  label: { start: (c) => `Record credential: ${c.username ? c.username + "@" : ""}${c.realm} (${c.kind})` },
  async execute(input, ctx) {
    const sandbox = await ctx.getSandbox();
    const cred = await appendCredential(sandbox, input);
    await logActivity(sandbox, `credential recorded ${cred.id}: ${cred.kind} ${cred.username || ""}@${cred.realm}`);
    return {
      recorded: true,
      id: cred.id,
      path: "engagement/credentials.jsonl",
      reuse:
        "Now REUSE it: try this credential against every other host, service, and login in recon (SSH, SMB/WinRM, " +
        "RDP, databases, web admin panels, APIs, the same app's other roles). As orchestrator, open credential-reuse " +
        "areas (open_area) for the endpoints where it might work, and re-check recon for logins you have not tried yet. " +
        "Credential reuse is how a single foothold becomes control of the network.",
    };
  },
});
