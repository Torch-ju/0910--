// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationHome, type ConversationHomeProps } from "./ConversationHome";
import { createSnapshot, fact } from "@/lib/story/factory";
import type { WorkbenchModel } from "@/lib/story/contracts";
import type { StorySession, Turn } from "@/lib/orchestration/contracts";

function model(overrides: Partial<WorkbenchModel> = {}): WorkbenchModel {
  return { snapshot: createSnapshot(), busy: false, stage: "等待你的故事", error: null, savedAt: null, candidate: null, issues: [], candidateCanApply: false, autoNpcs: true, provider: null, canUndo: false, canStartNewAttempt: false, restored: true, ...overrides };
}

function turn(id: string, content: string): Turn {
  return { id, chapter: 1, input: "", created_at: "", prose: { content, current_time: "清晨", current_location: "驿道", new_facts: [], timeline_updates: [], foreshadowing: [], chapter_end_hook: "", dialogue: null }, memory: {} } as unknown as Turn;
}

function session(turns: Turn[] = []): StorySession {
  return { version: 1, revision: 1, snapshot: createSnapshot(), summary: { summary: "", unresolved_threads: [] }, turns, chapters: [], memory_journal: [], current_time: "", current_location: "", runs: [] };
}

function props(overrides: Partial<ConversationHomeProps> = {}): ConversationHomeProps {
  return {
    model: model(), session: null, title: "未命名故事", idea: "", onIdeaChange: vi.fn(),
    task: null, busy: false, running: false, waiting: true, conversation: null, continuation: null, dialogue: null,
    input: "", onInput: vi.fn(), close: false, onClose: vi.fn(),
    onStart: vi.fn(), onSubmit: vi.fn(), onOpenWorkbench: vi.fn(), onRefresh: vi.fn(), onExport: vi.fn(),
    onCancelTask: vi.fn(), onToggleWaiting: vi.fn(), onAbandon: vi.fn(),
    ...overrides,
  };
}

describe("ConversationHome", () => {
  afterEach(cleanup);

  it("starts the whole story from a single chat message", () => {
    const handler = props({ idea: "一个少年镖师护送一口空棺回乡。" });
    render(<ConversationHome {...handler} />);
    fireEvent.click(screen.getByRole("button", { name: "开始故事" }));
    expect(handler.onStart).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("故事想法")).toBeTruthy();
  });

  it("keeps the start button disabled while there is no idea", () => {
    render(<ConversationHome {...props({ idea: "   " })} />);
    expect((screen.getByRole("button", { name: "开始故事" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("collapses the generated world into one card that opens the workbench", () => {
    const current = model(); current.snapshot.world.title = fact("雨夜来信");
    const handler = props({ model: current });
    render(<ConversationHome {...handler} />);
    expect(screen.getByText("世界观和人物已经就绪")).toBeTruthy();
    expect(screen.queryByLabelText("故事名称")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看和修改设定" }));
    expect(handler.onOpenWorkbench).toHaveBeenCalledOnce();
  });

  it("shows committed prose and continues the story from the same input box", () => {
    const handler = props({ session: session([turn("turn_1", "雨敲着窗。")]), title: "雨夜来信" });
    render(<ConversationHome {...handler} />);
    expect(screen.getByRole("heading", { name: "雨夜来信" })).toBeTruthy();
    expect(screen.getByText("雨敲着窗。")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("接下来写什么（可留空）"), { target: { value: "推进到两人的对话。" } });
    expect(handler.onInput).toHaveBeenCalledWith("推进到两人的对话。");
    fireEvent.click(screen.getByRole("button", { name: "继续写" }));
    expect(handler.onSubmit).toHaveBeenCalledOnce();
  });

  it("shows a waiting marker while the world is being generated", () => {
    const current = model(); current.busy = true; current.stage = "正在理解你的想法，整理世界观与历史";
    render(<ConversationHome {...props({ model: current })} />);
    expect(screen.getByText("正在生成世界观、人物和开篇")).toBeTruthy();
    expect(screen.getByText("正在理解你的想法，整理世界观与历史")).toBeTruthy();
  });

  it("shows the live step row while a turn is evolving", () => {
    const evolving = session();
    evolving.runs = [{ operation_id: "op_1", fingerprint: "f", base_revision: 1, input: "继续", close_chapter: false, status: "running", steps: { roles: { status: "done", attempt: 1 }, transcription: { status: "running", attempt: 1 } }, created_at: new Date().toISOString() }];
    render(<ConversationHome {...props({ session: evolving, running: true, unfinished: evolving.runs[0], task: { task_id: "task_1", command: { story_id: "s", operation_id: "op_1", base_revision: 1, input: "继续" }, status: "running", created_at: "" } })} />);
    expect(screen.getByText("正在往下写这一段")).toBeTruthy();
    expect(screen.getByText("正文")).toBeTruthy();
    expect(screen.getByText("记忆整理")).toBeTruthy();
  });
  it("keeps the narrative input disabled while a turn is unfinished", () => {
    const running = session();
    running.runs = [{ operation_id: "op_1", fingerprint: "f", base_revision: 1, input: "继续", close_chapter: false, status: "running", steps: {}, created_at: "" }];
    render(<ConversationHome {...props({ session: running, running: true, unfinished: running.runs[0], task: { task_id: "task_1", command: { story_id: "s", operation_id: "op_1", base_revision: 1, input: "继续" }, status: "running", created_at: "" } })} />);
    expect((screen.getByRole("button", { name: "继续写" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "停止这次生成" })).toBeTruthy();
  });
});
