import { NextResponse } from "next/server";
import { RequestLedger, providerStatus } from "@/lib/ai/model";
import { errorResponse } from "../_handler";

export const runtime = "nodejs";
export async function GET() {
  try { return NextResponse.json(providerStatus(process.env, await new RequestLedger().used())); }
  catch (error) { return errorResponse(error); }
}
