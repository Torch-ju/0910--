import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import commonSchema from "../../../schemas/common.schema.json";
import worldSchema from "../../../schemas/story-world.schema.json";
import charactersSchema from "../../../schemas/character-profiles.schema.json";
import type { CharacterProfiles, FactSource, StoryWorld, TimelineEvent, ValidationIssue } from "@/lib/story/contracts";

type Json = Record<string, unknown>;
const WIRE_COMMON_ID = "https://shuzhongren.local/wire/common.schema.json";
const WIRE_WORLD_ID = "https://shuzhongren.local/wire/story-world.schema.json";
const WIRE_CHARACTERS_ID = "https://shuzhongren.local/wire/character-profiles.schema.json";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const asObject = (value: unknown): Json => value as Json;
const issue = (path: string, message: string): ValidationIssue => ({ code: "WIRE_INVALID", path, message });

function replaceCommonRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(replaceCommonRefs);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Json).map(([key, item]) => [key, key === "$ref" && typeof item === "string" ? item.replace("common.schema.json", WIRE_COMMON_ID) : replaceCommonRefs(item)]));
}
function omitProperties(schema: Json, keys: string[]): void {
  const properties = asObject(schema.properties);
  for (const key of keys) delete properties[key];
  schema.required = (schema.required as unknown[]).filter((key) => !keys.includes(String(key)));
}
function factWire(original: Json): Json {
  return { type: "object", additionalProperties: false, required: ["value", "source", "evidence"], properties: {
    value: clone(asObject(asObject(original.properties).value)),
    source: { type: "string", enum: ["user_explicit", "user_edited", "ai_inferred", "ai_suggestion"] },
    evidence: clone(asObject(asObject(original.properties).evidence)),
  } };
}
function wireCommon(): Json {
  const schema = clone(commonSchema) as Json;
  schema.$id = WIRE_COMMON_ID;
  const defs = asObject(schema.$defs);
  defs.factString = factWire(asObject(defs.factString));
  defs.factStringArray = factWire(asObject(defs.factStringArray));
  return schema;
}
function wireWorld(): Json {
  const schema = replaceCommonRefs(clone(worldSchema)) as Json;
  schema.$id = WIRE_WORLD_ID;
  omitProperties(schema, ["schema_version", "document_type", "story_id", "revision", "created_at", "updated_at", "change_log"]);
  return schema;
}
function wireCharacters(): Json {
  const schema = replaceCommonRefs(clone(charactersSchema)) as Json;
  schema.$id = WIRE_CHARACTERS_ID;
  omitProperties(schema, ["schema_version", "document_type", "story_id", "revision", "created_at", "updated_at", "change_log"]);
  const character = asObject(asObject(schema.$defs).character);
  omitProperties(character, ["change_log"]);
  const growth = asObject(asObject(character.properties).growth_arc);
  omitProperties(growth, ["user_confirmed"]);
  return schema;
}

export const WIRE_COMMON_SCHEMA = wireCommon();
export const WIRE_WORLD_SCHEMA = wireWorld();
export const WIRE_CHARACTERS_SCHEMA = wireCharacters();
export const WIRE_TIMELINE_EVENT_SCHEMA = clone(asObject(asObject(WIRE_WORLD_SCHEMA.$defs).timelineEvent));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(WIRE_COMMON_SCHEMA).addSchema(WIRE_WORLD_SCHEMA).addSchema(WIRE_CHARACTERS_SCHEMA);
const checkWorld = ajv.getSchema(WIRE_WORLD_ID)!;
const checkCharacters = ajv.getSchema(WIRE_CHARACTERS_ID)!;
const checkTimeline = ajv.compile(WIRE_TIMELINE_EVENT_SCHEMA);
function structural(check: typeof checkWorld, value: unknown): ValidationIssue[] {
  if (check(value)) return [];
  return (check.errors ?? []).map((error) => issue(error.instancePath || "/", error.message ?? "wire schema invalid"));
}
export const validateWireWorld = (value: unknown) => structural(checkWorld, value);
export const validateWireCharacters = (value: unknown) => structural(checkCharacters, value);
export const validateWireTimelineEvent = (value: unknown) => structural(checkTimeline, value);

