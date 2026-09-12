import { z } from "zod";

const nonBlank = z.string().trim().min(1);

export const narrativeSegmentSchema = z.object({
  segmentId: nonBlank,
  kind: z.enum(["dialogue", "narration", "event"]),
  text: nonBlank,
  order: z.number().int().nonnegative(),
  speakerName: nonBlank.optional(),
});

export const generateChapterIllustrationInputSchema = z.object({
  requestId: nonBlank,
  storyId: nonBlank,
  chapterNo: z.number().int().positive(),
  chapterVersion: z.number().int().positive(),
  chapterTitle: nonBlank.optional(),
  regenerationReason: nonBlank.optional(),
  narrative: z.object({
    segments: z.array(narrativeSegmentSchema).min(1),
  }),
}).superRefine((input, context) => {
  const ids = input.narrative.segments.map((segment) => segment.segmentId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["narrative", "segments"], message: "segmentId 必须唯一" });
  }
  const orders = input.narrative.segments.map((segment) => segment.order);
  if (new Set(orders).size !== orders.length) {
    context.addIssue({ code: "custom", path: ["narrative", "segments"], message: "order 必须唯一" });
  }
});

export const detectedCharacterSchema = z.object({
  displayName: nonBlank,
  role: z.enum(["main", "supporting"]),
  immutableTraits: z.array(nonBlank).max(30),
  dynamicTraits: z.array(nonBlank).max(30),
  wardrobeRules: z.array(nonBlank).max(30),
  evidenceSegmentIds: z.array(nonBlank).min(1),
});

export const chapterVisualAnalysisSchema = z.object({
  characters: z.array(detectedCharacterSchema).min(1),
  keyScene: z.object({
    theme: nonBlank,
    synopsis: nonBlank,
    environment: nonBlank,
    keyAction: nonBlank,
    subjectInteraction: nonBlank,
    composition: nonBlank,
    insertAfterSegmentId: nonBlank,
    evidenceSegmentIds: z.array(nonBlank).min(1),
    characterNames: z.array(nonBlank).min(1).max(3),
    caption: nonBlank,
    prompt: nonBlank,
    negativePrompt: z.string(),
  }),
});

export const visualBibleDraftInputSchema = z.object({
  storyId: nonBlank,
  novelTheme: nonBlank,
  genre: nonBlank,
  eraSetting: nonBlank,
  baseStyle: nonBlank,
  colorScript: nonBlank,
  lightingRules: nonBlank,
  compositionRules: nonBlank,
  forbiddenDrift: z.array(nonBlank).max(50).optional(),
});

export const novelVisualBibleSourceInputSchema = z.object({
  storyId: nonBlank,
  title: nonBlank.optional(),
  synopsis: nonBlank.optional(),
  segments: z.array(narrativeSegmentSchema).min(1),
});

export const visualBibleProposalSchema = z.object({
  novelTheme: nonBlank,
  genre: nonBlank,
  eraSetting: nonBlank,
  baseStyle: nonBlank,
  colorScript: nonBlank,
  lightingRules: nonBlank,
  compositionRules: nonBlank,
  forbiddenDrift: z.array(nonBlank).min(1).max(50),
});

export const characterVisualProfileInputSchema = z.object({
  storyId: nonBlank,
  characterId: nonBlank,
  displayName: nonBlank,
  role: z.enum(["main", "supporting"]),
  immutableTraits: z.array(nonBlank).min(1).max(30),
  dynamicTraits: z.array(nonBlank).max(30).optional(),
  wardrobeRules: z.array(nonBlank).max(30).optional(),
});

export const scenePlanSchema = z.object({
  planId: nonBlank,
  storyId: nonBlank,
  chapterNo: z.number().int().positive(),
  chapterVersion: z.number().int().positive(),
  theme: nonBlank,
  synopsis: nonBlank,
  environment: nonBlank,
  keyAction: nonBlank,
  subjectInteraction: nonBlank,
  composition: nonBlank,
  insertAfterSegmentId: nonBlank,
  anchorTextHash: z.string().regex(/^[a-f0-9]{64}$/),
  anchorQuote: nonBlank,
  evidenceSegmentIds: z.array(nonBlank).min(1),
  characterIds: z.array(nonBlank).min(1).max(3),
  caption: nonBlank,
  prompt: nonBlank,
  negativePrompt: nonBlank,
});

export const RECOMMENDED_WIDTH = 2560;
export const RECOMMENDED_HEIGHT = 1440;
export const DEFAULT_MAX_RETRIES = 3;
export const MAX_IMAGES_PER_CHAPTER = 1;
