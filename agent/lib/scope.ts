/**
 * Scope matching for engagement targets.
 *
 * A pentest's single most important safety control is staying inside the
 * authorized scope. This module is dependency-free and pure so it can be unit
 * reasoned about and reused from any tool. It understands four pattern kinds:
 *
 *   - IPv4 address           e.g. 203.0.113.10
 *   - IPv4 CIDR block        e.g. 203.0.113.0/24
 *   - hostname / domain      e.g. app.example.com  (matches itself + subdomains)
 *   - wildcard domain        e.g. *.example.com    (subdomains only)
 *   - URL                    e.g. https://app.example.com/login (host is used)
 *
 * IPv6 and anything unrecognized falls back to case-insensitive exact string
 * comparison, which is conservative (it will not over-match).
 */

export type ScopeDecision = {
  allowed: boolean;
  target: string;
  normalizedHost: string;
  reason: string;
  matched?: string;
};

export type Scope = {
  inScope: string[];
  outOfScope: string[];
};

/** Extract the comparable host/IP from a raw target string. */
export function normalizeTarget(raw: string): string {
  const t = raw.trim();
  if (t === "") return t;
  // If it looks like a URL, pull out the hostname.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
    try {
      return new URL(t).hostname.toLowerCase();
    } catch {
      /* fall through */
    }
  }
  // host:port -> host (but leave bare IPv6 alone)
  const hostPort = t.match(/^([^/:]+):\d+$/);
  if (hostPort) return hostPort[1].toLowerCase();
  return t.toLowerCase();
}

function isIpv4(s: string): boolean {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  return m.slice(1).every((o) => Number(o) <= 255);
}

function ipv4ToInt(s: string): number {
  return s.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

function cidrMatch(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  if (!isIpv4(ip) || !isIpv4(range) || Number.isNaN(bits) || bits < 0 || bits > 32) {
    return false;
  }
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
}

function hostMatch(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith("*.")) {
    const base = p.slice(2);
    return h.endsWith("." + base);
  }
  // A bare domain matches itself and any subdomain.
  return h === p || h.endsWith("." + p);
}

/** Does a normalized target match a single scope pattern? */
export function matchesPattern(target: string, pattern: string): boolean {
  const host = normalizeTarget(target);
  const pat = normalizeTarget(pattern);
  if (pat === "") return false;
  if (pat.includes("/") && isIpv4(pat.split("/")[0])) return cidrMatch(host, pat);
  if (isIpv4(pat)) return host === pat;
  if (/[a-z]/i.test(pat)) return hostMatch(host, pat);
  return host === pat;
}

/**
 * Evaluate a target against the engagement scope. Out-of-scope always wins over
 * in-scope. A target that matches nothing is treated as NOT authorized.
 */
export function evaluateScope(rawTarget: string, scope: Scope): ScopeDecision {
  const normalizedHost = normalizeTarget(rawTarget);
  if (normalizedHost === "") {
    return { allowed: false, target: rawTarget, normalizedHost, reason: "Empty target." };
  }

  const blocked = scope.outOfScope.find((p) => matchesPattern(normalizedHost, p));
  if (blocked) {
    return {
      allowed: false,
      target: rawTarget,
      normalizedHost,
      matched: blocked,
      reason: `Target matches an explicit OUT-OF-SCOPE rule (${blocked}). Do not test it.`,
    };
  }

  const allowed = scope.inScope.find((p) => matchesPattern(normalizedHost, p));
  if (allowed) {
    return {
      allowed: true,
      target: rawTarget,
      normalizedHost,
      matched: allowed,
      reason: `Target is authorized by in-scope rule (${allowed}).`,
    };
  }

  return {
    allowed: false,
    target: rawTarget,
    normalizedHost,
    reason:
      "Target matches no in-scope rule. Treat as OUT OF SCOPE and do not test it without written authorization.",
  };
}
