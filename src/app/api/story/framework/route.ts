import { NextResponse } from "next/server";
import { createMainAgent } from "@/lib/orchestration/main-agent";
import { agentRequest, errorResponse } from "../_handler";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try { return NextResponse.json(await createMainAgent().settings("framework", await agentRequest(request))); }
  catch (error) { return errorResponse(error); }
}
