import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
/** Only reclaim locks whose recorded owner on this host is definitely dead. Unknown owners remain protected. */
export async function reclaimDeadLock(lock: string): Promise<boolean> {
  const recovery = lock + ".recovery";
  try { await mkdir(recovery); } catch { return false; }
  try {
    const owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8"));
    if (owner.host !== hostname() || !Number.isInteger(owner.pid) || owner.pid < 1) return false;
    try { process.kill(owner.pid, 0); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false; }
    await rm(lock, { recursive: true }); return true;
  } catch { return false; }
  finally { await rm(recovery, { recursive: true, force: true }); }
}
export async function recordLockOwner(lock: string) {
  await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, host: hostname(), created_at: new Date().toISOString() }), { mode: 0o600 });
}
