import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { StoryManager } from "@/lib/orchestration/manage";
import { MainAgent } from "@/lib/orchestration/main-agent";
import { SessionStore } from "@/lib/orchestration/store";
import { restoreMemory } from "@/lib/orchestration/memory";
import { NarrativeTasks } from "@/lib/orchestration/tasks";
import { fixture } from "./narrative-fixture";

describe("writing management", () => {
  it("closes a chapter independently without models and replays the same management operation", async () => {
    const { main, command, model } = await fixture(); const story = await main.turn(command);
    const manager = new StoryManager(main), action = { action: "close_chapter" as const, story_id: command.story_id, operation_id: "op_close", base_revision: story.revision };
    const closed = await manager.manage(action); expect(closed.chapters[0].content).toBe(story.turns[0].prose.content);
    expect((await manager.manage(action)).chapters).toHaveLength(1); expect(model.calls).toBe(3);
    await expect(manager.manage({ ...action, operation_id: "op_other" })).rejects.toMatchObject({ code: "revision_conflict" });
  });
  it("abandons a failed turn with an audit trail and allows new prose", async () => {
    const { main, command, model } = await fixture(); model.fail = "summary"; await main.turn(command);
    const manager = new StoryManager(main);
    const abandoned = await manager.manage({ action: "abandon", story_id: command.story_id, operation_id: "op_abandon", base_revision: 1, run_id: command.operation_id });
    expect(abandoned.runs[0].input).toBe(command.input); expect(abandoned.audit).toHaveLength(1);
    model.fail = ""; const next = await main.turn({ ...command, operation_id: "op_new_turn", base_revision: abandoned.revision }); expect(next.turns).toHaveLength(1);
    await expect(main.turn(command)).rejects.toMatchObject({ code: "run_abandoned" });
  });
  it("replays memory checkpoints equivalently and retains identity fixes after restart", async () => {
    const { main, command } = await fixture(); let session = await main.turn(command);
    const full = structuredClone(session); delete full.memory_checkpoint;
    expect((await restoreMemory(session)).repository.exportCheckpoint()).toEqual((await restoreMemory(full)).repository.exportCheckpoint());
    const manager = new StoryManager(main);
    session = await manager.manage({ action: "memory", story_id: command.story_id, operation_id: "op_merge", base_revision: session.revision, command: { kind: "merge", source: "npc_shen", target: "npc_lin", reason: "合成测试确认", confirmed: true } });
    expect((await restoreMemory(session)).repository.snapshot().characters.find(c => c.characterId === "npc_shen")?.status).toBe("merged");
    session = await manager.manage({ action: "memory", story_id: command.story_id, operation_id: "op_split", base_revision: session.revision, command: { kind: "split", source: "npc_shen", target: "npc_lin", reason: "先前合并有误", confirmed: true, assignments: { factIds: [], aliasIds: [], eventIds: [], relationshipEndpoints: [] } } });
    delete session.memory_checkpoint;
    const restored = await restoreMemory(session);
    expect((await restored.repository.getCharacter("npc_shen"))?.status).toBe("active");
    expect(await restored.repository.getMemoryVersion(command.story_id)).toBe(3);
    await main.store.save(session);
    session = await main.turn({ ...command, operation_id: "op_after_split", base_revision: session.revision });
    expect(session.turns.at(-1)?.memory.memoryVersion).toBe(4);
  });
  it("round trips complete backups without overwriting and rejects tampering", async () => {
    const { main, command, directory } = await fixture(); await main.turn(command);
    const manager = new StoryManager(main); const backup = await manager.backup(command.story_id);
    const target = new StoryManager(new MainAgent(new SessionStore(join(directory, "restore"))));
    const imported = await target.restore(backup); expect(imported.turns).toHaveLength(1);
    await expect(target.restore(backup)).rejects.toMatchObject({ code: "story_exists" });
    backup.session.turns[0].prose.content = "篡改";
    await expect(target.restore(backup)).rejects.toMatchObject({ code: "backup_checksum" });
    backup.checksum = createHash("sha256").update(JSON.stringify(backup.session)).digest("hex");
    await expect(target.restore(backup)).rejects.toMatchObject({ code: "invalid_backup" });
  });
  it("synchronizes confirmed newer settings, keeping original prose and versioned diff", async () => {
    const { main, command } = await fixture(); const initial = await main.turn(command);
    const snapshot = structuredClone(initial.snapshot); snapshot.snapshot_revision++; snapshot.world.revision++; snapshot.characters.revision++; snapshot.world.title.value = "更名后的作品";
    const result = await new StoryManager(main).manage({ action: "sync", story_id: command.story_id, operation_id: "op_sync", base_revision: initial.revision, snapshot, confirmed: true });
    expect(result.turns).toEqual(initial.turns); expect(result.seed_snapshot).toEqual(initial.snapshot); expect(result.audit![0].action).toBe("sync");
  });
  it("shows corrupt files as unavailable without breaking the library", async () => {
    const { main, directory } = await fixture(); await writeFile(join(directory, "story_broken.json"), "bad");
    const list = await new StoryManager(main).list(); expect(list).toHaveLength(2); expect(list.filter(s => s.error)).toHaveLength(1);
  });
  it("persists asynchronous tasks and never duplicates completed calls", async () => {
    const { main, command, model, directory } = await fixture(); const tasks = new NarrativeTasks(main);
    const { task } = await tasks.create("task_first", command); expect((await tasks.get(task.task_id)).status).toBe("queued");
    await tasks.execute(task); expect((await tasks.get(task.task_id)).status).toBe("done");
    expect((await tasks.create("task_first", command)).created).toBe(false); expect(model.calls).toBe(3);
    await mkdir(join(directory, "tasks"), { recursive: true });
    await writeFile(join(directory, "tasks", "task_orphan.json"), JSON.stringify({ ...task, task_id: "task_orphan", status: "running" }));
    expect((await tasks.get("task_orphan")).status).toBe("interrupted");
  });
});

