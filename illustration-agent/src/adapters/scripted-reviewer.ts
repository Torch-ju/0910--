import type { IllustrationAudit } from "../domain.js";
import type { IllustrationReviewer, ImageReviewContext } from "../ports.js";

type ReviewPayload = Omit<IllustrationAudit, "auditId" | "attemptId" | "createdAt">;

const PASS: ReviewPayload = {
  passed: true,
  scores: { narrativeMatch: 0.94, sceneStorytelling: 0.95, characterConsistency: 0.95, imageQuality: 0.92 },
  safetyPassed: true,
  reasons: [],
};

export class ScriptedIllustrationReviewer implements IllustrationReviewer {
  private callCount = 0;

  constructor(private readonly script: ReviewPayload[] = [PASS]) {}

  async review(_context: ImageReviewContext): Promise<ReviewPayload> {
    const selected = this.script[Math.min(this.callCount, this.script.length - 1)] ?? PASS;
    this.callCount += 1;
    return structuredClone(selected);
  }
}
