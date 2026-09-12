import { extractionResultSchema } from "../contracts.js";
import type { ExtractionResult, ProcessTurnInput } from "../domain.js";
import type { ExtractionContext, NarrativeMemoryExtractor } from "../ports.js";

/**
 * Integration adapter for deterministic upstream pipelines that already return
 * extraction JSON. It is useful in tests and before a model provider is selected.
 */
export class JsonNarrativeMemoryExtractor implements NarrativeMemoryExtractor {
  constructor(
    private readonly extractJson: (
      input: ProcessTurnInput,
      context: ExtractionContext,
    ) => Promise<unknown> | unknown,
  ) {}

  async extract(input: ProcessTurnInput, context: ExtractionContext): Promise<ExtractionResult> {
    return extractionResultSchema.parse(await this.extractJson(input, context));
  }
}
