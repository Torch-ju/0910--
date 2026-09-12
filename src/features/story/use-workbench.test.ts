// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callStoryApi, getProviderStatus } from "@/lib/api/story-client";
import { createCharacter, createTimelineEvent, fact } from "@/lib/story/factory";
import { STORAGE_KEY } from "@/lib/story/storage";
import { useWorkbench } from "./use-workbench";
vi.mock("@/lib/api/story-client", () => ({ callStoryApi: vi.fn(), getProviderStatus: vi.fn(), RequestError: class extends Error {} }));
const api = vi.mocked(callStoryApi);
beforeEach(() => {
  localStorage.clear(); api.mockReset();
  vi.mocked(getProviderStatus).mockResolvedValue({ configured: true, model: "offline-test", used: 0, limit: 10, remaining: 10 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("shared context and initialization orchestration", () => {
  it("starts NPC generation only after adopting the world, without auto-adopting NPCs", async () => {
    api.mockImplementation(async (endpoint, body) => {
      if (endpoint === "framework") {
        const world = structuredClone(body.world); world.title = fact("银岬港");
        const opening = createTimelineEvent("故事开局"); opening.period = "opening"; world.timeline = [opening];
        return { world, recognition: { summary: "共同故事", character_clues: [], hard_constraints: [], ambiguities: [], questions: [] }, assistant_message: "世界建议" };
      }
      const characters = structuredClone(body.characters); characters.characters = [createCharacter("艾琳"), createCharacter("洛安")];
      return { characters, timeline_suggestions: [], warnings: [], assistant_message: "人物建议" };
    });
    const { result } = renderHook(() => useWorkbench());
    await waitFor(() => expect(result.current.model.restored).toBe(true));
    act(() => result.current.actions.setInput("西方港口，只有两名核心人物：艾琳和洛安。"));
    await act(async () => { await result.current.actions.generateFramework(); });
    expect(api).toHaveBeenCalledTimes(1);
    expect(result.current.model.snapshot.world.title.value).toBe("");
    expect(result.current.model.candidateCanApply).toBe(true);
    act(() => result.current.actions.acceptCandidate());
    await waitFor(() => expect(result.current.model.candidate?.origin).toBe("npcs"));
    expect(api).toHaveBeenCalledTimes(2);
    expect(api.mock.calls[1][1].context?.story_idea).toContain("只有两名核心人物");
    expect(result.current.model.snapshot.world.title.value).toBe("银岬港");
    expect(result.current.model.snapshot.characters.characters).toHaveLength(0);
    act(() => result.current.actions.acceptCandidate());
    expect(result.current.model.snapshot.characters.characters).toHaveLength(2);
  });
  it("clears the workspace and archived snapshots without recreating storage", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderHook(() => useWorkbench());
    await waitFor(() => expect(result.current.model.restored).toBe(true));
    localStorage.setItem(STORAGE_KEY, "saved-workspace");
    localStorage.setItem(STORAGE_KEY + ".archive.story.1", "archived-workspace");
    act(() => result.current.actions.clearData());
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY + ".archive.story.1")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(result.current.model.stage).toBe("本地数据已清空");
    confirm.mockRestore();
  });
  it("keeps local field instructions separate from the common idea and waits for adoption", async () => {
    api.mockImplementation(async (_endpoint, body) => {
      const world = structuredClone(body.world); world.themes = fact(["个人选择"]);
      return { world, warnings: [], assistant_message: "主题建议" };
    });
    const { result } = renderHook(() => useWorkbench());
    await waitFor(() => expect(result.current.model.restored).toBe(true));
    act(() => result.current.actions.setInput("一个东方江湖故事"));
    await act(async () => { await result.current.actions.suggestField("world", "/themes", "不要救世主题"); });
    const body = api.mock.calls[0][1];
    expect(body.context?.story_idea).toBe("一个东方江湖故事");
    expect(body.input).toBe("不要救世主题");
    expect(body.field).toEqual({ document: "world", path: "/themes" });
    expect(result.current.model.snapshot.world.themes.value).toEqual([]);
    act(() => result.current.actions.editFact("world", "/title", "用户另起的标题"));
    expect(result.current.model.candidateCanApply).toBe(true);
    act(() => result.current.actions.acceptCandidate());
    expect(result.current.model.snapshot.world.themes.value).toEqual(["个人选择"]);
    expect(result.current.model.snapshot.world.title.value).toBe("用户另起的标题");
    expect(result.current.model.snapshot.input).toBe("一个东方江湖故事");
  });
});
