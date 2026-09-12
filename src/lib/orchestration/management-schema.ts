import { z } from "zod";
const id = z.string().regex(/^[a-z][a-z0-9_-]{2,95}$/);
const assignment = z.object({ factIds: z.array(z.string()), aliasIds: z.array(z.string()), eventIds: z.array(z.string()), relationshipEndpoints: z.array(z.object({ relationshipId: z.string(), endpoint: z.enum(["from", "to"]) }).strict()) }).strict();
export const memoryCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("resolve_fact"), conflict_id: z.string().min(1), fact_id: z.string().min(1), reason: z.string().trim().min(1).max(2000), confirmed: z.literal(true) }).strict(),
  z.object({ kind: z.literal("acknowledge"), notification_id: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("merge"), source: id, target: id, reason: z.string().trim().min(1).max(2000), confirmed: z.literal(true) }).strict(),
  z.object({ kind: z.literal("split"), source: id, target: id, reason: z.string().trim().min(1).max(2000), confirmed: z.literal(true), assignments: assignment }).strict(),
]);
