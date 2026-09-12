// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callStoryApi, getProviderStatus } from "@/lib/api/story-client";
import { createCharacter, createTimelineEvent, fact } from "@/lib/story/factory";
import { STORAGE_KEY, serializeWorkspace } from "@/lib/story/storage";
import { useWorkbench } from "./use-workbench";
vi.mock("@/lib/api/story-client", () => ({ callStoryApi: vi.fn(), getProviderStatus: vi.fn(), RequestError: class extends Error {} }));
const api = vi.mocked(callStoryApi);
beforeEach(() => {
  localStorage.clear(); api.mockReset();
  vi.mocked(getProviderStatus).mockResolvedValue({ configured: true, model: "offline-test", used: 0, limit: 10, remaining: 10 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("shared context and initialization orchestration", () => {
  it("automatically fills visible world timeline and NPC modules from the combined result", async () => {
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
    expect(api).toHaveBeenCalledTimes(2);
    expect(result.current.model.snapshot.world.title.value).toBe("银岬港");
    expect(result.current.model.candidate).toBeNull();
    expect(api.mock.calls[1][1].context?.story_idea).toContain("只有两名核心人物");
    expect(api.mock.calls[1][1].context?.user_notes).toEqual([]);
    expect(result.current.model.snapshot.characters.characters).toHaveLength(2);
    expect(result.current.model.snapshot.world.timeline.some(e => e.period === "opening")).toBe(true);
    expect(api).toHaveBeenCalledTimes(2);
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
  it("automatically applies local field suggestions without changing the common idea", async () => {
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
    expect(result.current.model.snapshot.world.themes.value).toEqual(["个人选择"]);
    expect(result.current.model.candidate).toBeNull();
    act(() => result.current.actions.editFact("world", "/title", "用户另起的标题"));
    expect(result.current.model.candidateCanApply).toBe(false);
    act(() => result.current.actions.acceptCandidate());
    expect(result.current.model.snapshot.world.themes.value).toEqual(["个人选择"]);
    expect(result.current.model.snapshot.world.title.value).toBe("用户另起的标题");
    expect(result.current.model.snapshot.input).toBe("一个东方江湖故事");
  });
});

it("retains the world after NPC failure and retries without regenerating it or answering missing-detail questions", async () => {
  let attempts = 0;
  api.mockImplementation(async (endpoint, body) => {
    if(endpoint === "framework") {
      const world = structuredClone(body.world); world.title = fact("雨夜客栈");
      const opening = createTimelineEvent("雨夜到店"); opening.period = "opening"; world.timeline = [opening];
      world.open_questions = [{ question_id:"origin", question:"出身？", importance:"high", blocking:true, status:"open", answer:null }];
      return {world, recognition:{summary:"输入识别",character_clues:[],hard_constraints:[],ambiguities:[],questions:[{question:"出身？",blocking:true}]},assistant_message:"世界建议"};
    }
    attempts++; if(attempts===1) throw new Error("NPC unavailable");
    expect(body.world.timeline).toHaveLength(1);
    const characters = structuredClone(body.characters); characters.characters = [createCharacter("林青")];
    return {characters,timeline_suggestions:[],warnings:[],assistant_message:"画像建议"};
  });
  const {result} = renderHook(() => useWorkbench());
  await waitFor(() => expect(result.current.model.restored).toBe(true));
  act(() => result.current.actions.setInput("我在雨夜客栈开始江湖旅途"));
  await act(async () => {await result.current.actions.generateFramework();});
  expect(result.current.model.candidate).toBeNull();
  expect(result.current.model.snapshot.world.title.value).toBe("雨夜客栈");
  await act(async () => {await result.current.actions.generateNpcs();});
  expect(api.mock.calls.map(call => call[0])).toEqual(["framework","npcs","npcs"]);
  act(() => result.current.actions.acceptCandidate());
  expect(result.current.model.snapshot.characters.characters).toHaveLength(1);
  expect(result.current.model.snapshot.world.open_questions[0].status).toBe("open");
});

it("automatically resumes the exact saved request after refresh without asking for confirmation", async () => {
  const first=renderHook(()=>useWorkbench());
  await waitFor(()=>expect(first.result.current.model.restored).toBe(true));
  act(()=>{first.result.current.actions.setAutoNpcs(false);first.result.current.actions.setInput("雨夜客栈");});
  api.mockRejectedValueOnce(new Error("disconnect"));
  await act(async()=>{await first.result.current.actions.generateFramework();});
  const savedBody=structuredClone(api.mock.calls[0][1]);
  act(()=>first.result.current.actions.save());first.unmount();
  api.mockImplementation(async(endpoint,body)=>{
    if(endpoint==="framework") {expect(body).toEqual(savedBody);const world=structuredClone(body.world);world.title=fact("雨夜客栈");return {world,recognition:{summary:"雨夜",character_clues:[],hard_constraints:[],ambiguities:[],questions:[]},assistant_message:"世界"};}
    return {characters:body.characters,timeline_suggestions:[],warnings:[],assistant_message:"人物"};
  });
  const confirm=vi.spyOn(window,"confirm");
  const second=renderHook(()=>useWorkbench());
  await waitFor(()=>expect(second.result.current.model.snapshot.world.title.value).toBe("雨夜客栈"));
  expect(confirm).not.toHaveBeenCalled();
  expect(second.result.current.model.error).toBeNull();
});

it("regenerates the visible modules from edited ideas and automatically includes NPC history",async()=>{
  api.mockImplementation(async(endpoint,body)=>{
    const idea=body.context!.story_idea;
    if(endpoint === "framework") {
      const world=structuredClone(body.world);world.title=fact(idea.includes("山崖")?"山崖奇遇":"街头乞儿");world.summary=fact(idea);
      const opening=createTimelineEvent(world.title.value);opening.period="opening";world.timeline=[opening];
      return {world,recognition:{summary:idea,character_clues:[],hard_constraints:[],ambiguities:[],questions:[]},assistant_message:"世界"};
    }
    const characters=structuredClone(body.characters);characters.characters=[createCharacter("主角","npc_hero")];characters.characters[0].background=fact(idea);
    const event=createTimelineEvent(idea.includes("山崖")?"坠崖获奇遇":"被逐出家族");event.period="history";
    return {characters,timeline_suggestions:[event],warnings:[],assistant_message:"画像"};
  });
  const {result}=renderHook(()=>useWorkbench());await waitFor(()=>expect(result.current.model.restored).toBe(true));
  act(()=>result.current.actions.setInput("左手断腕，被逐出家族，街头乞讨"));
  await act(async()=>{await result.current.actions.generateFramework();});
  expect(result.current.model.snapshot.world.title.value).toBe("街头乞儿");
  act(()=>result.current.actions.setInput("左手断腕，自学成才，无门无派，掉落山崖获得奇遇"));
  await act(async()=>{await result.current.actions.generateFramework();});
  expect(result.current.model.snapshot.world.title.value).toBe("山崖奇遇");
  expect(result.current.model.snapshot.characters.characters[0].background.value).toContain("无门无派");
  expect(result.current.model.snapshot.world.timeline).toHaveLength(2);
  expect(result.current.model.snapshot.timeline_suggestions).toEqual([]);
  expect(result.current.model.candidate).toBeNull();expect(api).toHaveBeenCalledTimes(4);
  expect(api.mock.calls[2][1].context?.user_notes).toEqual([]);
});


it("displays and persists the world while NPC generation is still pending", async () => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  api.mockImplementation(async (endpoint, body) => {
    if(endpoint === "framework") {
      const world = structuredClone(body.world); world.title = fact("先显示的世界");
      return {world, recognition:{summary:"世界",character_clues:[],hard_constraints:[],ambiguities:[],questions:[]},assistant_message:"世界已生成"};
    }
    await waiting;
    return {characters:body.characters,timeline_suggestions:[],warnings:[],assistant_message:"人物已生成"};
  });
  const {result} = renderHook(() => useWorkbench());
  await waitFor(() => expect(result.current.model.restored).toBe(true));
  act(() => result.current.actions.setInput("雨夜江湖"));
  let generation!: Promise<void>;
  act(() => {generation = result.current.actions.generateFramework();});
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  expect(result.current.model.busy).toBe(true);
  expect(result.current.model.snapshot.world.title.value).toBe("先显示的世界");
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
  expect(saved.current.world.title.value).toBe("先显示的世界");
  expect(saved.pending.endpoint).toBe("npcs");
  expect(api.mock.calls[1][1].base_revision).toBe(saved.current.snapshot_revision);
  await act(async () => {release(); await generation;});
});

it("automatically adopts a saved candidate on refresh without calling the model", async () => {
  const first=renderHook(()=>useWorkbench());
  await waitFor(()=>expect(first.result.current.model.restored).toBe(true));
  act(()=>first.result.current.actions.setInput("旧候选故事"));
  const current=structuredClone(first.result.current.model.snapshot),world=structuredClone(current.world);
  world.title=fact("自动恢复标题");
  first.unmount();
  localStorage.setItem(STORAGE_KEY,serializeWorkspace({version:1,current,previous:null,pending:null,saved_at:new Date().toISOString(),candidate:{operation_id:"op_saved_candidate",base_revision:current.snapshot_revision,fingerprint:"saved",world,characters:current.characters,recognition:null,timeline_suggestions:[],summary:"恢复结果",warnings:[],origin:"field"}}));
  const confirm=vi.spyOn(window,"confirm");
  const next=renderHook(()=>useWorkbench());
  await waitFor(()=>expect(next.result.current.model.snapshot.world.title.value).toBe("自动恢复标题"));
  expect(next.result.current.model.candidate).toBeNull();expect(api).not.toHaveBeenCalled();expect(confirm).not.toHaveBeenCalled();
});
it("keeps edits made during generation and automatically applies the other generated fields", async () => {
  let release!:()=>void;
  api.mockImplementation(async(_endpoint,body)=>{
    await new Promise<void>(resolve=>{release=resolve;});
    const world=structuredClone(body.world);world.title=fact("模型标题");world.summary=fact("新摘要");
    return {world,warnings:[],assistant_message:"改动"};
  });
  const {result}=renderHook(()=>useWorkbench());
  await waitFor(()=>expect(result.current.model.restored).toBe(true));
  act(()=>result.current.actions.setInput("江湖故事"));
  let request!:Promise<void>;
  act(()=>{request=result.current.actions.revise("world","丰富设定");});
  act(()=>result.current.actions.editFact("world","/title","我的标题"));
  await act(async()=>{release();await request;});
  expect(result.current.model.snapshot.world.title.value).toBe("我的标题");
  expect(result.current.model.snapshot.world.summary.value).toBe("新摘要");
  expect(result.current.model.candidate).toBeNull();expect(result.current.model.error).toBeNull();
  act(()=>result.current.actions.undo());
  expect(result.current.model.snapshot.world.title.value).toBe("我的标题");
  expect(result.current.model.snapshot.world.summary.value).toBe("");
});