describe("interruption boundaries", () => {
  it("backs up an initialized story before any narrative exists", async () => {
    const { main, directory, command } = await fixture();
    const source = new StoryManager(main), target = new StoryManager(new MainAgent(new SessionStore(join(directory, "blank-restore"))));
    expect((await target.restore(await source.backup(command.story_id))).turns).toHaveLength(0);
  });
  it("cancels between child calls while retaining the original input", async () => {
    const { main, command, model } = await fixture(); let checks = 0;
    const session = await main.turn(command, { shouldCancel: async () => ++checks > 3 });
    expect(model.calls).toBe(1); expect(session.runs[0].status).toBe("blocked"); expect(session.runs[0].steps.roles?.status).toBe("done");
    expect(session.runs[0].error).toContain("停止");
    const done = await main.turn({ ...command, retry_failed: true }); expect(done.turns).toHaveLength(1); expect(model.calls).toBe(3);
  });
  it("handles a cancelled queued background task without model calls", async () => {
    const { main, command, model } = await fixture(); const tasks = new NarrativeTasks(main);
    const { task } = await tasks.create("task_cancel", command); await tasks.cancel(task.task_id); await tasks.execute(task);
    expect((await tasks.get(task.task_id)).status).toBe("cancelled"); expect(model.calls).toBe(0);
  });
});

it("resolves a fact conflict explicitly, retaining original evidence and replaying the correction", async () => {
  const { main, command } = await fixture(); const session = await main.status(command.story_id);
  for (const [index, value] of ["北城", "南城"].entries()) {
    const text = "沈砚出生在" + value + "。", turnId = "op_fact_" + index;
    const evidence = { sourceKind: "narration" as const, quote: text, segmentId: "prose", confidence: 1 };
    session.memory_journal.push({ created_at: new Date().toISOString(), input: { storyId: command.story_id, requestId: turnId, turnId, chapterNo: 1, sceneNo: index + 1, previousMemoryVersion: index, narrative: { text, segments: [{ segmentId: "prose", kind: "narration", text, order: 0 }] } }, extraction: { mentions: [{ ref: "shen", displayName: "沈砚", characterIdHint: "npc_shen", evidence }], facts: [{ subjectRef: "shen", key: "birthplace", value, inference: false, temporal: "static", evidence }], events: [], identities: [], relationships: [] } });
  }
  const memory = await restoreMemory(session), state = memory.repository.snapshot();
  expect(state.conflicts).toHaveLength(1);
  const action = { kind: "resolve_fact" as const, conflict_id: state.conflicts[0].conflictId, fact_id: state.facts[1].factId, reason: "作者明确确认南城", confirmed: true as const };
  await memory.maintain(action, "op_resolve", "2026-09-12T12:00:00.000Z");
  const facts = memory.repository.snapshot().facts;
  expect(facts.filter(f => f.status === "active").map(f => f.value)).toEqual(["南城"]);
  expect(facts[0].evidence.sourceKind).toBe("narration"); expect(facts.at(-1)?.evidence.sourceKind).toBe("user_confirmation");
  session.memory_actions = [{ after_turn: 2, command: action, operation_id: "op_resolve", created_at: "2026-09-12T12:00:00.000Z" }];
  const replay = await restoreMemory(session);
  expect(replay.repository.snapshot().conflicts[0].status).toBe("resolved");
  expect(replay.repository.snapshot().facts).toEqual(facts);
});
