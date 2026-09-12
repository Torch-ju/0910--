import { creativeSnapshot } from "./creative-context";
import type { StorySession } from "./contracts";
import { OrchestrationError } from "./contracts";
import type { InMemoryMemoryRepository } from "../../../memory-agent/src/infrastructure/in-memory-repository";

/** Soft retrieval budget; essential creative facts are always included, full prose stays on disk. */
export async function buildContext(session: StorySession, input: string, repository: InMemoryMemoryRepository) {
  const budget = Number(process.env.NARRATIVE_CONTEXT_CHARS ?? 60000);
  if (!Number.isInteger(budget) || budget < 12000) throw new OrchestrationError("context_config", "NARRATIVE_CONTEXT_CHARS 须为至少 12000 的整数。", 503);
  const known = await repository.getExtractionContext(session.snapshot.world.story_id);
  const sourceRecords = repository.snapshot().facts.filter(fact => fact.status === "active").map(fact => ({ fact_id: fact.factId, character_id: fact.characterId, key: fact.key, value: fact.value, source_kind: fact.evidence.sourceKind, authority: fact.authority, turn_id: fact.evidence.turnId, confidence: fact.confidence }));
  let available = Math.max(0, budget - JSON.stringify(sourceRecords).length - JSON.stringify(creativeSnapshot(session.snapshot)).length - JSON.stringify(known).length - JSON.stringify(session.summary).length - input.length - 2000);
  const characters = known.characters.filter(c => [c.displayName, ...c.aliases].some(name => name && (input + session.current_location).includes(name))).map(c => c.characterId);
  const matches = await repository.search({ storyId: session.snapshot.world.story_id, queryText: input + " " + session.current_location, currentCharacterIds: characters, limit: 12 });
  const relevant: typeof matches = [];
  for (const match of matches) {
    const size = JSON.stringify(match).length;
    if (size <= available / 2) { relevant.push(match); available -= size; }
  }
  const recent: StorySession["turns"][number]["prose"][] = [];
  for (const turn of [...session.turns].reverse()) {
    const size = JSON.stringify(turn.prose).length;
    if (size > available) {
      if (!recent.length) {
        const overhead = JSON.stringify({ ...turn.prose, content: "" }).length;
        const keep = Math.floor(available - overhead - 100);
        if (keep >= 500) recent.push({ ...turn.prose, content: "[最近片段末尾节选]\n" + Array.from(turn.prose.content).slice(-keep).join("") });
      }
      break;
    }
    recent.unshift(turn.prose); available -= size;
  }
  return { recent, relevant, sourceRecords };
}
