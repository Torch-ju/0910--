import { z } from "zod";

const nonEmpty = z.string().trim().min(1);

export const narrativeSegmentSchema = z.object({
  segmentId: nonEmpty,
  kind: z.enum(["narration", "dialogue", "event"]),
  text: nonEmpty,
  order: z.number().int().nonnegative(),
  speakerName: nonEmpty.optional(),
});

export const processTurnInputSchema = z.object({
  requestId: nonEmpty,
  storyId: nonEmpty,
  chapterNo: z.number().int().positive(),
  sceneNo: z.number().int().positive(),
  turnId: nonEmpty,
  narrative: z.object({
    text: nonEmpty,
    segments: z.array(narrativeSegmentSchema).optional(),
  }),
  storyTime: nonEmpty.optional(),
  previousMemoryVersion: z.number().int().nonnegative().optional(),
});

const evidenceInputSchema = z.object({
  sourceKind: z.enum([
    "narration",
    "explicit_identity_reveal",
    "user_confirmation",
    "character_statement",
    "other_character_statement",
    "agent_inference",
  ]),
  segmentId: nonEmpty,
  quote: nonEmpty,
  confidence: z.number().min(0).max(1),
});

export const extractionResultSchema = z.object({
  mentions: z.array(
    z.object({
      ref: nonEmpty,
      displayName: nonEmpty,
      evidence: evidenceInputSchema,
      characterIdHint: nonEmpty.optional(),
      forceNewIdentity: z.boolean().optional(),
      aliases: z.array(nonEmpty).optional(),
      provisional: z.boolean().optional(),
    }),
  ),
  events: z.array(
    z.object({
      eventKey: nonEmpty,
      summary: nonEmpty,
      participantRefs: z.array(nonEmpty).min(1),
      importance: z.number().min(0).max(1),
      evidence: evidenceInputSchema,
    }),
  ),
  facts: z.array(
    z.object({
      subjectRef: nonEmpty,
      key: nonEmpty,
      value: nonEmpty,
      inference: z.boolean(),
      temporal: z.enum(["static", "state"]).optional(),
      correctionIntent: z.boolean().optional(),
      evidence: evidenceInputSchema,
    }),
  ),
  relationships: z.array(
    z.object({
      fromRef: nonEmpty,
      toRef: nonEmpty,
      type: nonEmpty,
      description: nonEmpty,
      importance: z.number().min(0).max(1),
      evidence: evidenceInputSchema,
    }),
  ),
  identities: z.array(
    z.object({
      leftRef: nonEmpty,
      rightRef: nonEmpty,
      relation: z.enum(["same_person", "different_person", "alias_of"]),
      evidence: evidenceInputSchema,
    }),
  ),
});
