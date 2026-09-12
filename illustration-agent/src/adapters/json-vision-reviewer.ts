import { z } from "zod";

import type { IllustrationAudit } from "../domain.js";
import type { IllustrationReviewer, ImageReviewContext, StructuredJsonModel } from "../ports.js";

const reviewSchema = z.object({
  passed: z.boolean(),
  scores: z.object({
    narrativeMatch: z.number().min(0).max(1),
    sceneStorytelling: z.number().min(0).max(1),
    characterConsistency: z.number().min(0).max(1),
    imageQuality: z.number().min(0).max(1),
  }),
  safetyPassed: z.boolean(),
  reasons: z.array(z.string()),
});

type ReviewPayload = Omit<IllustrationAudit, "auditId" | "attemptId" | "createdAt">;

const SYSTEM_PROMPT = `你是小说插图自动审核器。第一张图片是待审核插图，后续图片（若有）是人物标准参考图；参考图的背景和姿势不是章节画面依据。
分别检查：与本章证据和关键场景是否一致；是否完整呈现具体环境、关键动作、人物互动/人物对事件的反应以及空间关系；人物五官、发型、年龄感、体型是否与参考图一致；构图、肢体、清晰度是否合格；是否含明显血腥、断肢、内脏、色情、违法内容、文字、logo 或水印。
如果待审核图片更像人物写真、角色海报、单人静态站姿，或只是复用了参考图背景而没有故事事件，则 sceneStorytelling 必须不高于 0.40 且 passed 必须为 false。
不得因为画面美观而放宽剧情一致性。每项得分为 0–1。只有你认为可以直接在 Web 正文展示时 passed 才为 true。只输出 JSON。`;

export class JsonVisionIllustrationReviewer implements IllustrationReviewer {
  constructor(private readonly model: StructuredJsonModel) {}

  async review(context: ImageReviewContext): Promise<ReviewPayload> {
    const output = await this.model.completeJson({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: JSON.stringify({
        outputSchema: {
          passed: "boolean",
          scores: {
            narrativeMatch: "number 0-1",
            sceneStorytelling: "number 0-1；写真式画面不得高于 0.40",
            characterConsistency: "number 0-1",
            imageQuality: "number 0-1",
          },
          safetyPassed: "boolean",
          reasons: ["string"],
        },
        keyScene: context.plan,
        characterProfiles: context.characterProfiles.map((profile) => ({
          displayName: profile.displayName,
          immutableTraits: profile.immutableTraits,
          dynamicTraits: profile.dynamicTraits,
          wardrobeRules: profile.wardrobeRules,
        })),
      }),
      imageUrls: [context.imageUrl, ...context.referenceImageUrls],
    });
    return reviewSchema.parse(output) as ReviewPayload;
  }
}
