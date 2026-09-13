import { reclaimDeadLock, recordLockOwner } from "./locks";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isStableOperationId } from "@/lib/ai/model";
import { OrchestrationError, type StorySession } from "./contracts";

export function assertId(id: string): void {
  if (typeof id !== "string" || !isStableOperationId(id)) throw new OrchestrationError("invalid_id", "故事或操作 ID 无效。", 400);
}
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** One atomic envelope per story. mkdir also excludes concurrent writers in other processes. */
export class SessionStore {
  constructor(readonly directory = process.env.STORY_DATA_DIR ?? resolve(process.cwd(), "runtime", "stories")) {}
  async exclusive<T>(storyId: string, work: () => Promise<T>): Promise<T> {
    assertId(storyId);
    await mkdir(this.directory, { recursive: true });
    const lock = join(this.directory, storyId + ".lock");
    try { await mkdir(lock); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!await reclaimDeadLock(lock)) throw new OrchestrationError("story_busy", "故事正在处理或锁的归属无法确认。请查询任务；未知归属锁需停服检查。");
      try { await mkdir(lock); } catch { throw new OrchestrationError("story_busy", "另一任务已取得故事锁，请查询最新状态。"); }
    }
    try { await recordLockOwner(lock); return await work(); } finally { await rm(lock, { recursive: true, force: true }); }
  }
  async load(storyId: string): Promise<StorySession | null> {
    assertId(storyId);
    let raw: string;
    try { raw = await readFile(join(this.directory, storyId + ".json"), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    try {
      const envelope = JSON.parse(raw);
      if (typeof envelope.payload !== "string" || digest(envelope.payload) !== envelope.checksum) throw Error("checksum");
      const session = JSON.parse(envelope.payload) as StorySession;
      if (session.version !== 1 || session.snapshot.world.story_id !== storyId || !Array.isArray(session.runs)) throw Error("version");
      return session;
    } catch { throw new OrchestrationError("storage_corrupt", "故事文件损坏或版本不兼容，已停止覆盖。", 503); }
  }
  async save(session: StorySession): Promise<void> {
    const id = session.snapshot.world.story_id;
    assertId(id);
    await mkdir(this.directory, { recursive: true });
    const target = join(this.directory, id + ".json");
    const temporary = target + "." + randomUUID() + ".tmp";
    const payload = JSON.stringify(session);
    try {
      await writeFile(temporary, JSON.stringify({ checksum: digest(payload), payload }), { mode: 0o600 });
      // Windows can refuse rename while another handle (a poll read) holds the target open; retry briefly.
      for (let attempt = 0; ; attempt++) {
        try { await rename(temporary, target); break; }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code ?? "";
          if (attempt >= 4 || !["EPERM", "EBUSY", "ENOTEMPTY", "EACCES"].includes(code)) { await rm(temporary, { force: true }); throw error; }
          await new Promise(resolve => setTimeout(resolve, 30 * (attempt + 1)));
        }
      }
    } finally { await rm(temporary, { force: true }); }
  }
}
