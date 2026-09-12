import { describe, it, expect } from "vitest";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MainAgent } from "@/lib/orchestration/main-agent";
import { SessionStore } from "@/lib/orchestration/store";
import { NarrativeAgents } from "@/lib/orchestration/agents";
import { NarrativeModelClient } from "@/lib/orchestration/model";
import { RequestLedger } from "@/lib/ai/model";
import { uid } from "@/lib/story/factory";

describe.skipIf(process.env.RUN_REAL_RECOVERY !== "1")("explicit targeted real recovery", () => {
  it("resumes only blocked steps and completes three turns without discarding previous results", async () => {
    const folder = process.env.REAL_EVALUATION_DIR; if (!folder) throw Error("REAL_EVALUATION_DIR required");
    const stamp = new Date().toISOString().replaceAll(":", "-");
    const ledger = new RequestLedger(join(folder, "recovery-" + stamp + "-ledger.json"));
    const main = new MainAgent(new SessionStore(join(folder, "stories")), new NarrativeAgents(new NarrativeModelClient(ledger)));
    const reports: unknown[] = [];
    const inputs = ["我走到门口，轻声问候，等待对方回应。", "我询问他昨夜是否见过陌生人，并未打开怀中的信。", "我尝试查看门锁上的痕迹；不预设自己能找到线索。"];
    for (const file of (await readdir(join(folder, "stories"))).filter(x => x.endsWith(".json"))) {
      const id = file.slice(0,-5); if (process.env.REAL_STORY_ID && process.env.REAL_STORY_ID !== id) continue;
      let session = await main.status(id); const before = session.turns.length;
      const blocked = session.runs.find(r => r.status === "blocked");
      if (blocked) session = await main.turn({ story_id: id, operation_id: blocked.operation_id, base_revision: blocked.base_revision, input: blocked.input, close_chapter: blocked.close_chapter, retry_failed: true });
      while (session.turns.length < 3 && !session.runs.some(r => ["running", "blocked"].includes(r.status))) {
        session = await main.turn({ story_id: id, operation_id: uid("eval"), base_revision: session.revision, input: inputs[session.turns.length] });
      }
      reports.push({ story_id: id, preset: session.snapshot.preset_id, before, turns: session.turns.length, status: session.runs.at(-1)?.status, error: session.runs.at(-1)?.error, scene: { time: session.current_time, location: session.current_location } });
      await writeFile(join(folder, "recovery-" + stamp + "-report.json"), JSON.stringify({ reports, metrics: await ledger.statistics() }, null, 2));
    }
    expect(reports.length).toBeGreaterThan(0);
    expect((reports as { turns: number }[]).every(r => r.turns >= 3)).toBe(true);
  }, 3_600_000);
});
