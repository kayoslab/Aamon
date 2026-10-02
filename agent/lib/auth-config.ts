import {
  withAuthChallenges,
  verifyHttpBasic,
  type AuthFn,
} from "eve/channels/auth";

/**
 * Operator access for the human testing team.
 *
 * Credentials come from the `AAMON_OPERATORS` env var as a comma-separated list
 * of `user:password` pairs, e.g. `alice:s3cret,bob:hunter2`. This keeps secrets
 * out of source and lets you add/remove testers without a code change. If the
 * var is unset the authenticator matches nobody, so production fails closed
 * (every request falls through to a 401) — set it before deploying.
 *
 * This is layered UNDER Vercel Deployment Protection: the platform keeps the
 * public internet out, and this identifies which tester is acting.
 */
export function operatorBasicAuth(): AuthFn<Request> {
  const pairs = (process.env.AAMON_OPERATORS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(":");
      return idx === -1
        ? null
        : { username: entry.slice(0, idx), password: entry.slice(idx + 1) };
    })
    .filter((c): c is { username: string; password: string } => c !== null);

  return withAuthChallenges<Request>(
    (request) => {
      const header = request.headers.get("authorization");
      for (const cred of pairs) {
        const result = verifyHttpBasic(header, cred);
        if (result.ok) return result.sessionAuth;
      }
      return null; // skip -> next entry, ultimately 401
    },
    [{ scheme: "Basic", parameters: { realm: "aamon" } }],
  );
}
