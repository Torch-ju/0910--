import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCharacter, createSnapshot, createTimelineEvent, fact } from "@/lib/story/factory";
import { confirmSnapshot } from "@/lib/story/state";
import { MainAgent } from "@/lib/orchestration/main-agent";
import { NarrativeAgents } from "@/lib/orchestration/agents";
import { SessionStore } from "@/lib/orchestration/store";
import { PROMPTS, DIRECT_PROSE_PROMPT, INTERACTIVE_PROSE_PROMPT } from "@/lib/orchestration/prompts";
import type { JsonAgentClient } from "@/lib/orchestration/model";
export function fixtureSnapshot() {
  const value = createSnapshot("eastern_wuxia"); value.input = "江湖客栈，沈砚与林青追查旧信。只控制林青，沈砚不知道信中秘密。";
  value.world.title = fact("雨夜来信"); value.world.logline = fact("两人在客栈追查旧信。");
  value.characters.characters = [createCharacter("沈砚", "npc_shen"), createCharacter("林青", "npc_lin")];
  value.characters.characters[1].controlled_by = "user";
  const opening = createTimelineEvent("雨夜客栈"); opening.period = "opening"; value.world.timeline = [opening];
  return confirmSnapshot(value);
}
export class FixtureModel implements JsonAgentClient {
  fail = ""; calls = 0;
  async generate(_id: string, system: string): Promise<unknown> {
    this.calls++;
    const step = (system === DIRECT_PROSE_PROMPT || system === INTERACTIVE_PROSE_PROMPT) ? "transcription" : Object.entries(PROMPTS).find(([, prompt]) => prompt === system)?.[0] ?? "memory";
    if (step === this.fail) throw Error("test failure");
    if (step === "roles") return { content: "沈砚抬头望向门口，没有作声。" };
    if (step === "narrator") return { current_time: "二更", current_location: "客栈", background: "灯火映着雨声。", visible_events: [] };
    if (step === "transcription") return { ...(system===INTERACTIVE_PROSE_PROMPT ? {dialogue:null} : {}), content: "雨敲着窗。沈砚抬头望向门口，没有作声。林青站在门边，柜台后仍留着一盏灯。", current_time: "二更", current_location: "客栈", new_facts: [], timeline_updates: [], foreshadowing: ["柜台后留下的灯"], chapter_end_hook: "灯影晃动。" };
    if (step === "summary") return { summary: "两人在客栈相遇，旧信尚未拆开。", unresolved_threads: ["旧信的内容"] };
    return { mentions: [], events: [], facts: [], relationships: [], identities: [] };
  }
}
export async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "writing-integration-"));
  const model = new FixtureModel(); const main = new MainAgent(new SessionStore(directory), new NarrativeAgents(model));
  const session = await main.initialize(fixtureSnapshot());
  return { main, model, session, directory, command: { story_id: session.snapshot.world.story_id, operation_id: "op_first", base_revision: 1, input: "我在门边问候沈砚。" } };
}
