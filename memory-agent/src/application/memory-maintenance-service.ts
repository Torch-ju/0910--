import {
  type PortraitSnapshot,
  type SplitCharacterInput,
  type SplitCharacterResult,
} from "../domain.js";
import type {
  Clock,
  IdGenerator,
  MemoryRepository,
  PortraitSchemaAdapter,
} from "../ports.js";
import { MemoryVersionConflictError, SystemClock, UuidGenerator } from "./memory-agent.js";

export class MemoryMaintenanceService<TPortrait = unknown> {
  constructor(
    private readonly repository: MemoryRepository,
    private readonly portraitAdapter: PortraitSchemaAdapter<TPortrait>,
    private readonly ids: IdGenerator = new UuidGenerator(),
    private readonly clock: Clock = new SystemClock(),
  ) {}

  listPendingNotifications(storyId: string) {
    return this.repository.listPendingNotifications(storyId);
  }

  markNotificationStatus(
    storyId: string,
    notificationId: string,
    status: "delivered" | "acknowledged",
  ) {
    return this.repository.updateNotificationStatus(storyId, notificationId, status);
  }

  async splitIncorrectMerge(input: SplitCharacterInput): Promise<SplitCharacterResult<TPortrait>> {
    if (!input.userConfirmed) {
      throw new Error("Splitting a character requires explicit user confirmation");
    }
    if (!input.reason.trim()) throw new Error("A split reason is required");

    return this.repository.transaction(input.storyId, async (tx) => {
      const currentVersion = await tx.getMemoryVersion(input.storyId);
      if (currentVersion !== input.previousMemoryVersion) {
        throw new MemoryVersionConflictError(input.previousMemoryVersion, currentVersion);
      }
      const source = await tx.getCharacter(input.sourceMergedCharacterId);
      if (
        !source ||
        source.status !== "merged" ||
        source.mergedIntoCharacterId !== input.currentCanonicalCharacterId
      ) {
        throw new Error("The requested source is not merged into the specified canonical character");
      }

      const memoryVersion = currentVersion + 1;
      await tx.splitCharacter(input, memoryVersion);
      const portraits: Array<PortraitSnapshot<TPortrait>> = [];
      for (const characterId of [input.sourceMergedCharacterId, input.currentCanonicalCharacterId]) {
        const character = await tx.getCharacter(characterId);
        if (!character) throw new Error(`Character not found after split: ${characterId}`);
        const snapshot: PortraitSnapshot<TPortrait> = {
          snapshotId: this.ids.next("portrait"),
          storyId: input.storyId,
          characterId,
          memoryVersion,
          schemaVersion: this.portraitAdapter.schemaVersion,
          portrait: this.portraitAdapter.project({
            character,
            aliases: await tx.listAliases(characterId),
            activeFacts: await tx.listActiveFacts(characterId),
            events: await tx.listEvents(characterId),
            relationships: await tx.listRelationships(characterId),
            memoryVersion,
          }),
          createdAt: this.clock.now(),
        };
        await tx.savePortrait(snapshot);
        portraits.push(snapshot);
      }
      await tx.setMemoryVersion(input.storyId, memoryVersion);
      return {
        storyId: input.storyId,
        requestId: input.requestId,
        memoryVersion,
        restoredCharacterId: input.sourceMergedCharacterId,
        currentCanonicalCharacterId: input.currentCanonicalCharacterId,
        portraits,
      };
    });
  }
}
