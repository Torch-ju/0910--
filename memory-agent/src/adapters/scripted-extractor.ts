import type { ExtractionResult, ProcessTurnInput } from "../domain.js";
import type { ExtractionContext, NarrativeMemoryExtractor } from "../ports.js";

export type ExtractionScript = (
  input: ProcessTurnInput,
  context: ExtractionContext,
) => Promise<ExtractionResult> | ExtractionResult;

/** A small deterministic adapter for tests, fixtures, and replay tooling. */
export class ScriptedNarrativeMemoryExtractor implements NarrativeMemoryExtractor {
  constructor(private readonly script: ExtractionScript) {}

  async extract(input: ProcessTurnInput, context: ExtractionContext): Promise<ExtractionResult> {
    return this.script(input, context);
  }
}
