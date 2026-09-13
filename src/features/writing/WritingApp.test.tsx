// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callStoryApi, getProviderStatus } from "@/lib/api/story-client";
import { createCharacter, createTimelineEvent, fact } from "@/lib/story/factory";
import { useWorkbench } from "@/features/story/use-workbench";
import { WritingApp } from "./WritingApp";

vi.mock("@/lib/api/story-client", () => ({ callStoryApi: vi.fn(), getProviderStatus: vi.fn(), RequestError: class extends Error {} }));
const storyApi = vi.mocked(callStoryApi);

type Call = { url: string; body?: Record<string, unknown> };

function buildSession(snapshot: Record<string, unknown>) {
  return { version: 1, revision: 1, snapshot, summary: { summary: "", unresolved_threads: [] }, turns: [], chapters: [], memory_journal: [], current_time: "", current_location: "", runs: [] };
}

function Harness() { return <WritingApp {...useWorkbench()} />; }

beforeEach(() => {
  localStorage.clear(); storyApi.mockReset();
  vi.mocked(getProviderStatus).mockResolvedValue({ configured: true, model: "offline-test", used: 0, limit: 10, remaining: 10 });
  storyApi.mockImplementation(async (endpoint, body) => {
    if (endpoint === "framework") {
      const world = structuredClone(body.world);
      world.title = fact("银岬港");
      const opening = createTimelineEvent("故事开局");
      opening.period = "opening";
      world.timeline = [opening];
      return { world, recognition: { summary: "共同故事", character_clues: [], hard_constraints: [], ambiguities: [], questions: [] }, assistant_message: "世界已生成" };
    }
    const characters = structuredClone(body.characters);
    characters.characters = [createCharacter("沈砚"), createCharacter("林青")];
    return { characters, timeline_suggestions: [], warnings: [], assistant_message: "人物已生成" };
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("WritingApp chat entry", () => {
  it("turns one chat message into world, characters and the opening turn without a second click", async () => {
    const calls: Call[] = [];
    let stored: ReturnType<typeof buildSession> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      calls.push({ url, body });
      if (url.startsWith("/api/story/main?story_id=")) {
        return stored ? new Response(JSON.stringify(stored), { status: 200 }) : new Response(JSON.stringify({ error: { userMessage: "请先开始一个故事。" } }), { status: 404 });
      }
      if (url === "/api/story/main" && body?.action === "initialize") { stored = buildSession(body.snapshot as Record<string, unknown>); return new Response(JSON.stringify(stored), { status: 200 }); }
      if (url === "/api/story/tasks") return new Response(JSON.stringify({ task_id: body?.task_id, command: body?.command, status: "queued", created_at: "" }), { status: 202 });
      throw new Error("unexpected request " + url);
    }));

    render(<Harness />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText("故事想法"), { target: { value: "一个少年镖师护送一口空棺回乡。" } });
    fireEvent.click(screen.getByRole("button", { name: "开始故事" }));

    await waitFor(() => expect(calls.some(call => call.body?.action === "initialize")).toBe(true), { timeout: 5000 });
    expect(storyApi).toHaveBeenCalledWith("framework", expect.anything());
    expect(storyApi).toHaveBeenCalledWith("npcs", expect.anything());
    const opening = calls.find(call => call.url === "/api/story/tasks");
    expect(opening?.body?.command).toMatchObject({ operation_id: expect.stringContaining("op_opening_"), close_chapter: false });
    await waitFor(() => expect(screen.getByLabelText("接下来写什么（可留空）")).toBeTruthy());
  });

  it("keeps the workbench reachable from the chat entry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { userMessage: "offline" } }), { status: 404 })));
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "故事设定" }));
    expect(screen.getByText("带着设定开始写")).toBeTruthy();
    expect(screen.getByRole("button", { name: "开始写作" })).toBeTruthy();
  });
});
