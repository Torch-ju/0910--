// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSnapshot } from "@/lib/story/factory";
import type { WorkbenchActions, WorkbenchModel } from "@/lib/story/contracts";
import { FieldAssistant } from "./FieldAssistant";
import { WorkbenchUiProvider } from "./WorkbenchUiContext";

function actions(): WorkbenchActions { return { setPreset: vi.fn(), setInput: vi.fn(), generateFramework: vi.fn(async () => undefined), generateNpcs: vi.fn(async () => undefined), revise: vi.fn(async () => undefined), suggestField: vi.fn(async () => undefined), setAutoNpcs: vi.fn(), editFact: vi.fn(), setFactStatus: vi.fn(), toggleLock: vi.fn(), confirmAll: vi.fn(), addCharacter: vi.fn(), removeCharacter: vi.fn(), mergeCharacters: vi.fn(), addTimelineEvent: vi.fn(), removeTimelineEvent: vi.fn(), editTimelineMeta: vi.fn(), acceptCandidate: vi.fn(), rejectCandidate: vi.fn(), acceptTimelineSuggestion: vi.fn(), rejectTimelineSuggestion: vi.fn(), undo: vi.fn(), save: vi.fn(), exportJson: vi.fn(), restart: vi.fn(), clearData: vi.fn(), dismissError: vi.fn(), answerQuestion: vi.fn(), startNewAttempt: vi.fn(async () => undefined) }; }
function model(): WorkbenchModel { return { snapshot: createSnapshot(), busy: false, stage: "等待创作", error: null, savedAt: null, candidate: null, issues: [], candidateCanApply: false, autoNpcs: true, provider: { configured: true, model: "test", used: 0, limit: 10, remaining: 10 }, canUndo: false, restored: true, canStartNewAttempt: false }; }
function mount(current = model(), handler = actions(), locked = false) { render(<WorkbenchUiProvider value={{ model: current, actions: handler }}><FieldAssistant document="world" path="/setting/era" locked={locked} /></WorkbenchUiProvider>); return { current, handler }; }

describe("FieldAssistant", () => {
  afterEach(cleanup);
  it("sends a scoped request without changing the shared story idea", () => { const { current, handler } = mount(); const idea = current.snapshot.input; fireEvent.click(screen.getByRole("button", { name: "AI建议" })); fireEvent.change(screen.getByLabelText("局部要求"), { target: { value: "突出王朝末期的压迫感" } }); fireEvent.click(screen.getByRole("button", { name: "请求建议" })); expect(handler.suggestField).toHaveBeenCalledWith("world", "/setting/era", "突出王朝末期的压迫感"); expect(current.snapshot.input).toBe(idea); expect(handler.setInput).not.toHaveBeenCalled(); });
  it.each(["locked", "busy", "candidate"])("disables requests when %s", (kind) => { const current = model(); if (kind === "busy") current.busy = true; if (kind === "candidate") current.candidate = {} as NonNullable<WorkbenchModel["candidate"]>; mount(current, actions(), kind === "locked"); expect((screen.getByRole("button", { name: "AI建议" }) as HTMLButtonElement).disabled).toBe(true); });
});
