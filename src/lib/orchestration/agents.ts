import { NPC_DIALOGUE_PROMPT, NPC_REPLY_SCHEMA } from "./npc-dialogue";
import { INTERACTIVE_PROSE_SCHEMA } from "./dialogue";
import Ajv2020 from "ajv/dist/2020";
import type { AnySchema } from "ajv";
import proseSchema from "../../../transcription-agent/output.schema.json";
import inputSchema from "../../../transcription-agent/input.schema.json";
import { LlmNarrativeMemoryExtractor } from "../../../memory-agent/src/adapters/llm-narrative-memory-extractor";
import type { ProcessTurnInput } from "../../../memory-agent/src/domain";
import type { ExtractionContext } from "../../../memory-agent/src/ports";
import { extractionResultSchema, validateExtraction } from "./memory";
import { OrchestrationError, type Chapter, type SummaryOutput, type Turn } from "./contracts";
import type { JsonAgentClient } from "./model";
import { PROMPTS, DIRECT_PROSE_PROMPT, INTERACTIVE_PROSE_PROMPT } from "./prompts";

const string = { type: "string", minLength: 1, maxLength: 16000 };
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
export const ROLE_SCHEMA = object({ content: string });
export const NARRATOR_SCHEMA = object({ current_time: string, current_location: string, background: string, visible_events: { type: "array", maxItems: 30, items: string } });
export const SUMMARY_SCHEMA = object({ summary: { ...string, maxLength: 4000 }, unresolved_threads: { type: "array", maxItems: 40, items: { ...string, maxLength: 500 } } });
export const PROSE_SCHEMA = proseSchema;

export function checked<T>(value: unknown, schema: AnySchema): T {
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  if (!validate(value)) throw new OrchestrationError("agent_output_invalid", `子 Agent 输出不符合契约：${JSON.stringify(validate.errors)}`, 422);
  return value as T;
}

export class NarrativeAgents {
  constructor(private readonly client: JsonAgentClient) {}
  hasCompleted(id: string) { return this.client.hasCompleted?.(id) ?? Promise.resolve(false); }
  roles(_id: string, input: unknown) { const cast = (input as {cast?:unknown[]}).cast ?? []; return Promise.resolve({content: `本轮已加载 ${cast.length} 位人物，完整身份与已知/未知信息见 cast 与 story_state；角色行动与对白由本轮故事线统筹一次规划。`}); }
  narrator(id: string, input: unknown) { return this.client.generate(id, PROMPTS.narrator, input, NARRATOR_SCHEMA); }
  transcription(id: string, input: unknown, progress?: (text:string)=>Promise<void>) { checked(input, inputSchema); return this.client.generate(id, PROMPTS.transcription, input, PROSE_SCHEMA, undefined, progress); }
  directProse(id: string, input: unknown, progress?: (text:string)=>Promise<void>) { checked(input, inputSchema); return this.client.generate(id, DIRECT_PROSE_PROMPT, input, PROSE_SCHEMA, undefined, progress); }
  interactiveProse(id: string, input: unknown, refine: (output:unknown)=>void, progress?: (text:string)=>Promise<void>) { return this.client.generate(id, INTERACTIVE_PROSE_PROMPT, input, INTERACTIVE_PROSE_SCHEMA, refine, progress); }
  npcDialogue(id:string,input:unknown) {return this.client.generate(id,NPC_DIALOGUE_PROMPT,input,NPC_REPLY_SCHEMA,undefined,undefined,{jsonMode:true,fast:true});}
  summary(id: string, input: unknown) { return this.client.generate(id, PROMPTS.summary, input, SUMMARY_SCHEMA); }
  extract(id: string, input: ProcessTurnInput, context: ExtractionContext) {
    const extractor = new LlmNarrativeMemoryExtractor({ generateJson: request => this.client.generate(id, request.systemPrompt + "\n本轮唯一 segmentId 是 prose。quote 必须为正文中连续的一小段逐字引文，不拼接句子，不使用字面量反斜杠 n。禁止自行输出 user_confirmation。已知人物使用 knownMemory 的 ID。新人物必须省略 characterIdHint 这个键，绝不能填空字符串或 null。inference=true 时 sourceKind 必须为 agent_inference。关系和事实涉及角色自述时使用 character_statement，而不是 narration。只提取少量重要的持久信息，避免复述全部正文。", JSON.parse(request.userContent), extractionResultSchema.toJSONSchema(), output => { validateExtraction(output, input.narrative.text, new Set(context.characters.map(c => c.characterId))); }) });
    return extractor.extract(input, context);
  }
}

/** Archival is deterministic: existing validated prose is not rewritten by a model. */
export function archiveChapter(number: number, turns: Turn[], summary: SummaryOutput): Chapter {
  if (!turns.length) throw new OrchestrationError("empty_chapter", "空章节不能归档。", 422);
  return { id: `chapter_${number}`, number, source_turn_ids: turns.map(turn => turn.id), content: turns.map(turn => turn.prose.content).join("\n\n"), summary };
}
