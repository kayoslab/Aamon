import { z } from "zod";
import type { RuntimeSandboxSession } from "eve/sandbox";
import { ROOT, ensureDirs, readTextOrNull } from "./engagement";

/**
 * The central credential store — captured secrets and where they work.
 *
 * Credential reuse is the primary lateral-movement and access-expansion vector:
 * the moment any agent obtains a password, hash, token, key, or cookie it must be
 * recorded here so (a) it is not lost, (b) every other worker in the engagement
 * can try it, and (c) it triggers a re-check of the whole attack surface for
 * other hosts/services/logins where the same credential might work.
 *
 * Stored as engagement/credentials.jsonl (source of truth, appended atomically so
 * parallel workers never clobber it) and rendered to engagement/credentials.md.
 * The store lives in the shared sandbox, so it is engagement-wide — not persisted
 * across engagements (that is deliberate: the sandbox is ephemeral).
 */

export const CREDS_INDEX = `${ROOT}/credentials.jsonl`;
export const CREDS_MD = `${ROOT}/credentials.md`;

export const CredentialInput = z.object({
  kind: z
    .enum(["password", "hash", "token", "ssh-key", "api-key", "cookie", "other"])
    .describe("What kind of secret this is."),
  username: z.string().default("").describe("Associated username/principal/account, if any."),
  secret: z.string().describe("The credential value (password, hash, token, key material, cookie, …)."),
  realm: z
    .string()
    .describe("What it is for / where it is known to work, e.g. 'SSH on 10.0.0.75', 'WordPress admin', 'domain ACME'."),
  source: z.string().describe("Where it came from: the host/service/finding and how it was obtained."),
  privilege: z
    .enum(["unknown", "user", "admin", "root", "domain-admin"])
    .default("unknown")
    .describe("Privilege level this credential grants, if known."),
  status: z
    .enum(["unverified", "valid", "invalid", "reused"])
    .default("unverified")
    .describe("unverified until tested; valid once it authenticates; reused once tried elsewhere."),
  note: z.string().default("").describe("Anything else: where it has already been tried, scope of validity, caveats."),
});
export type CredentialInput = z.infer<typeof CredentialInput>;
export type Credential = CredentialInput & { id: string; at: string };

export async function readCredentials(sandbox: RuntimeSandboxSession): Promise<Credential[]> {
  const raw = await readTextOrNull(sandbox, CREDS_INDEX);
  if (!raw) return [];
  const out: Credential[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      out.push(JSON.parse(line) as Credential);
    } catch {
      // skip a malformed/partial line rather than crashing the read
    }
  }
  return out;
}

/**
 * Append one credential to the central store. Uses the atomic temp-file + `cat >>`
 * append (same technique as the audit hook) so parallel workers recording
 * credentials at the same time never clobber each other.
 */
export async function appendCredential(sandbox: RuntimeSandboxSession, input: CredentialInput): Promise<Credential> {
  await ensureDirs(sandbox);
  const cred: Credential = {
    ...input,
    username: input.username ?? "",
    privilege: input.privilege ?? "unknown",
    status: input.status ?? "unverified",
    note: input.note ?? "",
    id: `C-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
  };
  const tmp = `${ROOT}/.cred-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.tmp`;
  await sandbox.writeTextFile({ path: tmp, content: JSON.stringify(cred) + "\n" });
  await sandbox.run({ command: `cat ${JSON.stringify(tmp)} >> ${JSON.stringify(CREDS_INDEX)} && rm -f ${JSON.stringify(tmp)}` });
  // Best-effort human view; the jsonl above is the source of truth.
  try {
    await sandbox.writeTextFile({ path: CREDS_MD, content: renderCredentialsMd(await readCredentials(sandbox)) });
  } catch {
    /* ignore */
  }
  return cred;
}

export function renderCredentialsMd(creds: Credential[]): string {
  const rows = creds
    .map(
      (c) =>
        `| ${c.id} | ${c.kind} | ${c.username || "—"} | ${c.privilege} | ${c.status} | ${c.realm} | ${c.source} |`,
    )
    .join("\n");
  return [
    `# Captured credentials (${creds.length})`,
    `Updated: ${new Date().toISOString()}`,
    ``,
    `Secrets themselves are in credentials.jsonl. Try every credential against every other host/service/login`,
    `in recon — credential reuse is the main lateral-movement path.`,
    ``,
    `| id | kind | username | privilege | status | realm (where it works) | source |`,
    `|---|---|---|---|---|---|---|`,
    rows || "| — | — | — | — | — | — | — |",
  ].join("\n");
}
