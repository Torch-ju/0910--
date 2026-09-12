import type { AgentRequest, CharacterProfiles, FrameworkResult, NpcResult, RecognitionResult, RevisionResult, StoryWorld, TimelineEvent, ValidationIssue } from "@/lib/story/contracts";
import Ajv2020 from "ajv/dist/2020";
import { lockedChanges, validateCharacters, validatePair, validateWorld } from "@/lib/story/validation";
import { ChatCompletionsClient, type FetchLike, type ModelConfig, RequestLedger, StoryProviderError, fingerprintFor, parseModelJson, readModelConfig } from "./model";
import { hydrateCharacters, hydrateTimelineEvent, hydrateWorld, toWireCharacters, toWireWorld, validateWireCharacters, validateWireTimelineEvent, validateWireWorld, WIRE_CHARACTERS_SCHEMA, WIRE_COMMON_SCHEMA, WIRE_TIMELINE_EVENT_SCHEMA, WIRE_WORLD_SCHEMA } from "./wire-contract";
import { getFieldContract } from "@/lib/story/field-contract";

type Json = Record<string, unknown>;
type AgentDeps = { env?: Record<string, string | undefined>; fetcher?: FetchLike; ledger?: RequestLedger; config?: ModelConfig };
const root = (value: unknown): Json => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : invalid("response must be an object");
const json = (value: unknown) => JSON.stringify(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const invalid = (message: string, issues: ValidationIssue[] = []): never => { throw new StoryProviderError({ code: "schema_error", userMessage: message, retryable: false, fieldErrors: issues }, 422); };
const issue = (path: string, message: string): ValidationIssue => ({ code: "invalid", path, message });

function exact(value: unknown, keys: string[]): Json {
  const obj = root(value);
  const actual = Object.keys(obj).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== [...keys].sort()[index])) invalid("模型返回的结果字段不符合当前操作。", [issue("", `expected exactly: ${keys.join(", ")}`)]);
  return obj;
}
function assertIssues(issues: ValidationIssue[]): void { if (issues.length) invalid("模型结果未通过故事数据契约校验。", issues); }
export const RECOGNITION_SCHEMA = {
  type: "object", additionalProperties: false, required: ["summary", "character_clues", "hard_constraints", "ambiguities", "questions"], properties: {
    summary: { type: "string", description: "对用户想法的简短理解" },
    character_clues: { type: "array", description: "明确或待澄清的人物线索", items: { type: "object", additionalProperties: false, required: ["label", "identity", "evidence", "existing_character_id", "controlled_by", "ambiguity"], properties: {
      label: { type: "string", description: "用户使用的人物称谓" }, identity: { type: "string", description: "已知身份；未知时使用空字符串" }, evidence: { type: "array", description: "用户原话片段数组", items: { type: "string" } }, existing_character_id: { type: ["string", "null"], description: "匹配既有角色 ID；未知填 null" }, controlled_by: { type: "string", enum: ["npc", "user"], description: "仅在用户明确扮演时为 user；不可猜测" }, ambiguity: { type: ["string", "null"], description: "存在歧义时说明；无歧义填 null" },
    } } },
    hard_constraints: { type: "array", items: { type: "string" } }, ambiguities: { type: "array", items: { type: "string" } }, questions: { type: "array", items: { type: "object", additionalProperties: false, required: ["question", "blocking"], properties: { question: { type: "string" }, blocking: { type: "boolean" } } } },
  },
} as const;
const recognitionAjv = new Ajv2020({ allErrors: true, strict: false });
const checkRecognition = recognitionAjv.compile(RECOGNITION_SCHEMA);
function assertRecognition(value: unknown): RecognitionResult {
  if (checkRecognition(value)) return value as RecognitionResult;
  return invalid("识别结果不符合 Recognition Schema。", (checkRecognition.errors ?? []).map((error) => issue(error.instancePath || "/", `${error.message ?? "invalid"}${error.params.missingProperty ? `: ${error.params.missingProperty}` : ""}`)));
}

