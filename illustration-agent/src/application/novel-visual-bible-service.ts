import { novelVisualBibleSourceInputSchema } from "../contracts.js";
import type {
  NovelVisualBibleSourceInput,
  StoryVisualBible,
  VisualBibleDraftInput,
} from "../domain.js";
import type { NovelVisualBiblePlanner } from "../ports.js";
import { StoryVisualSetupService } from "./visual-setup-service.js";

export class NovelVisualBibleService {
  constructor(
    private readonly planner: NovelVisualBiblePlanner,
    private readonly setup: StoryVisualSetupService,
  ) {}

  async deriveDraft(rawInput: NovelVisualBibleSourceInput): Promise<StoryVisualBible> {
    const input = novelVisualBibleSourceInputSchema.parse(rawInput) as NovelVisualBibleSourceInput;
    const proposal = await this.planner.propose(input);
    const draft: VisualBibleDraftInput = {
      storyId: input.storyId,
      ...proposal,
    };
    return this.setup.saveDraft(draft);
  }
}
