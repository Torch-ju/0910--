import { NextResponse } from "next/server";
import { createStoryAgents } from "@/lib/ai/agents";
import { agentRequest, errorResponse } from "../_handler";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try { return NextResponse.json(await createStoryAgents().framework(await agentRequest(request))); }
  catch (error) { return errorResponse(error); }
}
