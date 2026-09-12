import { NextResponse } from "next/server";
import { StoryManager } from "@/lib/orchestration/manage";
import { safeBody, respond } from "../_io";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const manager = new StoryManager();
    if (query.get("view") === "memory") return NextResponse.json(await manager.memory(query.get("story_id") ?? ""));
    if (query.get("view") === "backup") return NextResponse.json(await manager.backup(query.get("story_id") ?? ""));
    return NextResponse.json(await manager.list());
  } catch (e) { return respond(e); }
}
export async function POST(request: Request) {
  try {
    const body = await safeBody(request), manager = new StoryManager();
    if (body.action === "import") return NextResponse.json(await manager.restore(body.backup));
    return NextResponse.json(await manager.manage(body));
  } catch (e) { return respond(e); }
}
