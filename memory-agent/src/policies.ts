import type { EvidenceInput, RelationshipRecord, SourceKind } from "./domain.js";

const AUTHORITY: Record<SourceKind, number> = {
  user_confirmation: 100,
  explicit_identity_reveal: 95,
  narration: 90,
  character_statement: 60,
  other_character_statement: 50,
  agent_inference: 20,
};

const IMPORTANT_RELATIONSHIP_TYPES = new Set([
  "parent",
  "child",
  "sibling",
  "spouse",
  "lover",
  "enemy",
  "rival",
  "mentor",
  "student",
  "盟友",
  "敌人",
  "亲属",
  "夫妻",
  "恋人",
  "师徒",
]);

export function sourceAuthority(sourceKind: SourceKind): number {
  return AUTHORITY[sourceKind];
}

export function canConfirmIdentity(evidence: EvidenceInput): boolean {
  return (
    evidence.sourceKind === "narration" ||
    evidence.sourceKind === "explicit_identity_reveal" ||
    evidence.sourceKind === "user_confirmation"
  );
}

export function shouldAutomaticallySupersedeFact(
  incoming: EvidenceInput,
  activeAuthority: number,
  temporal: "static" | "state",
  correctionIntent = false,
): boolean {
  const incomingAuthority = sourceAuthority(incoming.sourceKind);
  if (incoming.sourceKind === "user_confirmation") return true;
  if (correctionIntent && incomingAuthority >= AUTHORITY.narration) return true;
  if (temporal === "state") return incomingAuthority >= activeAuthority;
  return incomingAuthority > activeAuthority;
}

export function isImportantRelationship(
  observation: { type: string; description: string; importance: number },
  existing?: RelationshipRecord,
): boolean {
  const occurrenceCount = (existing?.occurrenceCount ?? 0) + 1;
  return (
    observation.importance >= 0.6 ||
    occurrenceCount >= 2 ||
    observation.description.length >= 60 ||
    IMPORTANT_RELATIONSHIP_TYPES.has(observation.type.toLocaleLowerCase("zh-CN"))
  );
}
