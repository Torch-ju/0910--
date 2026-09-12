import { z } from "zod";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { MainAgent } from "./main-agent";
import { assertId } from "./store";
import { OrchestrationError, type TurnCommand } from "./contracts";
export type NarrativeTask = { task_id: string; command: TurnCommand; status: "queued" | "running" | "done" | "interrupted" | "cancelled"; error?: string; created_at: string };
const scope = globalThis as typeof globalThis & { narrativeTasks?: Set<string> };
const active = scope.narrativeTasks ??= new Set();
export class NarrativeTasks {
  constructor(readonly main = new MainAgent()) {}
  private get directory() { return join(this.main.store.directory, "tasks"); }
  private async save(task: NarrativeTask) {
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, task.task_id + ".json"), temp = path + "." + randomUUID() + ".tmp";
    await writeFile(temp, JSON.stringify(task), { mode: 0o600 }); await rename(temp, path);
  }
  async get(id: string): Promise<NarrativeTask> {
    assertId(id);
    let task: NarrativeTask;
    try { task = JSON.parse(await readFile(join(this.directory, id + ".json"), "utf8")); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new OrchestrationError("task_not_found", "任务不存在。", 404); throw e; }
    if (["queued", "running"].includes(task.status) && !active.has(id)) return { ...task, status: "interrupted", error: "服务重启或任务中断，请读取故事检查点后明确恢复。" };
    return task;
  }
  async create(id: string, command: TurnCommand) {
    command = z.object({ dialogue_action:z.enum(["reply","finish"]).optional(), dialogue_id:z.string().optional(), dialogue_revision:z.number().int().positive().optional(), reply_to: z.string().min(1).max(96).optional(), story_id: z.string(), operation_id: z.string(), base_revision: z.number().int().positive(), input: z.string().min(1).max(12000), close_chapter: z.boolean().optional(), retry_failed: z.boolean().optional() }).strict().parse(command);
    assertId(id); assertId(command.story_id); assertId(command.operation_id);
    if (!command.input?.trim() || command.input.length > 12000 || !Number.isInteger(command.base_revision)) throw new OrchestrationError("invalid_request", "请输入有效剧情与版本。", 400);
    return this.main.store.exclusive("task_" + id.slice(-80), async () => {
      try {
        const old = await this.get(id);
        if (JSON.stringify(old.command) !== JSON.stringify(command)) throw new OrchestrationError("idempotency_conflict", "任务 ID 已用于另一请求。");
        return { task: old, created: false };
      } catch (e) { if (!(e instanceof OrchestrationError) || e.code !== "task_not_found") throw e; }
      const session = await this.main.status(command.story_id);
      if (session.revision !== command.base_revision) throw new OrchestrationError("revision_conflict", "请先刷新故事。");
      const task: NarrativeTask = { task_id: id, command, status: "queued", created_at: new Date().toISOString() };
      await this.save(task); active.add(id);
      return { task, created: true };
    });
  }
  async cancel(id: string) {
    const task = await this.get(id);
    if (!["queued", "running"].includes(task.status)) return task;
    await writeFile(join(this.directory, id + ".cancel"), "cancel", { mode: 0o600 });
    return { ...task, error: "已请求停止：正在进行的模型调用会先保存结果，然后停止后续步骤。" };
  }
  async execute(task: NarrativeTask) {
    try {
      task.status = "running"; await this.save(task);
      const cancelled = async () => { try { await readFile(join(this.directory, task.task_id + ".cancel")); return true; } catch { return false; } };
      const result = await this.main.turn(task.command, { shouldCancel: cancelled });
      task.status = "done";
      const run = result.runs.find(run => run.operation_id === task.command.operation_id);
      const exchange=result.conversations?.flatMap(c=>c.exchanges).find(e=>e.command.operation_id===task.command.operation_id);
      if (!(["succeeded","waiting_dialogue"].includes(run?.status ?? "") || exchange?.status==="done"))task.error=run?.error ?? exchange?.error ?? "轮次尚未完成，请查看失败步骤。";
      const blocked=result.runs.find(r=>r.status==="blocked");if(blocked)task.error=blocked.error;
      if (await cancelled() && task.error) task.status = "cancelled";
    } catch (error) { task.status = "interrupted"; task.error = error instanceof OrchestrationError ? error.message : "任务未完成，请检查故事状态。"; }
    finally { try { await this.save(task); } finally { active.delete(task.task_id); } }
  }
}
