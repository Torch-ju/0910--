import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestLedger } from "@/lib/ai/model";
import { NarrativeModelClient } from "./model";
import { ROLE_SCHEMA } from "./agents";
import { extractionResultSchema } from "./memory";
import inputSchema from "../../../transcription-agent/input.schema.json";
import outputSchema from "../../../transcription-agent/output.schema.json";
import example from "../../../transcription-agent/example.json";
import { checked } from "./agents";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function client() {
  vi.stubEnv("LLM_BASE_URL", "http://localhost:4010"); vi.stubEnv("LLM_MODEL", "test-text"); vi.stubEnv("LLM_API_KEY", "test-only");
  const ledger = new RequestLedger(join(await mkdtemp(join(tmpdir(), "narrative-ledger-")), "ledger.json"));
  return { model: new NarrativeModelClient(ledger), ledger };
}
const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 });
describe("narrative model receipts", () => {
  it("repairs malformed output once and replays success without another request", async () => {
    const { model, ledger } = await client();
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply("invalid")).mockResolvedValueOnce(reply('{"content":"有效正文"}'));
    expect(await model.generate("op_model_one", "system", {}, ROLE_SCHEMA)).toEqual({ content: "有效正文" });
    await model.generate("op_model_one", "system", {}, ROLE_SCHEMA);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(await ledger.used()).toBe(2);
  });
  it("bounds automatic transport retries and does not loop on exhausted receipts", async () => {
    const { model } = await client();
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("synthetic disconnect"));
    await expect(model.generate("op_model_two", "system", {}, ROLE_SCHEMA)).rejects.toThrow();
    await expect(model.generate("op_model_two", "system", {}, ROLE_SCHEMA)).rejects.toMatchObject({ error: { code: "operation_unavailable" } });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("accepts the memory package's generated schema and the migrated transcription example", async () => {
    const { model } = await client();
    const empty = { mentions: [], events: [], facts: [], relationships: [], identities: [] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(JSON.stringify(empty)));
    expect(await model.generate("op_memory_schema", "memory", {}, extractionResultSchema.toJSONSchema())).toEqual(empty);
    expect(checked(example.input, inputSchema)).toEqual(example.input);
    expect(checked(example.output, outputSchema)).toEqual(example.output);
  });
});

it("repairs a business validation error once before recording a successful model receipt", async () => {
  const { model, ledger } = await client();
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply('{"content":"改写的证据"}')).mockResolvedValueOnce(reply('{"content":"逐字原文"}'));
  const result = await model.generate("op_evidence_repair", "system", {}, ROLE_SCHEMA, output => { if ((output as {content:string}).content !== "逐字原文") throw Error("quote must match exact original text"); });
  expect(result).toEqual({ content: "逐字原文" }); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await ledger.hasCompleted("op_evidence_repair")).toBe(true);
});

it("reports structure and evidence failures together so one repair can fix both", async () => {
  const { model } = await client();
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply('{"content":"bad quote","extra":true}')).mockResolvedValueOnce(reply('{"content":"exact quote"}'));
  await model.generate("op_combined_repair", "system", {}, ROLE_SCHEMA, output => { if ((output as {content:string}).content !== "exact quote") throw Error("quote is not in prose"); });
  const second = JSON.parse(fetcher.mock.calls[1][1]!.body as string);
  expect(second.messages[1].content).toContain("additionalProperties"); expect(second.messages[1].content).toContain("quote is not in prose");
});

it("deduplicates concurrent callers and replays a recovered response without additional calls", async () => {
  const {model,ledger}=await client();
  const fetcher=vi.spyOn(globalThis,"fetch").mockRejectedValueOnce(new Error("disconnect")).mockResolvedValue(reply('{"content":"恢复正文"}'));
  const values=await Promise.all([model.generate("op_concurrent","system",{},ROLE_SCHEMA),model.generate("op_concurrent","system",{},ROLE_SCHEMA)]);
  expect(values).toEqual([{content:"恢复正文"},{content:"恢复正文"}]);
  expect(fetcher).toHaveBeenCalledTimes(2);expect(await ledger.hasCompleted("op_concurrent")).toBe(true);
  await model.generate("op_concurrent","system",{},ROLE_SCHEMA);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("revalidates stored schema failures using corrected rules without a new model call", async () => {
  const {ledger}=await client();
  await ledger.reserve("op_revalidate","same","model");
  await ledger.recordValidation("op_revalidate",{code:"schema_error"},'{"content":"旧结果"}');
  await ledger.finish("op_revalidate","failed",undefined,{code:"schema_error",userMessage:"old validation",retryable:false});
  expect(await ledger.revalidate("op_revalidate","different",value=>value)).toEqual({});
  expect(await ledger.revalidate("op_revalidate","same",value=>checked(value,ROLE_SCHEMA))).toEqual({replay:{content:"旧结果"}});
  expect(await ledger.used()).toBe(1);expect(await ledger.hasCompleted("op_revalidate")).toBe(true);
});
