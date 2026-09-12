// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoryWorkbench } from "./StoryWorkbench";
import { createSnapshot, fact } from "@/lib/story/factory";
import { editFact as editStoryFact } from "@/lib/story/state";
import type { WorkbenchActions, WorkbenchModel } from "@/lib/story/contracts";

function actions(): WorkbenchActions {
  return {
    setPreset: vi.fn(), setInput: vi.fn(), generateFramework: vi.fn(async () => undefined), generateNpcs: vi.fn(async () => undefined), revise: vi.fn(async () => undefined), suggestField: vi.fn(async () => undefined), setAutoNpcs: vi.fn(),
    editFact: vi.fn(), setFactStatus: vi.fn(), toggleLock: vi.fn(), confirmAll: vi.fn(), addCharacter: vi.fn(), removeCharacter: vi.fn(), mergeCharacters: vi.fn(),
    addTimelineEvent: vi.fn(), removeTimelineEvent: vi.fn(), editTimelineMeta: vi.fn(), acceptCandidate: vi.fn(), rejectCandidate: vi.fn(), acceptTimelineSuggestion: vi.fn(), rejectTimelineSuggestion: vi.fn(),
    undo: vi.fn(), save: vi.fn(), exportJson: vi.fn(), restart: vi.fn(), clearData: vi.fn(), startNewAttempt: vi.fn(async () => undefined), dismissError: vi.fn(), answerQuestion: vi.fn(),
  };
}
function model(): WorkbenchModel {
  return { snapshot: createSnapshot(), busy: false, stage: "等待创作", error: null, savedAt: null, candidate: null, issues: [], candidateCanApply: false, autoNpcs: true, provider: { configured: false, model: null, used: 0, limit: 10, remaining: 10, configuration_error: "尚未配置模型" }, canUndo: false, canStartNewAttempt: false, restored: false };
}

describe("StoryWorkbench", () => {
  afterEach(cleanup);

  it("renders the two approved presets and forwards story input", () => {
    const handler = actions(); render(<StoryWorkbench model={model()} actions={handler} />);
    expect((screen.getByRole("radio", { name: "西方魔幻" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("radio", { name: "东方武侠" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("故事想法"), { target: { value: "一座临海的孤城。" } });
    expect(handler.setInput).toHaveBeenCalledWith("一座临海的孤城。");
  });

  it("switches to the deliberately empty NPC workspace", () => {
    render(<StoryWorkbench model={model()} actions={actions()} />);
    fireEvent.click(screen.getByRole("button", { name: "NPC画像" }));
    expect(screen.getByText("人物尚未出现。先写下世界，或亲自添入第一个名字。")).toBeTruthy();
  });

  it("removes the decorative opening section and exposes clear data", () => {
    const handler = actions();
    render(<StoryWorkbench model={model()} actions={handler} />);
    expect(screen.queryByRole("heading", { name: "让故事，从一处可信的空白生长。" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清空数据" }));
    expect(handler.clearData).toHaveBeenCalledOnce();
  });

  it("commits a fact through the real JSON Pointer state contract on blur", () => {
    const current = model(); current.snapshot.world.title = fact("旧标题"); let snapshot = current.snapshot; const handler = actions();
    handler.editFact = (document, path, value) => { snapshot = editStoryFact(snapshot, document, path, value); };
    render(<StoryWorkbench model={current} actions={handler} />);
    const title = screen.getByLabelText("故事名称"); fireEvent.change(title, { target: { value: "新标题" } });
    expect(snapshot.world.title.value).toBe("旧标题"); fireEvent.blur(title);
    expect(snapshot.world.title.value).toBe("新标题"); expect(snapshot.world.title.source).toBe("user_edited");
  });

  it("offers an explicit new-billed retry only when the hook permits it", () => {
    const current = model(); current.canStartNewAttempt = true; const handler = actions();
    render(<StoryWorkbench model={current} actions={handler} />);
    fireEvent.click(screen.getByRole("button", { name: "重新发起（可能计费）" }));
    expect(handler.startNewAttempt).toHaveBeenCalledOnce();
  });
});
