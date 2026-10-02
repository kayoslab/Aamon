import type { RuntimeSandboxSession } from "eve/sandbox";

/**
 * Detached long-running scans. A workflow tool can't touch the sandbox
 * (getSandbox is unavailable there), so instead of blocking one function
 * invocation for a whole scan (and hitting Vercel's ~800s limit), we launch the
 * command as a DETACHED process in the sandbox VM and poll it with short tool
 * calls. The scan runs in the sandbox independently of any invocation; a crashed
 * invocation just re-polls. Files live under engagement/.scans/<id>.{cmd,out,rc,pid}.
 */

export const SCANS_DIR = "engagement/.scans";

export function newScanId(): string {
  return `rs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const q = (s: string) => JSON.stringify(s);

/** Launch `command` detached, with a watchdog that kills it after maxSeconds. Returns quickly. */
export async function startScan(
  sandbox: RuntimeSandboxSession,
  id: string,
  command: string,
  maxSeconds: number,
): Promise<void> {
  const cmdF = `${SCANS_DIR}/${id}.cmd`;
  const outF = `${SCANS_DIR}/${id}.out`;
  const rcF = `${SCANS_DIR}/${id}.rc`;
  const pidF = `${SCANS_DIR}/${id}.pid`;
  await sandbox.run({ command: `mkdir -p ${q(SCANS_DIR)}` });
  await sandbox.writeTextFile({ path: cmdF, content: command });
  // setsid => new session/process-group leader (pid == pgid), so the watchdog can
  // kill the whole group. All fds detached so sandbox.run() returns immediately.
  const launch = [
    `cd /workspace`,
    `setsid bash -lc 'bash ${q(cmdF)} > ${q(outF)} 2>&1; echo $? > ${q(rcF)}' </dev/null >/dev/null 2>&1 &`,
    `echo $! > ${q(pidF)}`,
    `pid=$(cat ${q(pidF)})`,
    `setsid bash -lc 'sleep ${Math.floor(maxSeconds)}; if [ ! -f ${q(rcF)} ]; then kill -TERM -'"$pid"' 2>/dev/null; sleep 3; kill -KILL -'"$pid"' 2>/dev/null; echo 124 > ${q(rcF)}; fi' </dev/null >/dev/null 2>&1 &`,
    `echo started`,
  ].join("\n");
  await sandbox.run({ command: launch });
}

export type ScanStatus = {
  finished: boolean;
  running: boolean;
  exitCode: number | null;
  output: string;
};

export async function scanStatus(sandbox: RuntimeSandboxSession, id: string, tailBytes = 6000): Promise<ScanStatus> {
  const rcF = `${SCANS_DIR}/${id}.rc`;
  const outF = `${SCANS_DIR}/${id}.out`;
  const pidF = `${SCANS_DIR}/${id}.pid`;
  const rc = await sandbox.run({ command: `cat ${q(rcF)} 2>/dev/null` });
  const finished = rc.exitCode === 0 && rc.stdout.trim() !== "";
  const out = await sandbox.run({ command: `tail -c ${tailBytes} ${q(outF)} 2>/dev/null` });
  let running = false;
  if (!finished) {
    const alive = await sandbox.run({
      command: `pid=$(cat ${q(pidF)} 2>/dev/null); [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && echo yes || echo no`,
    });
    running = alive.stdout.trim() === "yes";
  }
  return { finished, running, exitCode: finished ? Number(rc.stdout.trim()) : null, output: out.stdout ?? "" };
}

export async function stopScan(sandbox: RuntimeSandboxSession, id: string): Promise<void> {
  const pidF = `${SCANS_DIR}/${id}.pid`;
  const rcF = `${SCANS_DIR}/${id}.rc`;
  await sandbox.run({
    command: `pid=$(cat ${q(pidF)} 2>/dev/null); [ -n "$pid" ] && kill -TERM -"$pid" 2>/dev/null; sleep 1; [ -n "$pid" ] && kill -KILL -"$pid" 2>/dev/null; [ -f ${q(rcF)} ] || echo 143 > ${q(rcF)}; true`,
  });
}
