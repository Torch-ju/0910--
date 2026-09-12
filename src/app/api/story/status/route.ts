import { NextResponse } from "next/server";
import { RequestLedger, providerStatus } from "@/lib/ai/model";
import { errorResponse } from "../_handler";

export const runtime = "nodejs";
export async function GET() {
  try { const ledger = new RequestLedger(); return NextResponse.json({ ...providerStatus(process.env, await ledger.used()), metrics: await ledger.statistics() }); }
  catch (error) { return errorResponse(error); }
}