const headerKeys = ["schema_version", "document_type", "story_id", "revision", "created_at", "updated_at"];
const isFullFact = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value) && ["value", "source", "status", "locked", "evidence", "updated_at"].every((key) => key in value);
const isWireFact = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value) && ["value", "source", "evidence"].every((key) => key in value) && !("status" in value || "locked" in value || "updated_at" in value);
const stableId = (value: unknown): string | undefined => value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value as Json).find(([key, item]) => key.endsWith("_id") && typeof item === "string")?.[1] as string | undefined : undefined;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function hydrate(value: unknown, previous: unknown, input: string, timestamp: string): unknown {
  if (isWireFact(value)) {
    if (isFullFact(previous) && same(value.value, previous.value)) return previous;
    const evidence = Array.isArray(value.evidence) ? value.evidence.filter((item): item is string => typeof item === "string" && input.includes(item)) : [];
    const userExplicit = value.source === "user_explicit" && evidence.length > 0;
    return { value: value.value, source: (userExplicit ? "user_explicit" : value.source === "ai_inferred" ? "ai_inferred" : "ai_suggestion") as FactSource, status: "pending_confirmation", locked: false, evidence, updated_at: timestamp };
  }
  if (Array.isArray(value)) {
    const before = Array.isArray(previous) ? previous : [];
    const byId = new Map(before.map((item) => [stableId(item), item]));
    return value.map((item, index) => hydrate(item, byId.get(stableId(item)) ?? before[index], input, timestamp));
  }
  if (value && typeof value === "object") {
    const before = previous && typeof previous === "object" ? previous as Json : {};
    return Object.fromEntries(Object.entries(value as Json).map(([key, item]) => [key, hydrate(item, before[key], input, timestamp)]));
  }
  return value;
}
function deriveGrowth(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deriveGrowth);
  if (!value || typeof value !== "object") return value;
  const output = Object.fromEntries(Object.entries(value as Json).map(([key, item]) => [key, deriveGrowth(item)])) as Json;
  if (output.growth_arc && typeof output.growth_arc === "object") {
    const growth = output.growth_arc as Json;
    growth.user_confirmed = [growth.starting_state, growth.pressure_point, growth.possible_direction].every((fact) => isFullFact(fact) && fact.status === "confirmed");
  }
  return output;
}
function documentHeader(previous: object): Json { const source = previous as unknown as Json; return Object.fromEntries(headerKeys.map((key) => [key, source[key]])); }
export function toWireWorld(world: StoryWorld): unknown {
  const wire = clone(world) as unknown as Json;
  for (const key of [...headerKeys, "change_log"]) Reflect.deleteProperty(wire, key);
  return stripFacts(wire);
}
export function toWireCharacters(characters: CharacterProfiles): unknown {
  const wire = clone(characters) as unknown as Json;
  for (const key of [...headerKeys, "change_log"]) Reflect.deleteProperty(wire, key);
  wire.characters = (wire.characters as Json[]).map((character) => {
    const next = { ...character }; Reflect.deleteProperty(next, "change_log");
    const growth = { ...(next.growth_arc as Json) }; Reflect.deleteProperty(growth, "user_confirmed"); next.growth_arc = growth;
    return next;
  });
  return stripFacts(wire);
}
export const toWireTimelineEvent = (event: TimelineEvent): unknown => stripFacts(event);
function stripFacts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripFacts);
  if (isFullFact(value)) return { value: value.value, source: value.source, evidence: value.evidence };
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Json).map(([key, item]) => [key, stripFacts(item)]));
}
export function hydrateWorld(wire: unknown, previous: StoryWorld, input: string): StoryWorld {
  const candidate = { ...(hydrate(wire, previous, input, new Date().toISOString()) as Json), ...documentHeader(previous), change_log: previous.change_log };
  return candidate as StoryWorld;
}
export function hydrateCharacters(wire: unknown, previous: CharacterProfiles, input: string): CharacterProfiles {
  const hydrated = deriveGrowth(hydrate(wire, previous, input, new Date().toISOString())) as Json;
  const oldLogs = new Map(previous.characters.map((character) => [character.character_id, character.change_log]));
  hydrated.characters = (hydrated.characters as Json[]).map((character) => ({ ...character, change_log: oldLogs.get(character.character_id as string) ?? [] }));
  return { ...hydrated, ...documentHeader(previous), change_log: previous.change_log } as CharacterProfiles;
}
export function hydrateTimelineEvent(wire: unknown, input: string): TimelineEvent { return hydrate(wire, undefined, input, new Date().toISOString()) as TimelineEvent; }
