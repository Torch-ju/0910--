import type { StorySnapshot } from "./contracts";

/** Collect unresolved questions for optional guidance; candidate generation is allowed. */
export function npcBlockingQuestions(snapshot: StorySnapshot): string[] {
  return [...new Set([
    ...(snapshot.recognition?.questions.filter(q => q.blocking).map(q => q.question) ?? []),
    ...[...snapshot.world.open_questions, ...snapshot.characters.characters.flatMap(c => c.open_questions)]
      .filter(q => q.blocking && q.status === "open").map(q => q.question),
  ])];
}
