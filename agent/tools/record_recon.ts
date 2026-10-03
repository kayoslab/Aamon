import { defineTool } from "eve/tools";
import { z } from "zod";
import { ensureDirs, logActivity } from "../lib/engagement";
import { RECON_DIR } from "../lib/campaign";

/**
 * Record a slice of the recon picture. Each parallel recon subagent calls this
 * with the endpoints (and components) it discovered; it writes its own slice
 * file so concurrent workers never race, and the campaign's recon gate counts
 * the union of all slices. Available in subagents so fan-out recon can report.
 */
export default defineTool({
  description:
    "Record discovered recon for your slice of the surface: the endpoints/URLs/paths you found and the " +
    "components you fingerprinted. Each call writes its own file, so parallel recon workers don't collide. " +
    "The campaign cannot leave the recon phase until enough distinct endpoints are recorded across all slices.",
  availableInSubagents: true,
  inputSchema: z.object({
    slice: z.string().describe("Short label for this recon slice/owner, e.g. 'subdomains', 'api', 'www-crawl'."),
    endpoints: z.array(z.string()).default([]).describe("Discovered endpoints/URLs/paths (one per entry)."),
    components: z.array(z.string()).default([]).describe("Fingerprinted components with versions, e.g. 'WordPress 6.4.2', 'nginx 1.25'."),
    notes: z.string().default("").describe("Anything notable: auth surfaces, parameters, interesting responses, leads."),
  }),
  label: { start: ({ slice, endpoints }) => `Recon: ${slice} (+${endpoints.length} endpoints)` },
  async execute({ slice, endpoints, components, notes }, ctx) {
    const sandbox = await ctx.getSandbox();
    await ensureDirs(sandbox);
    await sandbox.run({ command: `mkdir -p ${JSON.stringify(RECON_DIR)}` });
    const safe = slice.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40) || "slice";
    const id = `${safe}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const uniq = [...new Set(endpoints.map((e) => e.trim()).filter(Boolean))];
    await sandbox.writeTextFile({ path: `${RECON_DIR}/${id}.txt`, content: uniq.join("\n") + (uniq.length ? "\n" : "") });
    const md = [
      `# Recon slice: ${slice}`,
      `Recorded: ${new Date().toISOString()}`,
      ``,
      `## Endpoints (${uniq.length})`,
      uniq.map((e) => `- ${e}`).join("\n") || "_(none)_",
      ``,
      `## Components (${components.length})`,
      components.map((c) => `- ${c}`).join("\n") || "_(none)_",
      notes ? `\n## Notes\n${notes}` : ``,
    ]
      .filter((l) => l !== ``)
      .join("\n");
    await sandbox.writeTextFile({ path: `${RECON_DIR}/${id}.md`, content: md });
    await logActivity(sandbox, `recon recorded: ${slice} (+${uniq.length} endpoints, ${components.length} components)`);
    return { recorded: true, slice, endpointsAdded: uniq.length, components: components.length, path: `${RECON_DIR}/${id}.md` };
  },
});
