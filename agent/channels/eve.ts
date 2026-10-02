import { eveChannel } from "eve/channels/eve";
import { localDev, vercelOidc } from "eve/channels/auth";
import { operatorBasicAuth } from "../lib/auth-config";

/**
 * Route auth for the default HTTP session API. eve fails closed: in production
 * every request is rejected unless one of these accepts it. The walk runs in
 * order and stops at the first match.
 *
 * Layers of access control for this agent:
 *   1. Vercel Deployment Protection (configure in the Vercel dashboard) keeps
 *      the public internet out at the platform edge — restrict to your team via
 *      Vercel Authentication / SSO, and add a Protection Bypass token or Trusted
 *      IPs for the intake automation.
 *   2. These authenticators identify who is acting:
 *      - vercelOidc(): internal subagent/runtime callers and your own Vercel
 *        project's tokens. To also restrict human Vercel-OIDC callers to your
 *        team, pass subjects: [vercelSubject({ teamSlug, projectName: "aamon" })].
 *      - operatorBasicAuth(): the human testing team (AAMON_OPERATORS env).
 *      - localDev(): local `eve dev` only; authenticates nothing in production.
 */
export default eveChannel({
  auth: [vercelOidc(), operatorBasicAuth(), localDev()],
});
