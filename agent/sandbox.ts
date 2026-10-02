import { DefaultSandbox, defineSandbox } from "eve/sandbox";

/**
 * The engagement sandbox: an isolated /workspace where the agent runs recon and
 * testing tooling and stores engagement artifacts under engagement/.
 *
 * `prepare` runs once per reusable environment artifact and installs the
 * offensive toolkit, so it is baked into the snapshot and ready instantly at
 * run time. It is deliberately best-effort: on an environment without a package
 * manager (e.g. the pure-JS just-bash fallback) it silently skips, so `eve dev`
 * still works. Baking tools does not loosen the rules of engagement — the
 * agent still gates on scope, paces against rate limits, and must not take a
 * target down. The toolkit is web-focused (HTTP/S apps and APIs). Heavy or
 * licensed GUI tools (e.g. Burp Suite Pro) remain human-tester tools.
 */
export const environment = DefaultSandbox.environment({
  prepare: async (sandbox) => {
    // apt-installable tools (Debian/Ubuntu universe).
    const pkgs = [
      "ca-certificates",
      "curl",
      "wget",
      "unzip",
      "dnsutils",
      "netcat-openbsd",
      "nmap",
      "jq",
      "openssl",
      "git",
      "python3",
      "python3-pip",
      "whatweb",
      "nikto",
      "sqlmap",
      "ffuf",
      "gobuster",
      "dirb",
      "hydra",
      "testssl.sh",
      "wafw00f",
      // for `gem install wpscan`
      "ruby",
      "ruby-dev",
      "build-essential",
    ].join(" ");

    // ProjectDiscovery / Go tools published as GitHub release binaries (not in
    // apt). repo -> binary name. Installed into /usr/local/bin.
    const ghBins: Array<[string, string]> = [
      ["projectdiscovery/nuclei", "nuclei"], // templated CVE/exposure scanner (the cve-hunting workhorse)
      ["projectdiscovery/httpx", "httpx"], // fast HTTP probing / tech fingerprinting
      ["projectdiscovery/katana", "katana"], // crawler for content discovery
      ["projectdiscovery/subfinder", "subfinder"], // passive subdomain enumeration (scope-gated)
      ["hahwul/dalfox", "dalfox"], // XSS scanner
      ["projectdiscovery/interactsh", "interactsh-client"], // OOB interaction server (blind SSRF/XXE/RCE/SQLi)
      ["lc/gau", "gau"], // historical/known URLs (wayback, commoncrawl, OTX, URLScan) -> hidden endpoints & params
    ];
    const ghInstall = ghBins
      .map(([repo, bin]) => `install_gh_bin ${repo} ${bin}`)
      .join("\n        ");

    const script = `
      set +e
      SUDO=""
      command -v sudo >/dev/null 2>&1 && SUDO="sudo"

      if command -v apt-get >/dev/null 2>&1; then
        $SUDO apt-get update -y
        $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${pkgs}
      fi

      # Python helpers and web tools. arjun = HTTP parameter discovery (finds hidden params).
      command -v pip3 >/dev/null 2>&1 && pip3 install --quiet --break-system-packages requests arjun 2>/dev/null

      # Install a linux/amd64 binary from a repo's latest GitHub release (zip or tar.gz).
      install_gh_bin() {
        repo="$1"; bin="$2"
        url=$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest" \
              | grep -oE 'https://[^"]*linux[_-](amd64|x86_64)\\.(zip|tar\\.gz)' | head -1)
        [ -z "$url" ] && { echo "no linux_amd64 asset for $repo"; return 0; }
        tmp=$(mktemp -d)
        if curl -fsSL "$url" -o "$tmp/pkg"; then
          case "$url" in
            *.zip) unzip -o -q "$tmp/pkg" -d "$tmp" ;;
            *.tar.gz) tar xzf "$tmp/pkg" -C "$tmp" ;;
          esac
          f=$(find "$tmp" -type f -name "$bin" | head -1)
          [ -n "$f" ] && $SUDO install -m 0755 "$f" /usr/local/bin/ && echo "installed $bin"
        fi
        rm -rf "$tmp"
      }

      if command -v curl >/dev/null 2>&1; then
        ${ghInstall}
      fi

      # Bake Nuclei's templates into the image so runs start current.
      command -v nuclei >/dev/null 2>&1 && nuclei -update-templates 2>/dev/null

      # WordPress scanner (very common target). Best-effort; compiles native gems.
      if command -v gem >/dev/null 2>&1; then
        $SUDO gem install --no-document wpscan 2>/dev/null
      fi

      # Git-based web tools and wordlists under /opt (run as python3 /opt/<tool>/<script>).
      if command -v git >/dev/null 2>&1; then
        $SUDO git clone --depth 1 https://github.com/ticarpi/jwt_tool /opt/jwt_tool 2>/dev/null \
          && command -v pip3 >/dev/null 2>&1 && pip3 install --quiet --break-system-packages -r /opt/jwt_tool/requirements.txt 2>/dev/null
        $SUDO git clone --depth 1 https://github.com/commixproject/commix /opt/commix 2>/dev/null
        # SecLists — the wordlists/payloads a web test actually uses (sparse to keep the image lean).
        if $SUDO git clone --depth 1 --filter=blob:none --sparse https://github.com/danielmiessler/SecLists /opt/SecLists 2>/dev/null; then
          ( cd /opt/SecLists && $SUDO git sparse-checkout set \
              Discovery/Web-Content Fuzzing Usernames Passwords/Common-Credentials Payloads 2>/dev/null )
        fi
      fi

      echo "sandbox prepare complete"
      exit 0
    `;
    await sandbox.run({ command: script });
  },
});

export default defineSandbox(() => environment.open());
