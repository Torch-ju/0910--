import type { StorySnapshot } from "@/lib/story/contracts";
import type { ExtractionResult, ProcessTurnInput, ProcessTurnResult } from "../../../memory-agent/src/domain";

export type RoleOutput = { content: string };
export type NarratorOutput = { current_time: string; current_location: string; background: string; visible_events: string[] };
export type ProseOutput = {
  content: string; current_time: string; current_location: string;
  new_facts: string[]; timeline_updates: string[]; foreshadowing: string[]; chapter_end_hook: string;
};
export type SummaryOutput = { summary: string; unresolved_threads: string[] };
export type MemoryEntry = { input: ProcessTurnInput; extraction: ExtractionResult; created_at: string };
export type Turn = { id: string; chapter: number; input: string; prose: ProseOutput; memory: ProcessTurnResult; created_at: string };
export type Chapter = { id: string; number: number; source_turn_ids: string[]; content: string; summary: SummaryOutput };
export type StepName = "roles" | "narrator" | "transcription" | "memory_extraction" | "memory_update" | "summary" | "chapter";
export const STEP_ORDER: StepName[] = ["roles", "narrator", "transcription", "memory_extraction", "memory_update", "summary", "chapter"];
export type Step = { status: "running" | "done" | "failed"; attempt: number; result?: unknown; error?: string };
export type Run = {
  operation_id: string; fingerprint: string; base_revision: number; input: string; close_chapter: boolean;
  status: "running" | "blocked" | "succeeded" | "abandoned"; steps: Partial<Record<StepName, Step>>; created_at: string; error?: string;
};
export type StorySession = {
  version: 1; revision: number; snapshot: StorySnapshot; summary: SummaryOutput;
  turns: Turn[]; chapters: Chapter[]; memory_journal: MemoryEntry[];
  current_time: string; current_location: string; runs: Run[];
  seed_snapshot?: StorySnapshot;
  audit?: { operation_id: string; action: string; fingerprint: string; created_at: string; detail: unknown }[];
  memory_actions?: { after_turn: number; operation_id: string; created_at: string; command: MemoryCommand }[];
  memory_checkpoint?: { turn_count: number; action_count: number; counter: number; state: import("../../../memory-agent/src/infrastructure/in-memory-repository").SerializedMemoryState };

};
export type TurnCommand = { story_id: string; operation_id: string; base_revision: number; input: string; close_chapter?: boolean; retry_failed?: boolean };
export class OrchestrationError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}

export type MemoryCommand =
  | { kind: "resolve_fact"; conflict_id: string; fact_id: string; reason: string; confirmed: true }
  | { kind: "acknowledge"; notification_id: string }
  | { kind: "merge"; source: string; target: string; reason: string; confirmed: true }
  | { kind: "split"; source: string; target: string; reason: string; confirmed: true; assignments: import("../../../memory-agent/src/domain").SplitCharacterInput["assignments"] };
export type ManageCommand = { story_id: string; operation_id: string; base_revision: number } & (
  { action: "close_chapter" } | { action: "abandon"; run_id: string } |
  { action: "sync"; snapshot: StorySnapshot; confirmed: true } |
  { action: "memory"; command: MemoryCommand }
);
