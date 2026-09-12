import type { PortraitProjectionContext } from "../domain.js";
import type { PortraitSchemaAdapter } from "../ports.js";

export interface PlaceholderPortraitV2 {
  schemaNotice: string;
  /**
   * 下游默认展示字段。固定为不超过 100 个 Unicode 字符，只保留人物身份、
   * 最近关键行动和当前状态；完整事实、事件与关系仍由后续字段提供追溯依据。
   */
  coreSummary: string;
  coreSummaryCharacterCount: number;
  /** 跨章节变化概括，保留起点、关键转折和当前阶段。 */
  dynamicTrajectory: string;
  dynamicTrajectoryCharacterCount: number;
  character: {
    id: string;
    displayName: string;
    aliases: string[];
    status: string;
  };
  currentFacts: Record<string, Array<{
    value: string;
    inferred: boolean;
    confidence: number;
    evidenceQuote: string;
  }>>;
  importantRelationships: Array<{
    relationshipId: string;
    otherCharacterId: string;
    direction: "outgoing" | "incoming";
    type: string;
    description: string;
    importance: number;
  }>;
  eventTimeline: Array<{
    eventId: string;
    chapterNo: number;
    sceneNo: number;
    turnId: string;
    storyTime?: string;
    summary: string;
    importance: number;
  }>;
  memoryVersion: number;
}

/** @deprecated Use PlaceholderPortraitV2. */
export type PlaceholderPortraitV1 = PlaceholderPortraitV2;
/** @deprecated Use PlaceholderPortraitV2. */
export type PlaceholderPortraitV0 = PlaceholderPortraitV2;

export const CORE_PORTRAIT_SUMMARY_MAX_CHARACTERS = 100;

const IDENTITY_KEY_PATTERN = /身份|职业|地位|来历|出身|所属|角色/u;
const STATE_KEY_PATTERN = /当前|现状|状态|处境|目标|立场|倾向|健康|伤势|位置|职位|境界|阵营/u;

function characterCount(value: string): number {
  return Array.from(value).length;
}

function compact(value: string, limit: number): string {
  const normalized = value.replace(/\s+/gu, " ").replace(/[，。；：、,.!?！？\s]+$/gu, "").trim();
  const characters = Array.from(normalized);
  if (characters.length <= limit) return normalized;
  return `${characters.slice(0, Math.max(0, limit - 1)).join("")}…`;
}

function buildCoreSummary(context: PortraitProjectionContext): string {
  const rankedFacts = [...context.activeFacts].sort((left, right) =>
    Number(left.inference) - Number(right.inference) ||
    right.authority - left.authority ||
    right.confidence - left.confidence ||
    right.validFromVersion - left.validFromVersion,
  );
  const identity = rankedFacts.find((fact) => IDENTITY_KEY_PATTERN.test(fact.key));
  const state = rankedFacts.find(
    (fact) => fact.factId !== identity?.factId && STATE_KEY_PATTERN.test(fact.key),
  );
  const latestEventVersion = context.events.reduce(
    (latest, event) => Math.max(latest, event.memoryVersion),
    -1,
  );
  const latestEvent = context.events
    .filter((event) => event.memoryVersion === latestEventVersion)
    .sort((left, right) =>
      right.importance - left.importance ||
      right.evidence.chapterNo - left.evidence.chapterNo ||
      right.evidence.sceneNo - left.evidence.sceneNo,
    )[0];

  const segments = [compact(context.character.displayName, 12)];
  if (identity) segments.push(`身份：${compact(identity.value, 18)}`);
  else if (context.character.status === "provisional") segments.push("身份：待确认");
  if (latestEvent) segments.push(`行动：${compact(latestEvent.summary, 34)}`);
  if (state) segments.push(`现状：${compact(state.value, 22)}`);
  if (segments.length === 1) segments.push("现状：暂无关键变化");

  const summary = `${segments.join("；")}。`;
  if (characterCount(summary) <= CORE_PORTRAIT_SUMMARY_MAX_CHARACTERS) return summary;
  return compact(summary, CORE_PORTRAIT_SUMMARY_MAX_CHARACTERS);
}

