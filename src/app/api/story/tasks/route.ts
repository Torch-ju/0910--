import { after, NextResponse } from "next/server";
import { NarrativeTasks } from "@/lib/orchestration/tasks";
import { OrchestrationError } from "@/lib/orchestration/contracts";
import { safeBody, respond } from "../_io";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return NextResponse.json(await new NarrativeTasks().get(new URL(request.url).searchParams.get("task_id") ?? "")); } catch (e) { return respond(e); }
}
export async function POST(request: Request) {
  try {
    const body = await safeBody(request);
    if (body.action === "cancel") return NextResponse.json(await new NarrativeTasks().cancel(body.task_id));
    if (Object.keys(body).some(key => !["task_id", "command"].includes(key))) throw new OrchestrationError("invalid_request", "任务字段无效。", 400);
    const queue = new NarrativeTasks();
    const { task, created } = await queue.create(body.task_id, body.command);
    if (created) after(() => queue.execute(task));
    return NextResponse.json(task, { status: 202 });
  } catch (e) { return respond(e); }
}
