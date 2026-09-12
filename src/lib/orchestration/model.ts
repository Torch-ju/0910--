import { fitNarrativeRequest } from "./request-budget";
import { automaticRetry } from "@/lib/ai/automatic-retry";
import Ajv2020 from "ajv/dist/2020";
import type { AnySchema } from "ajv";
import { ChatCompletionsClient, RequestLedger, StoryProviderError, fingerprintFor, parseModelJson, readModelConfig } from "@/lib/ai/model";
import { DATA_BOUNDARY } from "./prompts";

export interface JsonAgentClient {
  hasCompleted?(operationId: string): Promise<boolean>;
  generate(operationId: string, system: string, input: unknown, schema: AnySchema, refine?: (output: unknown) => void, progress?: (text:string)=>Promise<void>, options?: {jsonMode:boolean}): Promise<unknown>;
}
/** A shared paid-call ledger also covers new narrative agents and their single schema repair. */
export class NarrativeModelClient implements JsonAgentClient {
  constructor(private readonly ledger = new RequestLedger()) {}
  hasCompleted(operationId: string) { return this.ledger.hasCompleted(operationId); }
  async generate(operationId: string, system: string, input: unknown, schema: AnySchema, refine?: (output: unknown) => void, progress?: (text:string)=>Promise<void>, options?: {jsonMode:boolean}): Promise<unknown> {
    return automaticRetry(this.ledger.path,operationId,fingerprintFor(system,{input,schema,...(options?{options}:{})},1),id => this.generateOnce(id,system,input,schema,refine,progress,options));
  }
  private async generateOnce(operationId: string, system: string, input: unknown, schema: AnySchema, refine?: (output: unknown) => void, progress?: (text:string)=>Promise<void>, options?: {jsonMode:boolean}): Promise<unknown> {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    const config = readModelConfig();
    const fingerprint = fingerprintFor(system, { input, schema, ...(options?{options}:{}) }, 1);
    const prompt = `${system}\n${DATA_BOUNDARY}\n输出契约：${JSON.stringify(schema)}`;
    let user = fitNarrativeRequest(prompt, input);
    const reserved = await this.ledger.reserve(operationId, fingerprint, config.model);
    if (reserved.replay !== undefined) return reserved.replay;
    const client = new ChatCompletionsClient(config, undefined, null, options?.jsonMode);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt) user = fitNarrativeRequest(prompt, {repair_request:user});
        if (attempt) await this.ledger.reserve(operationId, fingerprint, config.model, "repair");
        await progress?.("");
        const reply = await client.complete(prompt, user, progress);
        await this.ledger.settleAttempt(operationId, reply.telemetry);
        let output: unknown;
        let issue = "";
        try { output = parseModelJson(reply.content); }
        catch { issue = "输出不是合法 JSON"; }
        if (!issue) {
          const issues: string[] = [];
          if (!validate(output)) issues.push(JSON.stringify(validate.errors));
          // Collect business evidence errors in the same repair as structural errors.
          try { refine?.(output); } catch (error) { issues.push(error instanceof Error ? error.message : "业务校验失败"); }
          issue = issues.join("\n");
        }
        if (!issue) {
          await this.ledger.finish(operationId, "success", output);
          return output;
        }
        issue ||= JSON.stringify(validate.errors);
        issue ||= JSON.stringify(validate.errors);
        await this.ledger.recordValidation(operationId, issue, reply.content);
        if (attempt) throw new StoryProviderError({ code: "schema_error", userMessage: "子 Agent 输出两次未通过校验。", retryable: false }, 422);
        user = `${JSON.stringify(input)}\n上次输出：${reply.content}\n只修复以下校验问题，保留事实。可选字段没有值时删除该键，例如未知人物的 characterIdHint 必须省略，不能填空字符串或 null。错误：${issue}`;
      }
      throw new Error("Unreachable");
    } catch (error) {
      const provider = error instanceof StoryProviderError ? error : null;
      if (provider?.telemetry) await this.ledger.settleAttempt(operationId, provider.telemetry);
      await this.ledger.finish(operationId, provider?.status === 422 ? "failed" : "uncertain", undefined, { code: provider?.error.code ?? "agent_failed", userMessage: provider?.error.userMessage ?? "子 Agent 调用中断。", retryable: false });
      throw error;
    }
  }
}
