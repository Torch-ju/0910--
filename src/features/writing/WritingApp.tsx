"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { WorkbenchProps } from "@/lib/story/contracts";
import type { ManageCommand, StorySession, TurnCommand } from "@/lib/orchestration/contracts";
import type { SerializedMemoryState } from "../../../memory-agent/src/infrastructure/in-memory-repository";
import type { NarrativeTask } from "@/lib/orchestration/tasks";
import { FactChanges } from "@/features/story/ui/StoryWorkbenchShell";
import { StoryWorkbench } from "@/features/story/ui/StoryWorkbench";
import { prepareCandidate } from "@/lib/story/candidate";
import { acceptCandidate } from "@/lib/story/state";
import { uid } from "@/lib/story/factory";
import { pendingDialogue } from "@/lib/orchestration/dialogue";
import { MemoryPanel } from "./MemoryPanel";
import { ConversationHome } from "./ConversationHome";
import { NarrativeCompose } from "./NarrativeCompose";
import { NarrativeProse } from "./NarrativeProse";
import "./writing.css";
const ACTIVE = "shuzhongren.active-story";
const taskKey = (id: string) => "shuzhongren.task." + id;
const draftKey = (id: string) => "shuzhongren.input." + id;
const evolvedKey = (id: string) => "shuzhongren.evolved." + id;
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw Error(data.error?.userMessage ?? "刚才的请求没有完成，点“刷新”看看最新进度。");
  return data;
}
export function download(name: string, text: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type: type + ";charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
type StoryList = { story_id: string; title: string; turns: number; chapters: number; error: string | null }[];
type View = "chat" | "setup" | "writing" | "library";
export function WritingApp(props: WorkbenchProps) {
  const [view, setView] = useState<View>("chat");
  const [session, setSession] = useState<StorySession | null>(null);
  const [stories, setStories] = useState<StoryList>([]);
  const [metrics, setMetrics] = useState<{ calls: number; repairs: number; failures: number; durationMs: number; promptTokens: number; completionTokens: number; usageMissing: number; estimatedCost: number | null } | null>(null);
  const [memory, setMemory] = useState<SerializedMemoryState | null>(null);
  const [panel, setPanel] = useState<"reading" | "memory" | "chapters" | "settings">("reading");
  const [input, setInput] = useState(""); const [close, setClose] = useState(false);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [task, setTask] = useState<NarrativeTask | null>(null);
  const [waiting, setWaiting] = useState(true);
  const guard = useRef(false);
  // The workbench state is owned by useWorkbench; the latest value is mirrored so initialize() can read it without being
  // re-created on every render (which would restart the auto-start effect).
  const latestModel = useRef(props.model);
  const evolveWorld = useRef<(runId: string, dialogue: boolean) => void>(() => {});
  const startRequested = useRef(false);
  useLayoutEffect(() => { latestModel.current = props.model; }, [props.model]);
  useLayoutEffect(() => {
    evolveWorld.current = (runId: string, dialogue: boolean) => {
      const id = session?.snapshot.world.story_id;
      if (!id || dialogue || props.model.busy || props.model.candidate) return;
      if (props.model.snapshot.world.story_id !== id) return;
      if (localStorage.getItem(evolvedKey(id)) === runId) return;
      localStorage.setItem(evolvedKey(id), runId);
      void props.actions.revise("timeline", "根据刚写完的这一段正文，把新出现的地点、事件、势力或时间推进补进世界年表；保留已有事件，不要改写。");
    };
  }, [session, props.model, props.actions]);
  const storyId = session?.snapshot.world.story_id;
  const update = useCallback((next: StorySession) => setSession(old => old?.snapshot.world.story_id === next.snapshot.world.story_id && old.revision > next.revision ? old : next), []);
  const attempt = useCallback(async (work: () => Promise<void>) => { if (guard.current) return; guard.current = true; setBusy(true); setError(""); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "操作没有完成，请再试一次。"); } finally { guard.current = false; setBusy(false); } }, []);
  const open = useCallback(async (id: string) => {
    const next = await api<StorySession>("/api/story/main?story_id=" + encodeURIComponent(id));
    setSession(next); setView("chat"); setMemory(null); setPanel("reading"); setTask(null); setWaiting(true);
    // Opening a story must also load its world/characters into the workbench; otherwise the world card and the setting diff compare two different stories.
    if (latestModel.current.snapshot.world.story_id !== id && props.actions.loadSnapshot) props.actions.loadSnapshot(next.snapshot);
    localStorage.setItem(ACTIVE, id); setInput(localStorage.getItem(draftKey(id)) ?? "");
    const pending = localStorage.getItem(taskKey(id));
    if (pending) {
      const saved = JSON.parse(pending) as NarrativeTask;
      if (next.runs.some(run => run.operation_id === saved.command.operation_id && ["succeeded", "abandoned", "waiting_dialogue"].includes(run.status))) { localStorage.removeItem(taskKey(id)); if (localStorage.getItem(draftKey(id)) === saved.command.input) { localStorage.removeItem(draftKey(id)); setInput(""); } }
      else setTask(saved);
    }
  }, []);
  useEffect(() => {
    let live = true;
    queueMicrotask(async () => { try { const id = localStorage.getItem(ACTIVE); if (id && live) await open(id); } catch (e) { if (live) setError(e instanceof Error ? e.message : "没能打开上次的故事。"); } });
    return () => { live = false; };
  }, [open]);
  const taskId = task?.task_id, taskStatus = task?.status;
  useEffect(() => {
    if (!taskId || !storyId || !waiting || !["queued", "running"].includes(taskStatus ?? "")) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const created = task?.created_at ? Date.parse(task.created_at) : 0;
      // A locally restored task whose server record is gone would otherwise poll forever.
      if (created && Date.now() - created > 8 * 60_000) { setTask(null); localStorage.removeItem(taskKey(storyId)); setError("这次生成已经过期（服务端不再有对应任务），可以重新开始一轮。"); return; }
      try {
        const current = await api<NarrativeTask>("/api/story/tasks?task_id=" + taskId);
        const next = await api<StorySession>("/api/story/main?story_id=" + storyId);
        if (stopped) return;
        update(next); setTask(current); localStorage.setItem(taskKey(storyId), JSON.stringify(current));
        if (current.status === "done" || current.status === "interrupted" || current.status === "cancelled") {
          const done = ["succeeded","waiting_dialogue"].includes(next.runs.find(run => run.operation_id === current.command.operation_id)?.status ?? "") || (!current.error && next.conversations?.some(c=>c.exchanges.some(e=>e.command.operation_id===current.command.operation_id && e.status==="done")));
          if (done) { setInput(old => old === current.command.input ? "" : old); if (localStorage.getItem(draftKey(storyId)) === current.command.input) localStorage.removeItem(draftKey(storyId)); localStorage.removeItem(taskKey(storyId)); setTask(null); setError(""); evolveWorld.current(current.command.operation_id, !!current.command.dialogue_action); }
          else { const run = next.runs.find(run => run.operation_id === current.command.operation_id); if (run?.error || current.error) setError(run?.error ?? current.error!); }
          return;
        }
      } catch (e) { if (!stopped) setError((e instanceof Error ? e.message : "进度查询失败") + "；你写的内容还在，刷新一下就能接着看。"); }
      if (!stopped) timer = setTimeout(poll, 1500);
    };
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [taskId, taskStatus, task?.created_at, storyId, waiting, update]); // task content is immutable for its ID
  const running = !!task && ["queued", "running"].includes(task.status);
  const unfinished = session?.runs.find(run => !["succeeded", "abandoned"].includes(run.status));
  const lastRun = unfinished ?? session?.runs.at(-1);
  const conversation = session?.conversations?.find(c=>c.status === "active");
  const continuation = session?.conversations?.find(c=>c.status === "ready" || (c.status === "closed" && !session.runs.some(r=>r.operation_id===c.continuation_id)));
  const dialogue = session ? pendingDialogue(session) : null;
  const submit = (command?: TurnCommand) => attempt(async () => {
    if (!session) return;
    if(!command && dialogue && !input.trim())throw Error("先回应角色，或写下主角的行动。");
    const value = command ?? { story_id: session.snapshot.world.story_id, operation_id: uid("op"), base_revision: session.revision, ...(dialogue ? {reply_to:dialogue.turn_id} : {}), input: input.trim() || "依据现有故事线自然续写，充分展开场景、人物互动和后果。", close_chapter: close };
    const pending: NarrativeTask = { task_id: uid("task"), command: value, status: "queued", created_at: new Date().toISOString() };
    // Persist before sending. If persistence fails, no paid call is sent.
    localStorage.setItem(taskKey(value.story_id), JSON.stringify(pending));
    setTask(pending); setWaiting(true);
    try { setTask(await api<NarrativeTask>("/api/story/tasks", { task_id: pending.task_id, command: value })); }
    catch (e) { setTask({ ...pending, status: "interrupted" }); throw e; }
  });
  const manage = useCallback((command: Omit<ManageCommand, "story_id" | "operation_id" | "base_revision">) => attempt(async () => {
    if (!session) return;
    const next = await api<StorySession>("/api/story/library", { ...command, story_id: session.snapshot.world.story_id, operation_id: uid("op"), base_revision: session.revision });
    update(next);
    if (command.action === "memory") setMemory(await api<SerializedMemoryState>("/api/story/library?view=memory&story_id=" + next.snapshot.world.story_id));
    else setMemory(null);
    if (command.action === "abandon") { setTask(null); localStorage.removeItem(taskKey(next.snapshot.world.story_id)); }
  }), [attempt, session, update]);
  const editInput = (text: string) => { setInput(text); try { if (storyId) localStorage.setItem(draftKey(storyId), text); } catch { setError("内容没能存在浏览器里，请先复制一份备份。"); } };
  const initialize = useCallback(() => attempt(async () => {
    const current = latestModel.current;
    let snapshot = current.snapshot;
    if(current.candidate) {
      const prepared = prepareCandidate(snapshot, current.candidate);
      if(prepared.issues.length) throw Error(prepared.issues[0].message);
      snapshot = acceptCandidate(snapshot, prepared.candidate);
    }
    const existing = await fetch("/api/story/main?story_id=" + encodeURIComponent(snapshot.world.story_id), {cache:"no-store"});
    if(!existing.ok && existing.status !== 404) {const failure = await existing.json();throw Error(failure.error?.userMessage ?? "读不到这个故事。");}
    const next = existing.ok ? await existing.json() as StorySession : await api<StorySession>("/api/story/main", { action: "initialize", snapshot });
    await open(next.snapshot.world.story_id);
    if(!next.turns.length && !next.runs.length && !localStorage.getItem(taskKey(next.snapshot.world.story_id))) {
      const command: TurnCommand = {story_id:next.snapshot.world.story_id,operation_id:"op_opening_"+next.snapshot.world.story_id,base_revision:next.revision,input:"根据现有条件展开故事开篇。自动构思故事线，充分描写场景、人物互动、冲突和情绪，不限固定字数。",close_chapter:false};
      const pending: NarrativeTask = {task_id:"task_opening_"+next.snapshot.world.story_id,command,status:"queued",created_at:new Date().toISOString()};
      localStorage.setItem(taskKey(command.story_id),JSON.stringify(pending)); setTask(pending);setWaiting(true);
      try {setTask(await api<NarrativeTask>("/api/story/tasks",{task_id:pending.task_id,command}));}
      catch(e) {setTask({...pending,status:"interrupted"});throw e;}
    }
  }), [attempt, open]);
  const refresh = () => attempt(async () => {
    if (!storyId) return;
    update(await api<StorySession>("/api/story/main?story_id=" + storyId));
    if (task) setTask(await api<NarrativeTask>("/api/story/tasks?task_id=" + task.task_id));
    setWaiting(true);
  });
  const startStory = () => attempt(async () => {
    if (!latestModel.current.snapshot.input.trim()) throw Error("先写下你的故事想法。");
    startRequested.current = true;
    await props.actions.generateFramework();
  });
  // One chat message is enough: once the world and characters are applied, writing starts on its own.
  useEffect(() => {
    if (!startRequested.current || session) return;
    if (props.model.busy || props.model.candidate) return;
    startRequested.current = false;
    if (props.model.error || !props.model.snapshot.world.title.value.trim()) return;
    void initialize();
  }, [session, props.model.busy, props.model.candidate, props.model.error, props.model.snapshot.world.title.value, initialize]);
  // 世界演化：每一轮写完后，用快速模型把新出现的地点/事件/势力补进年表；并入故事由用户一键确认。
  // 新项目：清掉所有故事相关的本地状态（草稿、任务、演化标记、活动故事），再重置设定工作台。
  const clearStoryState = () => {
    const stale = storyId ?? localStorage.getItem(ACTIVE);
    if (stale) { localStorage.removeItem(draftKey(stale)); localStorage.removeItem(taskKey(stale)); localStorage.removeItem(evolvedKey(stale)); }
    localStorage.removeItem(ACTIVE);
    setSession(null); setTask(null); setInput(""); setError("");
    startRequested.current = false;
    props.actions.restart();
    setView("chat");
  };  const worldAhead = !!session && props.model.snapshot.world.story_id === session.snapshot.world.story_id && props.model.snapshot.snapshot_revision > session.snapshot.snapshot_revision;
  const onSyncWorld = () => void manage({ action: "sync", snapshot: props.model.snapshot, confirmed: true } as ManageCommand);
  const title = session?.snapshot.world.title.value || "还没有名字的故事";
  const exportAll = () => download(title + ".md", "# " + title + "\n\n" + (session?.turns.map(turn => turn.prose.content).join("\n\n") ?? ""));
  const cancelTask = () => void attempt(async () => { await api("/api/story/tasks", { action: "cancel", task_id: task!.task_id }); setError("已请求停止；正在进行的生成会先保存结果。"); setWaiting(true); });
  const abandon = () => { if (window.confirm("放弃这一回合？已完成的部分会留在记录里，不会并进正文。")) void manage({ action: "abandon", run_id: unfinished!.operation_id } as ManageCommand); };
  return <div className="writing-app">
    <nav className="wa-nav" aria-label="创作导航"><strong>书中人 <small>共写一个世界</small></strong><div><button aria-pressed={view === "chat"} onClick={() => setView("chat")}>对话</button><button aria-pressed={view === "setup"} onClick={() => setView("setup")}>故事设定</button><button aria-pressed={view === "writing"} disabled={!session} onClick={() => setView("writing")}>写作台</button><button aria-pressed={view === "library"} onClick={() => void attempt(async () => { setStories(await api<StoryList>("/api/story/library")); setView("library"); })}>我的作品</button><button onClick={() => { if (window.confirm("开始新项目？当前故事在本机浏览器的草稿、任务与演化标记会被清空；服务端已保存的故事不受影响。")) clearStoryState(); }}>新建项目</button></div></nav>
    {error && view !== "chat" && <div className="wa-error" role="alert"><p>{error}</p><button onClick={() => setError("")}>收起提示</button></div>}
    {view === "chat" && <ConversationHome model={props.model} session={session} title={title} idea={props.model.snapshot.input} onIdeaChange={props.actions.setInput} task={task} busy={busy} running={running} waiting={waiting} unfinished={unfinished} lastRun={lastRun} conversation={conversation ?? null} continuation={continuation ?? null} dialogue={dialogue} input={input} onInput={editInput} close={close} onClose={setClose} onStart={() => void startStory()} onSubmit={command => void submit(command)} onOpenWorkbench={() => setView("setup")} onRefresh={() => void refresh()} onExport={exportAll} onCancelTask={cancelTask} onToggleWaiting={() => setWaiting(!waiting)} onAbandon={abandon} worldAhead={worldAhead} onSyncWorld={onSyncWorld} />}
    {view === "setup" && <><section className="wa-entry"><div><b>带着设定开始写</b><p>不用逐项确认，我会直接生成开篇。</p></div><label><input type="checkbox" checked={props.model.autoNpcs} onChange={e => props.actions.setAutoNpcs(e.target.checked)} />同时生成角色（会多消耗一次额度）</label><button className="wa-primary" disabled={busy || props.model.busy || !props.model.restored} onClick={() => void initialize()}>开始写作</button></section><StoryWorkbench {...props} /></>}
    {view === "library" && <main className="wa-library"><h1>我的作品</h1><p>每个故事都保存在这台电脑上。</p><div className="wa-actions"><button onClick={() => { props.actions.restart(); setView("setup"); }}>新建故事</button><label className="wa-file">导入备份<input type="file" accept=".json" onChange={e => { const file = e.target.files?.[0]; if (!file) return; void attempt(async () => { if (file.size > 20_000_000) throw Error("备份不能超过 20 MB。"); const next = await api<StorySession>("/api/story/library", { action: "import", backup: JSON.parse(await file.text()) }); await open(next.snapshot.world.story_id); }); e.target.value = ""; }} /></label></div>{stories.length === 0 && <p className="wa-empty">还没有作品。去“故事设定”准备一个世界，或直接在“对话”里写下第一句话。</p>}<ul className="wa-books">{stories.map(story => <li key={story.story_id}><h2>{story.title}</h2><p>{story.turns} 段正文 · {story.chapters} 章</p>{story.error ? <p role="alert">{story.error}</p> : <button disabled={busy} onClick={() => void attempt(() => open(story.story_id))}>打开作品</button>}</li>)}</ul></main>}
    {view === "writing" && session && <main className="wa-workspace"><header className="wa-heading"><div><p className="wa-eyebrow">正在写 · 第 {session.chapters.length + 1} 章</p><h1>{title}</h1><p>{session.current_time || "时间待推进"} · {session.current_location || "地点待推进"}</p><small>设定第 {session.snapshot.snapshot_revision} 版 · 故事第 {session.revision} 版</small></div><div className="wa-actions"><button onClick={() => void refresh()} disabled={busy}>查询最新状态</button><button onClick={exportAll}>导出全文</button><button onClick={() => void attempt(async () => download(title + ".backup.json", JSON.stringify(await api("/api/story/library?view=backup&story_id=" + storyId), null, 2), "application/json"))}>完整备份</button></div></header>
      <details className="wa-metrics"><summary onClick={() => { if (!metrics) void api<{ metrics: NonNullable<typeof metrics> }>("/api/story/status").then(result => setMetrics(result.metrics)).catch(e => setError(e.message)); }}>生成记录与用量</summary>{metrics && <p>共生成 {metrics.calls} 次 · 自动修正 {metrics.repairs} 次 · 失败或未确认 {metrics.failures} 次 · 累计 {(metrics.durationMs / 1000).toFixed(1)} 秒<br />输入 {metrics.promptTokens} / 输出 {metrics.completionTokens} 字（模型计量）· {metrics.usageMissing} 次没有返回用量<br />{metrics.estimatedCost === null ? "费用暂时无法估算（还没有配置单价）。" : "按已返回用量估算：" + metrics.estimatedCost.toFixed(4) + "（配置货币单位；缺失用量未计入）"}</p>}</details>
      <nav className="wa-tabs" aria-label="作品内容">{(["reading", "memory", "chapters", "settings"] as const).map(key => <button key={key} aria-pressed={panel === key} onClick={() => { setPanel(key); if (key === "memory") void attempt(async () => setMemory(await api<SerializedMemoryState>("/api/story/library?view=memory&story_id=" + storyId))); }}>{({ reading: "正文", memory: "人物与记忆", chapters: "章节与伏笔", settings: "同步设定" })[key]}</button>)}</nav>
      {panel === "reading" && <div className="wa-reading"><NarrativeProse session={session} unfinished={unfinished} />
      <NarrativeCompose session={session} task={task} busy={busy} running={running} waiting={waiting} unfinished={unfinished} lastRun={lastRun} conversation={conversation ?? null} continuation={continuation ?? null} dialogue={dialogue} input={input} onInput={editInput} close={close} onClose={setClose} onSubmit={command => void submit(command)} onCancelTask={cancelTask} onToggleWaiting={() => setWaiting(!waiting)} onAbandon={abandon} /></div>}
      {panel === "memory" && (memory ? <MemoryPanel memory={memory} snapshot={session.snapshot} busy={busy || running || !!unfinished} onCommand={command => void manage({ action: "memory", command } as ManageCommand)} /> : <p>正在读取人物记忆……</p>)}
      {panel === "chapters" && <section className="wa-chapters"><h2>章节目录</h2><button disabled={busy || running || !!unfinished || !session.turns.some(t => t.chapter === session.chapters.length + 1)} onClick={() => void manage({ action: "close_chapter" })}>结束本章（不写新内容）</button>{session.chapters.map(chapter => <details key={chapter.id}><summary>第 {chapter.number} 章 · {chapter.source_turn_ids.length} 个片段</summary><p>摘要：{chapter.summary.summary}</p><p className="wa-prose-text">{chapter.content}</p><small>来自回合：{chapter.source_turn_ids.join("、")}</small><button onClick={() => download(title + "-第" + chapter.number + "章.md", chapter.content)}>导出本章</button></details>)}<h2>未解线索</h2><p>这些还没在故事里兑现，不算已发生的事。</p><ul>{session.summary.unresolved_threads.map((thread, i) => <li key={i}>{thread}</li>)}</ul><details><summary>每一回合留下的伏笔</summary>{session.turns.map(turn => <p key={turn.id}>{turn.prose.foreshadowing.join("；")}</p>)}</details></section>}
      {panel === "settings" && <section className="wa-settings"><h2>修改这个故事的世界设定</h2><p>先把故事里的设定载入工作台，改完再核对差异同步回来；已写的正文不会变。</p><button disabled={busy || running || !!unfinished || props.model.busy} onClick={() => { props.actions.loadSnapshot?.(session.snapshot); setView("setup"); }}>载入到工作台编辑</button>{props.model.snapshot.world.story_id === storyId && <><h3>改动对照</h3><FactChanges before={{ world: session.snapshot.world, characters: session.snapshot.characters }} after={{ world: props.model.snapshot.world, characters: props.model.snapshot.characters }} /><div className="wa-diff"><details><summary>故事里的设定 · 第 {session.snapshot.snapshot_revision} 版</summary><pre>{JSON.stringify(session.snapshot, null, 2)}</pre></details><details><summary>工作台里的设定 · 第 {props.model.snapshot.snapshot_revision} 版</summary><pre>{JSON.stringify(props.model.snapshot, null, 2)}</pre></details></div><button disabled={busy || running || !!unfinished || !!props.model.candidate || props.model.snapshot.snapshot_revision <= session.snapshot.snapshot_revision} onClick={() => { if (window.confirm("确认同步这次设定改动？会记录一个新版本，已写的正文保持原文。")) void manage({ action: "sync", snapshot: props.model.snapshot, confirmed: true } as ManageCommand); }}>把改动同步到故事里</button></>}</section>}
    </main>}
  </div>;
}