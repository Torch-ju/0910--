import type { Character, CharacterProfiles, Fact, FactSource, PresetId, Relationship, StorySnapshot, StoryWorld, TimelineEvent } from "./contracts";
export const uid = (prefix: string) => prefix + "_" + crypto.randomUUID().replaceAll("-", "");
export const now = () => new Date().toISOString();
export function fact<T extends string | string[]>(value: T, source: FactSource = "ai_suggestion"): Fact<T> {
  return { value, source, status: value.length ? "pending_confirmation" : "draft", locked: false, evidence: [], updated_at: now() };
}
export function createWorld(storyId: string): StoryWorld {
  const stamp = now();
  return { schema_version: "1.0.0", document_type: "story_world", story_id: storyId, revision: 1, created_at: stamp, updated_at: stamp,
    title: fact(""), logline: fact(""), summary: fact(""), genre: fact<string[]>([]), themes: fact<string[]>([]), tone: fact<string[]>([]),
    setting: { era: fact(""), geography: fact(""), locations: [], society: fact(""), technology_or_power_system: fact(""), world_rules: [] },
    organizations: [], core_conflict: { description: fact(""), forces: fact<string[]>([]), stakes: fact(""), open_issues: fact<string[]>([]) },
    initial_outline: [], timeline: [], hard_constraints: [], prohibited_content: [], open_questions: [], change_log: [] };
}
export function createCharacter(name = "未命名人物", id = uid("npc")): Character {
  return { character_id: id, controlled_by: "npc", aliases: [], name: fact(name, "user_edited"), identity: fact(""), role: fact("待定"),
    appearance: fact(""), personality: fact<string[]>([]), desire: fact(""), fear: fact(""), secret: fact(""), background: fact(""),
    speech_style: fact(""), behavior_tendencies: fact<string[]>([]),
    growth_arc: { starting_state: fact(""), pressure_point: fact(""), possible_direction: fact(""), user_confirmed: false },
    entrance_condition: fact(""), current_state: fact(""), known_information: fact<string[]>([]), unknown_information: fact<string[]>([]),
    relationship_ids: [], timeline_event_ids: [], hard_constraints: [], open_questions: [], change_log: [] };
}
export function createTimelineEvent(name = "新的历史事件"): TimelineEvent {
  return { event_id: uid("event"), name: fact(name, "user_edited"), time_label: fact("时间待定", "user_edited"), order: null, period: "history", description: fact(""),
    related_character_ids: [], related_location_ids: [], after_event_ids: [] };
}
export function createRelationship(from: string, to: string): Relationship {
  return { relationship_id: uid("rel"), from_character_id: from, to_character_id: to, type: "unknown", description: fact("待确认关系"), current_state: fact(""), possible_direction: fact("") };
}
export function createSnapshot(preset: PresetId = "western_fantasy"): StorySnapshot {
  const world = createWorld(uid("story"));
  const characters: CharacterProfiles = { schema_version: "1.0.0", document_type: "character_profiles", story_id: world.story_id, revision: 1, created_at: world.created_at, updated_at: world.updated_at, characters: [], relationships: [], change_log: [] };
  return { snapshot_version: 1, preset_id: preset, snapshot_revision: 1, world, characters, messages: [], input: "", recognition: null, timeline_suggestions: [], operations: [], updated_at: now() };
}