function validateReferences(world: StoryWorld, characters: CharacterProfiles, suggestions: TimelineEvent[] = []): void {
  assertIssues(validatePair(world, characters));
  if (suggestions.length) assertIssues(validatePair({ ...world, timeline: [...world.timeline, ...suggestions] }, characters));
  const characterIds = new Set(characters.characters.map((character) => character.character_id));
  const locationIds = new Set(world.setting.locations.map((location) => location.location_id));
  const eventIds = new Set([...world.timeline, ...suggestions].map((event) => event.event_id));
  const problems: ValidationIssue[] = [];
  for (const [index, event] of suggestions.entries()) {
    for (const id of event.related_character_ids) if (!characterIds.has(id)) problems.push(issue(`/timeline_suggestions/${index}/related_character_ids`, `unknown character: ${id}`));
    for (const id of event.related_location_ids) if (!locationIds.has(id)) problems.push(issue(`/timeline_suggestions/${index}/related_location_ids`, `unknown location: ${id}`));
    for (const id of event.after_event_ids) if (!eventIds.has(id)) problems.push(issue(`/timeline_suggestions/${index}/after_event_ids`, `unknown event: ${id}`));
  }
  assertIssues(problems);
}
function assertSuggestions(value: unknown, world: StoryWorld, input: string): TimelineEvent[] {
  if (!Array.isArray(value)) invalid("时间线建议必须是数组。");
  const suggestions = value as unknown[];
  const malformed = suggestions.findIndex((event) => validateWireTimelineEvent(event).length > 0);
  if (malformed >= 0) invalid("候选时间线包含不符合 Schema 的事件。", [issue(`/timeline_suggestions/${malformed}`, "invalid TimelineEvent")]);
  const hydrated = suggestions.map((event) => hydrateTimelineEvent(event, input));
  const originalIds = new Set(world.timeline.map((event) => event.event_id));
  const duplicate = hydrated.find((event) => originalIds.has(event.event_id));
  if (duplicate) invalid("候选时间线不得覆盖已有历史事件。", [issue("/timeline_suggestions", "event_id conflicts with accepted timeline")]);
  const check = { ...world, timeline: [...world.timeline, ...hydrated] };
  assertIssues(validateWorld(check));
  return hydrated;
}
function restrictLocalRewrite(before: CharacterProfiles, after: CharacterProfiles, characterId: string): void {
  if (!before.characters.some((character) => character.character_id === characterId) || !after.characters.some((character) => character.character_id === characterId)) invalid("局部人物改写必须引用已有角色。");
  const untouched = before.characters.filter((character) => character.character_id !== characterId);
  for (const character of untouched) {
    const updated = after.characters.find((item) => item.character_id === character.character_id);
    if (!updated || !same(character, updated)) invalid("局部人物改写修改了无关角色。", [issue("/characters", "unrelated character changed")]);
  }
  if (after.characters.some((character) => !before.characters.some((old) => old.character_id === character.character_id))) invalid("局部人物改写不能新增角色。");
  const unrelatedRelations = (profiles: CharacterProfiles) => profiles.relationships.filter((relationship) => relationship.from_character_id !== characterId && relationship.to_character_id !== characterId);
  if (!same(unrelatedRelations(before), unrelatedRelations(after))) invalid("局部人物改写修改了无关关系。", [issue("/relationships", "unrelated relationship changed")]);
}
function preserveExistingCharacters(before: CharacterProfiles, after: CharacterProfiles): void {
  const missing = before.characters.filter((character) => !after.characters.some((candidate) => candidate.character_id === character.character_id));
  if (missing.length) invalid("NPC 生成不得删除用户已有的人物。", missing.map((character) => issue("/characters", `missing existing character: ${character.character_id}`)));
  const reassigned = before.characters.filter((character) => character.controlled_by === "user" && after.characters.find((candidate) => candidate.character_id === character.character_id)?.controlled_by !== "user");
  if (reassigned.length) invalid("NPC 生成不得将用户控制人物改为 NPC。", reassigned.map((character) => issue("/characters", `user control changed: ${character.character_id}`)));
}
function requestedCharacterCount(input: string): number | null {
  const chineseDigits: Record<string, number> = { "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };
  const match = input.match(/(?:需要|要有|有|包括|包含|安排|生成|只有)?\s*(\d+|一|二|两|三|四|五|六|七|八|九|十)\s*(?:个|位|名)\s*(?:核心)?\s*(?:人物|角色|NPC)/i) ?? input.match(/\b(\d+)\s+(?:core\s+)?(?:characters?|npcs?)\b/i);
  if (!match) return null;
  return /^\d+$/.test(match[1]) ? Number(match[1]) : chineseDigits[match[1]];
}
function normalizeName(value: string): string { return value.toLocaleLowerCase().replace(/[\s·•，,。.!！?？]/g, ""); }
function explicitlyRemoved(clue: RecognitionResult["character_clues"][number], world: StoryWorld): boolean {
  return world.prohibited_content.some((constraint) => {
    const text = constraint.text;
    if (text.source !== "user_edited" || text.status !== "confirmed" || !text.value.includes("不再自动加入")) return false;
    const normalized = normalizeName(text.value);
    return [clue.label, clue.identity].filter((value) => value.trim().length > 0).some((value) => normalized.includes(normalizeName(value)));
  });
}
function requireUserClueCoverage(recognition: RecognitionResult | null, characters: CharacterProfiles, world: StoryWorld): void {
  if (!recognition) return;
  const missing: ValidationIssue[] = [];
  for (const clue of recognition.character_clues) {
    if (clue.ambiguity !== null || explicitlyRemoved(clue, world)) continue;
    const covered = clue.existing_character_id
      ? characters.characters.some((character) => character.character_id === clue.existing_character_id)
      : characters.characters.some((character) => [character.name.value, character.identity.value, ...character.aliases].some((name) => normalizeName(name) === normalizeName(clue.label) || normalizeName(name) === normalizeName(clue.identity)));
    const controlled = clue.controlled_by !== "user" || (clue.existing_character_id ? characters.characters.find((character) => character.character_id === clue.existing_character_id)?.controlled_by === "user" : characters.characters.some((character) => character.controlled_by === "user" && [character.name.value, character.identity.value, ...character.aliases].some((name) => normalizeName(name) === normalizeName(clue.label) || normalizeName(name) === normalizeName(clue.identity))));
    if (!covered || !controlled) missing.push(issue("/characters", `missing or incorrectly controlled unambiguous character: ${clue.label}`));
  }
  if (missing.length) invalid("NPC 结果遗漏了用户明确的人物线索。", missing);
}
function requireOpening(world: StoryWorld): void {
  if (!world.timeline.some((event) => event.period === "opening")) invalid("框架时间线必须包含至少一个开局事件。", [issue("/world/timeline", "missing opening event")]);
}

const CONTRACT = `Return one JSON object only. Wire Fact is exactly {value,source,evidence}; the application owns status, locked, timestamps, document headers, change logs and growth_arc.user_confirmed. Keep every business field and stable ID. Use concise Chinese, but retain all user information. Infer coherent missing details from the author input, selected theme, preset style, and current world state; mark inferred or proposed details as ai_inferred or ai_suggestion and preserve explicit author facts. Initial world timelines contain history/opening only and must include at least one opening. Do not reference unavailable NPC IDs. Character aliases retain user names. Character timeline_event_ids reference accepted world.timeline only, never candidate suggestions. Confirmed 不再自动加入 constraints override old input; confirmed merges satisfy clues through identity/name/aliases.`;
const systemPrompt = (role: string, output: string, schemas: unknown) => `You are the server-side ${role}. ${CONTRACT}\nOutput envelope: ${output}\nRequired wire schemas: ${JSON.stringify(schemas)}\nMinimal format example: {"value":"简短文本","source":"ai_suggestion","evidence":[]}\nReturn JSON only; do not create a fixed roster.`;
const repairPrompt = (error: StoryProviderError, previous: string) => `Your previous JSON was rejected. Previous JSON: ${previous}. Summary: ${error.error.userMessage}. Exact invalid paths: ${(error.error.fieldErrors ?? [{ path: "/", message: error.error.userMessage }]).map((item) => `${item.path}: ${item.message}`).join("; ")}. Return a corrected complete JSON object only. Preserve all requested entities and IDs.`;
const contextText = (request: AgentRequest) => request.context ? `Story idea: ${request.context.story_idea}\nUser notes: ${json(request.context.user_notes)}` : `Story idea: ${request.input}\nUser notes: []`;
const cloneDocument = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function at(target: Json, path: string): unknown { return path.slice(1).split("/").reduce<unknown>((current, part) => current && typeof current === "object" ? (current as Json)[part] : undefined, target); }
function replaceAt(target: Json, path: string, value: unknown): void { const parts = path.slice(1).split("/"); const key = parts.pop(); let current: Json = target; for (const part of parts) current = current[part] as Json; if (key) current[key] = value; }
function hydrateField(previous: Json, wire: Json, evidenceInput: string): Json {
  if (JSON.stringify(previous.value) === JSON.stringify(wire.value)) return previous;
  const evidence = Array.isArray(wire.evidence) ? wire.evidence.filter((item): item is string => typeof item === "string" && evidenceInput.includes(item)) : [];
  return { value: wire.value, source: wire.source === "user_explicit" && evidence.length ? "user_explicit" : wire.source === "ai_inferred" ? "ai_inferred" : "ai_suggestion", status: "pending_confirmation", locked: false, evidence, updated_at: new Date().toISOString() };
}

export class StoryAgents {
  private readonly config: ModelConfig;
  private readonly ledger: RequestLedger;
  private readonly client: ChatCompletionsClient;
  constructor(deps: AgentDeps = {}) {
    this.config = deps.config ?? readModelConfig(deps.env);
    this.ledger = deps.ledger ?? new RequestLedger();
    this.client = new ChatCompletionsClient(this.config, deps.fetcher);
  }
  async used(): Promise<number> { return this.ledger.used(); }
  private async run<T>(action: string, request: AgentRequest, system: string, user: string, decode: (value: unknown) => T): Promise<T> {
    const fingerprint = fingerprintFor(action, { input: request.input, context: request.context, field: request.field, preset_id: request.preset_id, target: request.target, character_id: request.character_id, recognition: request.recognition, world: request.world, characters: request.characters }, request.base_revision);
    const reservation = await this.ledger.reserve(request.operation_id, fingerprint, this.config.model);
    if (reservation.replay !== undefined) return reservation.replay as T;
    let previous = "<no parseable JSON>";
    const attempt = async (repair?: StoryProviderError): Promise<T> => {
      try {
        const reply = await this.client.complete(system, repair ? `${user}\n${repairPrompt(repair, previous)}` : user);
        await this.ledger.settleAttempt(request.operation_id, reply.telemetry);
        const parsed = parseModelJson(reply.content); previous = JSON.stringify(parsed); return decode(parsed);
      } catch (error) {
        if (error instanceof StoryProviderError && error.telemetry) await this.ledger.settleAttempt(request.operation_id, error.telemetry);
        throw error;
      }
    };
    try {
      try {
        const result = await attempt();
        await this.ledger.finish(request.operation_id, "success", result);
        return result;
      } catch (error) {
        const provider = error as StoryProviderError;
        if (!(provider instanceof StoryProviderError) || provider.error.code !== "schema_error") throw error;
        await this.ledger.reserve(request.operation_id, fingerprint, this.config.model, "repair");
        const result = await attempt(provider);
        await this.ledger.finish(request.operation_id, "success", result);
        return result;
      }
    } catch (error) {
      const provider = error as StoryProviderError;
      const uncertain = provider instanceof StoryProviderError && (provider.error.code === "request_timeout" || provider.error.retryable);
      await this.ledger.finish(request.operation_id, uncertain ? "uncertain" : "failed", undefined, provider instanceof StoryProviderError ? provider.error : { code: "provider_error", userMessage: "模型请求失败。", retryable: true });
      throw error;
    }
  }
  async framework(request: AgentRequest): Promise<FrameworkResult> {
    const system = systemPrompt("Story Framework Agent", `{world: WireStoryWorld, recognition: RecognitionResult, assistant_message}. RecognitionResult must match this exact schema: ${JSON.stringify(RECOGNITION_SCHEMA)}. Use only history/opening timeline entries and leave related_character_ids empty unless the ID is already in Current characters. Generate a coherent initial world state from the author idea, theme, tone, preset style, and existing state; fill compatible world rules, conflict, locations, organizations, and opening/history details when the author has left them open.`, { common: WIRE_COMMON_SCHEMA, world: WIRE_WORLD_SCHEMA, recognition: RECOGNITION_SCHEMA });
    return this.run("framework", request, system, `Preset: ${request.preset_id}. ${contextText(request)}\nCurrent instruction: ${request.input}\nExisting world wire: ${json(toWireWorld(request.world))}\nExisting characters wire: ${json(toWireCharacters(request.characters))}`, (value) => {
      const out = exact(value, ["world", "recognition", "assistant_message"]);
      if (typeof out.assistant_message !== "string") invalid("框架说明必须是文本。");
      const assistantMessage = out.assistant_message as string;
      assertIssues(validateWireWorld(out.world));
      const world = hydrateWorld(out.world, request.world, request.input);
      requireOpening(world);
      assertIssues([...validateWorld(world), ...lockedChanges(request.world, world)]);
      const recognition = assertRecognition(out.recognition);
      validateReferences(world, request.characters);
      return { world, recognition, assistant_message: assistantMessage };
    });
  }
  async npcs(request: AgentRequest): Promise<NpcResult> {
    const system = systemPrompt("NPC Agent", `{characters: WireCharacterProfiles, timeline_suggestions: WireTimelineEvent[], warnings: string[], assistant_message: string}. Create dynamic characters from user clues, the complete current world state, theme, tone, preset style, conflict, timeline, and world rules. Infer roles, motivations, relationships, secrets, speech styles, current states, and growth arcs that fit the authors theme and style. Preserve every existing named or unnamed user character and never silently reduce a requested count. If none are supplied, propose a coherent cast needed by the world and conflict.`, { common: WIRE_COMMON_SCHEMA, character: (WIRE_CHARACTERS_SCHEMA as Json).$defs, timeline_event: WIRE_TIMELINE_EVENT_SCHEMA });
    return this.run("npcs", request, system, `${contextText(request)}\nCurrent instruction: ${request.input}\nRecognition: ${json(request.recognition)}\nConfirmed removal constraints take priority: ${json(request.world.prohibited_content.filter((constraint) => constraint.text.source === "user_edited" && constraint.text.status === "confirmed"))}\nWorld wire: ${json(toWireWorld(request.world))}\nCurrent characters wire: ${json(toWireCharacters(request.characters))}`, (value) => {
      const out = exact(value, ["characters", "timeline_suggestions", "warnings", "assistant_message"]);
      if (typeof out.assistant_message !== "string" || !Array.isArray(out.warnings) || !out.warnings.every((warning) => typeof warning === "string")) invalid("NPC 说明或警告格式无效。");
      const assistantMessage = out.assistant_message as string;
      assertIssues(validateWireCharacters(out.characters));
      const characters = hydrateCharacters(out.characters, request.characters, request.input);
      const suggestions = assertSuggestions(out.timeline_suggestions, request.world, request.input);
      preserveExistingCharacters(request.characters, characters);
      requireUserClueCoverage(request.recognition, characters, request.world);
      const requested = requestedCharacterCount(`${request.context?.story_idea ?? ""}\n${request.context?.user_notes.join("\n") ?? ""}\n${request.input}`);
      if (requested !== null && characters.characters.length < requested) invalid("NPC 生成少于用户明确要求的人物数量。", [issue("/characters", `requested ${requested}, received ${characters.characters.length}`)]);
      assertIssues([...validateCharacters(characters), ...lockedChanges(request.characters, characters)]);
      validateReferences(request.world, characters, suggestions);
      return { characters, timeline_suggestions: suggestions, warnings: out.warnings as string[], assistant_message: assistantMessage };
    });
  }
  async revise(request: AgentRequest): Promise<RevisionResult> {
    if (!request.target) invalid("局部修改必须指定目标。", [issue("/target", "required")]);
    const system = systemPrompt("Story Revision Agent", request.target === "npc" ? `{characters: WireCharacterProfiles, timeline_suggestions: WireTimelineEvent[], warnings: string[], assistant_message: string}` : `{world: WireStoryWorld, warnings: string[], assistant_message: string}${request.target === "timeline" ? ". For target timeline, change only world.timeline; preserve all other world fields byte-for-byte." : ""}`, request.target === "npc" ? { common: WIRE_COMMON_SCHEMA, character: (WIRE_CHARACTERS_SCHEMA as Json).$defs, timeline_event: WIRE_TIMELINE_EVENT_SCHEMA } : { common: WIRE_COMMON_SCHEMA, world: WIRE_WORLD_SCHEMA });
    return this.run(`revise:${request.target}`, request, system, `${contextText(request)}\nTarget: ${request.target}; character_id: ${request.character_id ?? "none"}; Local revision instruction: ${request.input}\nWorld wire: ${json(toWireWorld(request.world))}\nCharacters wire: ${json(toWireCharacters(request.characters))}\nRecognition: ${json(request.recognition)}`, (value) => {
      if (request.target === "npc") {
        const out = exact(value, ["characters", "timeline_suggestions", "warnings", "assistant_message"]);
        if (typeof out.assistant_message !== "string" || !Array.isArray(out.warnings) || !out.warnings.every((warning) => typeof warning === "string")) invalid("修订说明格式无效。");
        const assistantMessage = out.assistant_message as string;
        assertIssues(validateWireCharacters(out.characters));
        const characters = hydrateCharacters(out.characters, request.characters, request.input);
        const suggestions = assertSuggestions(out.timeline_suggestions, request.world, request.input);
        if (request.character_id) restrictLocalRewrite(request.characters, characters, request.character_id);
        assertIssues([...validateCharacters(characters), ...lockedChanges(request.characters, characters)]);
        validateReferences(request.world, characters, suggestions);
        return { characters, timeline_suggestions: suggestions, warnings: out.warnings as string[], assistant_message: assistantMessage };
      }
      const out = exact(value, ["world", "warnings", "assistant_message"]);
      if (typeof out.assistant_message !== "string" || !Array.isArray(out.warnings) || !out.warnings.every((warning) => typeof warning === "string")) invalid("修订说明格式无效。");
      const assistantMessage = out.assistant_message as string;
      assertIssues(validateWireWorld(out.world));
      const world = hydrateWorld(out.world, request.world, request.input);
      if (request.target === "timeline") {
        const beforeRest: Partial<StoryWorld> = { ...request.world };
        const afterRest: Partial<StoryWorld> = { ...world };
        Reflect.deleteProperty(beforeRest, "timeline");
        Reflect.deleteProperty(afterRest, "timeline");
        if (!same(beforeRest, afterRest)) invalid("时间线局部修改不得改写其他世界字段。", [issue("/world", "non-timeline field changed")]);
      }
      assertIssues([...validateWorld(world), ...lockedChanges(request.world, world)]);
      validateReferences(world, request.characters);
      return { world, warnings: out.warnings as string[], assistant_message: assistantMessage };
    });
  }
  async field(request: AgentRequest): Promise<RevisionResult> {
    const field = request.field;
    if (!field) return invalid("字段建议必须指定 field。", [issue("/field", "required")]);
    const contract = (() => { try { return getFieldContract(request.world, request.characters, field); } catch (error) { return invalid((error as Error).message || "字段不可由 AI 修改。", [issue("/field", "invalid or locked field")]); } })();
    const fieldAjv = new Ajv2020({ allErrors: true, strict: false });
    const check = fieldAjv.compile(contract.schema);
    const system = systemPrompt("Field Suggestion Agent", `Return exactly {fact:{value,source,evidence},explanation,warnings}. Change only the selected Fact; never return a document, ID, lock, status, timestamp, or history. Task: ${contract.task}`, { field_output: contract.schema });
    const evidenceInput = `${request.context?.story_idea ?? request.input}\n${request.context?.user_notes.join("\n") ?? ""}\n${request.input}`;
    return this.run("field", request, system, `${contextText(request)}\nLocal instruction: ${request.input}\nSelected field path: ${field.document}${field.path}\nField description: ${contract.description}\nCurrent field: ${json({ value: contract.value.value, source: contract.value.source, evidence: contract.value.evidence })}\nWorld wire: ${json(toWireWorld(request.world))}\nCharacters wire: ${json(toWireCharacters(request.characters))}`, (value) => {
      if (!check(value)) invalid("字段候选不符合选定字段契约。", (check.errors ?? []).map((error) => issue(error.instancePath || "/", `${error.message ?? "invalid"}${error.params.missingProperty ? `: ${error.params.missingProperty}` : ""}`)));
      const output = value as { fact: Json; explanation: string; warnings: string[] };
      const nextWorld = cloneDocument(request.world) as unknown as Json;
      const nextCharacters = cloneDocument(request.characters) as unknown as Json;
      const document = field.document === "world" ? nextWorld : nextCharacters;
      const previous = at(document, field.path);
      if (!previous || typeof previous !== "object") invalid("目标字段在当前文档中不存在。", [issue("/field/path", "not found")]);
      replaceAt(document, field.path, hydrateField(previous as Json, output.fact, evidenceInput));
      const world = nextWorld as unknown as StoryWorld;
      const characters = nextCharacters as unknown as CharacterProfiles;
      assertIssues([...validateWorld(world), ...validateCharacters(characters), ...validatePair(world, characters), ...lockedChanges(field.document === "world" ? request.world : request.characters, field.document === "world" ? world : characters)]);
      return field.document === "world" ? { world, warnings: output.warnings, assistant_message: output.explanation } : { characters, warnings: output.warnings, assistant_message: output.explanation };
    });
  }
}

export const createStoryAgents = (deps?: AgentDeps) => new StoryAgents(deps);