function buildDynamicTrajectory(context: PortraitProjectionContext): string {
  const representativeByChapter = new Map<number, PortraitProjectionContext["events"][number]>();
  for (const event of context.events) {
    const chapterNo = event.evidence.chapterNo;
    const existing = representativeByChapter.get(chapterNo);
    if (
      !existing ||
      event.importance > existing.importance ||
      (event.importance === existing.importance && event.evidence.sceneNo >= existing.evidence.sceneNo)
    ) {
      representativeByChapter.set(chapterNo, event);
    }
  }

  const chapterEvents = [...representativeByChapter.values()].sort(
    (left, right) => left.evidence.chapterNo - right.evidence.chapterNo,
  );
  if (chapterEvents.length < 2) return "阶段变化尚未形成";

  const selected = chapterEvents.length <= 3
    ? chapterEvents
    : [
        chapterEvents[0],
        [...chapterEvents.slice(1, -1)].sort((left, right) =>
          right.importance - left.importance ||
          right.evidence.chapterNo - left.evidence.chapterNo,
        )[0],
        chapterEvents.at(-1),
      ].filter((event): event is PortraitProjectionContext["events"][number] => event !== undefined);

  const separator = " → ";
  const stageLimit = Math.floor(
    (CORE_PORTRAIT_SUMMARY_MAX_CHARACTERS - separator.length * (selected.length - 1)) /
      selected.length,
  );
  const stages = selected.map((event) => {
    const withoutRepeatedName = event.summary.startsWith(context.character.displayName)
      ? event.summary.slice(context.character.displayName.length)
      : event.summary;
    return compact(withoutRepeatedName || event.summary, stageLimit);
  });
  return compact(stages.join(separator), CORE_PORTRAIT_SUMMARY_MAX_CHARACTERS);
}

export class PlaceholderPortraitAdapter implements PortraitSchemaAdapter<PlaceholderPortraitV2> {
  readonly schemaVersion = "placeholder-v2";

  project(context: PortraitProjectionContext): PlaceholderPortraitV2 {
    const currentFacts: PlaceholderPortraitV2["currentFacts"] = {};
    for (const fact of context.activeFacts) {
      const values = currentFacts[fact.key] ?? [];
      if (!values.some((item) => item.value === fact.value)) {
        values.push({
          value: fact.value,
          inferred: fact.inference,
          confidence: fact.confidence,
          evidenceQuote: fact.evidence.quote,
        });
      }
      currentFacts[fact.key] = values;
    }

    const coreSummary = buildCoreSummary(context);
    const dynamicTrajectory = buildDynamicTrajectory(context);
    return {
      schemaNotice: "Temporary projection. Replace this adapter when the official portrait schema arrives.",
      coreSummary,
      coreSummaryCharacterCount: characterCount(coreSummary),
      dynamicTrajectory,
      dynamicTrajectoryCharacterCount: characterCount(dynamicTrajectory),
      character: {
        id: context.character.characterId,
        displayName: context.character.displayName,
        aliases: context.aliases.filter((alias) => alias.confirmed).map((alias) => alias.value),
        status: context.character.status,
      },
      currentFacts,
      importantRelationships: context.relationships
        .filter((relationship) => relationship.isImportant && relationship.status === "active")
        .map((relationship) => {
          const outgoing = relationship.fromCharacterId === context.character.characterId;
          return {
            relationshipId: relationship.relationshipId,
            otherCharacterId: outgoing
              ? relationship.toCharacterId
              : relationship.fromCharacterId,
            direction: outgoing ? "outgoing" : "incoming",
            type: relationship.type,
            description: relationship.description,
            importance: relationship.importance,
          };
        }),
      eventTimeline: context.events.map((event) => ({
        eventId: event.eventId,
        chapterNo: event.evidence.chapterNo,
        sceneNo: event.evidence.sceneNo,
        turnId: event.evidence.turnId,
        ...(event.evidence.storyTime === undefined ? {} : { storyTime: event.evidence.storyTime }),
        summary: event.summary,
        importance: event.importance,
      })),
      memoryVersion: context.memoryVersion,
    };
  }
}
