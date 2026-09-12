import { describe, it, expect } from "vitest";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createStoryAgents } from "@/lib/ai/agents";
import { providerStatus, RequestLedger } from "@/lib/ai/model";
import { MainAgent } from "@/lib/orchestration/main-agent";
import { SessionStore } from "@/lib/orchestration/store";
import { NarrativeAgents } from "@/lib/orchestration/agents";
import { NarrativeModelClient } from "@/lib/orchestration/model";
import { fixtureSnapshot } from "./narrative-fixture";
import { createSnapshot, uid } from "@/lib/story/factory";
import { confirmSnapshot } from "@/lib/story/state";
import type { AgentRequest, StorySnapshot, FrameworkResult } from "@/lib/story/contracts";

describe.skipIf(process.env.RUN_REAL_MODEL !== "1")("explicit real model acceptance", () => {
  it("records config, schemas, narrative continuity and review artifacts separately", async () => {
    loadEnvConfig(process.cwd());
    const folder = join(process.cwd(), "runtime", "evaluation", new Date().toISOString().replaceAll(":", "-"));
    await mkdir(folder, { recursive: true });
    const report: Record<string, unknown> = { configured: providerStatus().configured, connectivity: "NOT_RUN", semanticReview: "PENDING: inspect actual prose against docs/REAL_MODEL_ACCEPTANCE.md", scenarios: [] };
    const save = () => writeFile(join(folder, "report.json"), JSON.stringify(report, null, 2));
    if (!providerStatus().configured) { report.blocked = "Missing server model configuration"; await save(); throw Error("请先配置 .env.local；未调用真实模型。"); }
    const ledger = new RequestLedger(join(folder, "ledger.json"));
    const main = new MainAgent(new SessionStore(join(folder, "stories")), new NarrativeAgents(new NarrativeModelClient(ledger)));
    for (const preset of ["eastern_wuxia", "western_fantasy"] as const) {
      const outcome: Record<string, unknown> = { preset, settings: "NOT_RUN", narrative: "NOT_RUN" };
      (report.scenarios as unknown[]).push(outcome);
      let generatedSetup: StorySnapshot | undefined;
      try {
        const settings = createStoryAgents({ ledger });
        const initial = createSnapshot(preset);
        const idea = preset === "eastern_wuxia" ? "东方武侠，年轻旅人林青由用户控制。客栈掌柜沈砚是 NPC。雨夜追查一封旧信，不设超自然力量，不替林青选择。" : "西方魔幻，学徒艾琳由用户控制，守塔人罗恩是 NPC。月夜寻找失踪导师，魔法消耗体力，不能读取他人思想。不替艾琳作关键决定。";
        const request: AgentRequest = { operation_id: uid("eval"), base_revision: initial.snapshot_revision, preset_id: preset, input: idea, context: { story_idea: idea, user_notes: [] }, world: initial.world, characters: initial.characters, recognition: null };
        const reused = process.env.REAL_BASELINE_DIR;
        const world: FrameworkResult = reused ? JSON.parse(await readFile(join(reused, preset + "-world.json"), "utf8")) : await settings.framework(request);
        // Reused worlds carry their own story ID; keep the new paired character document aligned.
        if (reused) { initial.world = world.world; initial.characters.story_id = world.world.story_id; initial.snapshot_revision = world.world.revision; initial.characters.revision = world.world.revision; request.world = world.world; request.characters = initial.characters; request.base_revision = world.world.revision; }
        outcome.worldSchema = reused ? "REUSED_BASELINE" : "PASS"; outcome.baseline = reused ?? null; report.connectivity = "PASS";
        await writeFile(join(folder, preset + "-world.json"), JSON.stringify(world, null, 2));
        const npcs = await settings.npcs({ ...request, operation_id: uid("eval"), world: world.world, recognition: world.recognition, input: "依据总设定生成明确出现的人物。" });
        await writeFile(join(folder, preset + "-npcs.json"), JSON.stringify(npcs, null, 2)); outcome.settings = "PASS";
        initial.input = idea; initial.world = world.world; initial.characters = npcs.characters; initial.recognition = world.recognition; initial.timeline_suggestions = npcs.timeline_suggestions;
        generatedSetup = confirmSnapshot(initial);
      } catch (error) { outcome.settings = "FAIL"; outcome.settingsError = error instanceof Error ? error.message : "unknown"; }
      // Controlled narrative fixture keeps evaluation independent of settings generation failures.
      let snapshot = fixtureSnapshot(); snapshot.preset_id = preset;
      if (preset === "western_fantasy") { snapshot.world.title.value = "月下高塔"; snapshot.world.logline.value = "寻找失踪导师。"; snapshot.characters.characters[0].name.value = "罗恩"; snapshot.characters.characters[1].name.value = "艾琳"; snapshot.input = "西方魔幻，魔法消耗体力，不能读取思想。用户控制艾琳，守塔人罗恩不知道她藏起的信。"; snapshot.world.timeline[0].name.value = "月夜高塔"; }
      if (generatedSetup) snapshot = generatedSetup;
      outcome.narrativeSeed = generatedSetup ? "generated_world_and_characters" : "controlled_fixture";
      try {
        let session = await main.initialize(snapshot); const rounds = [];
        for (const input of ["我走到门口，轻声问候，等待对方回应。", "我询问他昨夜是否见过陌生人，并未打开怀中的信。", "我尝试查看门锁上的痕迹；不预设自己能找到线索。"] ) {
          session = await main.turn({ story_id: snapshot.world.story_id, operation_id: uid("eval"), base_revision: session.revision, input });
          rounds.push({ status: session.runs.at(-1)?.status, time: session.current_time, location: session.current_location });
          if (session.runs.at(-1)?.status !== "succeeded") throw Error("轮次被阻塞；请查看 stories 中的步骤回执。");
        }
        outcome.narrative = "PASS"; outcome.rounds = rounds;
      } catch (error) { outcome.narrative = "FAIL"; outcome.narrativeError = error instanceof Error ? error.message : "unknown"; }
      report.metrics = await ledger.statistics(); await save();
    }
    expect((report.scenarios as { narrative: string; settings: string }[]).every(x => x.narrative === "PASS" && x.settings === "PASS")).toBe(true);
  }, 3_600_000);
});
