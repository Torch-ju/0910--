import { describe, expect, it, vi, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { buildContext } from "@/lib/orchestration/context";
import { restoreMemory } from "@/lib/orchestration/memory";
import { reclaimDeadLock } from "@/lib/orchestration/locks";
import { fixture } from "./narrative-fixture";
afterEach(() => vi.unstubAllEnvs());
describe("long history and lock ownership", () => {
  it("fits recent complete fragments within a character budget and keeps full history", async () => {
    const { main, command } = await fixture(); const session = await main.turn(command);
    session.turns = Array.from({ length: 100 }, (_, i) => ({ ...session.turns[0], id: "op_" + i, prose: { ...session.turns[0].prose, content: "长篇正文。".repeat(500) } }));
    const memory = await restoreMemory(session); vi.stubEnv("NARRATIVE_CONTEXT_CHARS", "18000");
    const context = await buildContext(session, "我继续询问沈砚。", memory.repository);
    expect(context.recent.length).toBeLessThan(100); expect(session.turns).toHaveLength(100);
    expect(context.recent.every(p => p.content.length === 2500)).toBe(true);
    vi.stubEnv("NARRATIVE_CONTEXT_CHARS", "bad"); await expect(buildContext(session, "问题", memory.repository)).rejects.toMatchObject({ code: "context_config" });
  });
  it("never reclaims a live owner or an unknown-owner lock", async () => {
    const { directory } = await fixture(); const lock = join(directory, "test.lock"); await mkdir(lock);
    expect(await reclaimDeadLock(lock)).toBe(false);
    await writeFile(join(lock, "owner.json"), JSON.stringify({ host: hostname(), pid: process.pid }));
    expect(await reclaimDeadLock(lock)).toBe(false);
  });
});
