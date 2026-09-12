import { z } from "zod";
import { processTurnInputSchema, extractionResultSchema } from "../../../memory-agent/src/contracts";
import { memoryCommandSchema } from "./management-schema";
const timestamp = z.string().datetime();
const base = z.object({ version: z.literal(1), revision: z.number().int().positive(), snapshot: z.object({}).passthrough(), summary: z.object({ summary: z.string(), unresolved_threads: z.array(z.string()) }), current_time: z.string(), current_location: z.string(),
  turns: z.array(z.object({ id: z.string(), chapter: z.number().int().positive(), input: z.string(), prose: z.object({}).passthrough(), memory: z.object({}).passthrough(), created_at: timestamp }).strict()),
  chapters: z.array(z.object({ id: z.string(), number: z.number().int().positive(), source_turn_ids: z.array(z.string()), content: z.string(), summary: z.object({ summary: z.string(), unresolved_threads: z.array(z.string()) }) }).strict()),
  runs: z.array(z.object({ operation_id: z.string(), fingerprint: z.string(), base_revision: z.number().int().positive(), input: z.string().min(1).max(12000), close_chapter: z.boolean(), status: z.enum(["running", "blocked", "succeeded", "abandoned"]), steps: z.record(z.string(), z.unknown()), error: z.string().optional(), created_at: timestamp }).strict()),
  memory_journal: z.array(z.object({ input: processTurnInputSchema, extraction: extractionResultSchema, created_at: timestamp }).strict()),
  seed_snapshot: z.object({}).passthrough().optional(),
  audit: z.array(z.object({ operation_id: z.string(), action: z.string(), fingerprint: z.string(), created_at: timestamp, detail: z.unknown() }).strict()).optional(),
  memory_actions: z.array(z.object({ after_turn: z.number().int().nonnegative(), operation_id: z.string(), created_at: timestamp, command: memoryCommandSchema }).strict()).optional(),
}).strict();
export function validateBackupShape(session: unknown) { return base.parse(session); }
