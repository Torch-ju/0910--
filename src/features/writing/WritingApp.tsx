"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkbenchProps } from "@/lib/story/contracts";
import type { ManageCommand, StorySession, TurnCommand } from "@/lib/orchestration/contracts";
import { STEP_ORDER } from "@/lib/orchestration/contracts";
import type { SerializedMemoryState } from "../../../memory-agent/src/infrastructure/in-memory-repository";
import type { NarrativeTask } from "@/lib/orchestration/tasks";
import { FactChanges } from "@/features/story/ui/StoryWorkbenchShell";
import { StoryWorkbench } from "@/features/story/ui/StoryWorkbench";
import { prepareCandidate } from "@/lib/story/candidate";
import { acceptCandidate } from "@/lib/story/state";
import { uid } from "@/lib/story/factory";
import { ConversationWindow } from "./ConversationWindow";
import { DialoguePanel } from "./DialoguePanel";
import { pendingDialogue } from "@/lib/orchestration/dialogue";
import { MemoryPanel } from "./MemoryPanel";
import "./writing.css";
const ACTIVE = "shuzhongren.active-story";
const taskKey = (id: string) => "shuzhongren.task." + id;
const draftKey = (id: string) => "shuzhongren.input." + id;
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw Error(data.error?.userMessage ?? "请求未完成，请查询最新状态。");
  return data;
}
export function download(name: string, text: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type: type + ";charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const labels = { roles: "人物资料", narrator: "人物与故事线", transcription: "小说转写", memory_extraction: "记忆抽取", memory_update: "记忆更新", summary: "摘要", chapter: "章节" };
const statuses = { running: "进行中", done: "完成", failed: "失败" };
type StoryList = { story_id: string; title: string; turns: number; chapters: number; error: string | null }[];
export function WritingApp(props: WorkbenchProps) {
  const [view, setView] = useState<"setup" | "writing" | "library">("setup");
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
  const storyId = session?.snapshot.world.story_id;
  const update = useCallback((next: StorySession) => setSession(old => old?.snapshot.world.story_id === next.snapshot.world.story_id && old.revision > next.revision ? old : next), []);
  const attempt = async (work: () => Promise<void>) => { if (guard.current) return; guard.current = true; setBusy(true); setError(""); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "操作未完成"); } finally { guard.current = false; setBusy(false); } };
  const open = useCallback(async (id: string) => {
    const next = await api<StorySession>("/api/story/main?story_id=" + encodeURIComponent(id));
    setSession(next); setView("writing"); setMemory(null); setPanel("reading"); setTask(null); setWaiting(true);
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
    queueMicrotask(async () => { try { const id = localStorage.getItem(ACTIVE); if (id && live) await open(id); } catch (e) { if (live) setError(e instanceof Error ? e.message : "无法恢复故事"); } });
    return () => { live = false; };
  }, [open]);
  const taskId = task?.task_id, taskStatus = task?.status;
  useEffect(() => {
    if (!taskId || !storyId || !waiting || !["queued", "running"].includes(taskStatus ?? "")) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const current = await api<NarrativeTask>("/api/story/tasks?task_id=" + taskId);
        const next = await api<StorySession>("/api/story/main?story_id=" + storyId);
        if (stopped) return;
        update(next); setTask(current); localStorage.setItem(taskKey(storyId), JSON.stringify(current));
        if (current.status === "done" || current.status === "interrupted" || current.status === "cancelled") {
          const done = ["succeeded","waiting_dialogue"].includes(next.runs.find(run => run.operation_id === current.command.operation_id)?.status ?? "") || (!current.error && next.conversations?.some(c=>c.exchanges.some(e=>e.command.operation_id===current.command.operation_id && e.status==="done")));
          if (done) { setInput(old => old === current.command.input ? "" : old); if (localStorage.getItem(draftKey(storyId)) === current.command.input) localStorage.removeItem(draftKey(storyId)); localStorage.removeItem(taskKey(storyId)); setTask(null); setError(""); }
          else { const run = next.runs.find(run => run.operation_id === current.command.operation_id); if (run?.error || current.error) setError(run?.error ?? current.error!); }
          return;
        }
      } catch (e) { if (!stopped) setError((e instanceof Error ? e.message : "状态查询失败") + " 输入与任务标识已保留；可重新查询。"); }
      if (!stopped) timer = setTimeout(poll, 1500);
    };
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [taskId, taskStatus, storyId, waiting, update]); // task content is immutable for its ID
  const running = !!task && ["queued", "running"].includes(task.status);
  const unfinished = session?.runs.find(run => !["succeeded", "abandoned"].includes(run.status));
  const lastRun = unfinished ?? session?.runs.at(-1);
  const pendingProse = unfinished?.steps.transcription;
  const previewText = (pendingProse?.status === "done" ? (pendingProse.result as {content?:string})?.content : pendingProse?.preview) ?? "";
  const conversation = session?.conversations?.find(c=>c.status === "active");
  const continuation = session?.conversations?.find(c=>c.status === "ready" || (c.status === "closed" && !session.runs.some(r=>r.operation_id===c.continuation_id)));
  const dialogue = session ? pendingDialogue(session) : null;
  const submit = (command?: TurnCommand) => attempt(async () => {
    if (!session) return;
    if(!command && dialogue && !input.trim())throw Error("请先回应NPC，或描述主角的行动。");
    const value = command ?? { story_id: session.snapshot.world.story_id, operation_id: uid("op"), base_revision: session.revision, ...(dialogue ? {reply_to:dialogue.turn_id} : {}), input: input.trim() || "依据现有故事线自然续写，充分展开场景、人物互动和后果。", close_chapter: close };
    const pending: NarrativeTask = { task_id: uid("task"), command: value, status: "queued", created_at: new Date().toISOString() };
    // Persist before sending. If persistence fails, no paid call is sent.
    localStorage.setItem(taskKey(value.story_id), JSON.stringify(pending));
    setTask(pending); setWaiting(true);
    try { setTask(await api<NarrativeTask>("/api/story/tasks", { task_id: pending.task_id, command: value })); }
    catch (e) { setTask({ ...pending, status: "interrupted" }); throw e; }
  });
  const manage = (command: Omit<ManageCommand, "story_id" | "operation_id" | "base_revision">) => attempt(async () => {
    if (!session) return;
    const next = await api<StorySession>("/api/story/library", { ...command, story_id: session.snapshot.world.story_id, operation_id: uid("op"), base_revision: session.revision });
    update(next);
    if (command.action === "memory") setMemory(await api<SerializedMemoryState>("/api/story/library?view=memory&story_id=" + next.snapshot.world.story_id));
    else setMemory(null);
    if (command.action === "abandon") { setTask(null); localStorage.removeItem(taskKey(next.snapshot.world.story_id)); }
  });
  const editInput = (text: string) => { setInput(text); try { if (storyId) localStorage.setItem(draftKey(storyId), text); } catch { setError("输入未能保存到浏览器，请先复制备份。"); } };
  const initialize = () => attempt(async () => {
    let snapshot = props.model.snapshot;
    if(props.model.candidate) {
      const prepared = prepareCandidate(snapshot, props.model.candidate);
      if(prepared.issues.length) throw Error(prepared.issues[0].message);
      snapshot = acceptCandidate(snapshot, prepared.candidate);
    }
    const existing = await fetch("/api/story/main?story_id=" + encodeURIComponent(snapshot.world.story_id), {cache:"no-store"});
    if(!existing.ok && existing.status !== 404) {const failure = await existing.json();throw Error(failure.error?.userMessage ?? "无法读取已有故事");}
    const next = existing.ok ? await existing.json() as StorySession : await api<StorySession>("/api/story/main", { action: "initialize", snapshot });
    await open(next.snapshot.world.story_id);
    if(!next.turns.length && !next.runs.length && !localStorage.getItem(taskKey(next.snapshot.world.story_id))) {
      const command: TurnCommand = {story_id:next.snapshot.world.story_id,operation_id:"op_opening_"+next.snapshot.world.story_id,base_revision:next.revision,input:"根据现有条件展开故事开篇。自动构思故事线，充分描写场景、人物互动、冲突和情绪，不限固定字数。",close_chapter:false};
      const pending: NarrativeTask = {task_id:"task_opening_"+next.snapshot.world.story_id,command,status:"queued",created_at:new Date().toISOString()};
      localStorage.setItem(taskKey(command.story_id),JSON.stringify(pending)); setTask(pending);setWaiting(true);
      try {setTask(await api<NarrativeTask>("/api/story/tasks",{task_id:pending.task_id,command}));}
      catch(e) {setTask({...pending,status:"interrupted"});throw e;}
    }
  });
  const refresh = () => attempt(async () => {
    if (!storyId) return;
    update(await api<StorySession>("/api/story/main?story_id=" + storyId));
    if (task) setTask(await api<NarrativeTask>("/api/story/tasks?task_id=" + task.task_id));
    setWaiting(true);
  });
  const title = session?.snapshot.world.title.value || "未命名故事";
  return <div className="writing-app">
    <nav className="wa-nav" aria-label="创作导航"><strong>书中人 <small>共写一个世界</small></strong><div><button aria-pressed={view === "setup"} onClick={() => setView("setup")}>故事设定</button><button aria-pressed={view === "writing"} disabled={!session} onClick={() => setView("writing")}>写作</button><button aria-pressed={view === "library"} onClick={() => void attempt(async () => { setStories(await api<StoryList>("/api/story/library")); setView("library"); })}>我的作品</button></div></nav>
    {error && <div className="wa-error" role="alert"><p>{error}</p><button onClick={() => setError("")}>收起提示</button></div>}
    {view === "setup" && <><section className="wa-entry"><div><b>让设定走进故事</b><p>根据现有想法和设定直接生成开篇，无需逐项确认。</p></div><label><input type="checkbox" checked={props.model.autoNpcs} onChange={e => props.actions.setAutoNpcs(e.target.checked)} />根据输入接续生成 NPC 画像（额外模型调用）</label><button className="wa-primary" disabled={busy || props.model.busy || !props.model.restored} onClick={() => void initialize()}>开始写作</button></section><StoryWorkbench {...props} /></>}
    {view === "library" && <main className="wa-library"><h1>我的作品</h1><p>每个故事独立保存在本机服务端。</p><div className="wa-actions"><button onClick={() => { props.actions.restart(); setView("setup"); }}>新建故事</button><label className="wa-file">恢复完整备份<input type="file" accept=".json" onChange={e => { const file = e.target.files?.[0]; if (!file) return; void attempt(async () => { if (file.size > 20_000_000) throw Error("备份不能超过 20 MB。"); const next = await api<StorySession>("/api/story/library", { action: "import", backup: JSON.parse(await file.text()) }); await open(next.snapshot.world.story_id); }); e.target.value = ""; }} /></label></div>{stories.length === 0 && <p className="wa-empty">还没有开始写作的作品。先在故事设定中准备一个世界。</p>}<ul className="wa-books">{stories.map(story => <li key={story.story_id}><h2>{story.title}</h2><p>{story.turns} 段正文 · {story.chapters} 章</p>{story.error ? <p role="alert">{story.error}</p> : <button disabled={busy} onClick={() => void attempt(() => open(story.story_id))}>打开作品</button>}</li>)}</ul></main>}
    {view === "writing" && session && <main className="wa-workspace"><header className="wa-heading"><div><p className="wa-eyebrow">正在续写 · 第 {session.chapters.length + 1} 章</p><h1>{title}</h1><p>{session.current_time || "开局时刻待推进"} · {session.current_location || "开局地点待推进"}</p><small>设定版本 {session.snapshot.snapshot_revision} · 叙事版本 {session.revision}</small></div><div className="wa-actions"><button onClick={() => void refresh()} disabled={busy}>查询最新状态</button><button onClick={() => download(title + ".md", "# " + title + "\n\n" + session.turns.map(t => t.prose.content).join("\n\n"))}>导出全文</button><button onClick={() => void attempt(async () => download(title + ".backup.json", JSON.stringify(await api("/api/story/library?view=backup&story_id=" + storyId), null, 2), "application/json"))}>完整备份</button></div></header>
      <details className="wa-metrics"><summary onClick={() => { if (!metrics) void api<{ metrics: NonNullable<typeof metrics> }>("/api/story/status").then(result => setMetrics(result.metrics)).catch(e => setError(e.message)); }}>本机模型调用统计</summary>{metrics && <p>累计 {metrics.calls} 次调用 · {metrics.repairs} 次结构修复 · {metrics.failures} 个失败或未知请求 · 累计 {(metrics.durationMs / 1000).toFixed(1)} 秒<br />输入 {metrics.promptTokens} / 输出 {metrics.completionTokens} tokens · {metrics.usageMissing} 次缺少用量回执<br />{metrics.estimatedCost === null ? "费用未知：尚未配置模型单价。" : "按已报告用量估算费用：" + metrics.estimatedCost.toFixed(4) + "（配置货币单位；缺失用量未计入）"}</p>}</details>
      <nav className="wa-tabs" aria-label="作品内容">{(["reading", "memory", "chapters", "settings"] as const).map(key => <button key={key} aria-pressed={panel === key} onClick={() => { setPanel(key); if (key === "memory") void attempt(async () => setMemory(await api<SerializedMemoryState>("/api/story/library?view=memory&story_id=" + storyId))); }}>{({ reading: "正文", memory: "人物与记忆", chapters: "章节与伏笔", settings: "同步设定" })[key]}</button>)}</nav>
      {panel === "reading" && <div className="wa-reading"><section aria-label="小说正文" className="wa-prose">{session.turns.length === 0 && !previewText && <div className="wa-empty"><h2>故事将从这里展开</h2><p>写下续写要求（可留空），留一点空间给世界回应。</p></div>}{session.turns.map((turn, index) => <article key={turn.id} id={turn.id}><small>第 {turn.chapter} 章 · 片段 {index + 1}</small><p>{turn.prose.content}</p></article>)}{previewText && <article aria-label="正在生成的正文"><small>{pendingProse?.status === "done" ? (unfinished?.status === "waiting_dialogue" ? "正文已暂停，等待完成NPC对话" : unfinished?.status === "blocked" ? "正文已生成，后续整理中断，可恢复" : "正文已生成，正在整理记忆和摘要") : pendingProse?.status === "failed" ? "生成中断，以下为未完成预览" : "正在生成正文…"} · 预览，尚未完成整轮保存</small><p>{previewText}</p></article>}</section>
      <section className="wa-compose">{lastRun && <div className="wa-progress" aria-live="polite"><b>{lastRun.status === "succeeded" ? "本轮已完成" : lastRun.status === "abandoned" ? "此轮已放弃，原输入留档" : "本轮生成状态"}</b>{lastRun.error && <p role="alert">{lastRun.error}</p>}<ol>{STEP_ORDER.map(name => <li key={name} data-state={lastRun.steps[name]?.status ?? "pending"}>{(lastRun.pipeline === "direct_v1" || lastRun.pipeline === "interactive_v1" || lastRun.pipeline === "dialogue_v2") && name === "narrator" ? "场景准备（本地）" : (lastRun.pipeline === "direct_v1" || lastRun.pipeline === "interactive_v1" || lastRun.pipeline === "dialogue_v2") && name === "transcription" ? "故事创作" : labels[name]}：{lastRun.steps[name] ? statuses[lastRun.steps[name]!.status] : "等待"}{lastRun.steps[name]?.started_at && lastRun.steps[name]?.completed_at && <small> · {Math.max(0,(Date.parse(lastRun.steps[name]!.completed_at!) - Date.parse(lastRun.steps[name]!.started_at!))/1000).toFixed(1)} 秒</small>}{lastRun.steps[name]?.error && <p>{lastRun.steps[name]!.error}</p>}</li>)}</ol></div>}
      {((unfinished && unfinished.status!=="waiting_dialogue") || task?.status === "interrupted") && <div className="wa-recovery"><p>保留的输入：{unfinished?.input ?? task?.command.input}</p><button disabled={busy || running} onClick={() => {
        const command = task?.command.dialogue_action ? {...task.command,retry_failed:true} : unfinished ? { story_id: storyId!, operation_id: unfinished.operation_id, base_revision: unfinished.base_revision, input: unfinished.input, ...(unfinished.reply_to ? {reply_to:unfinished.reply_to} : {}), close_chapter: unfinished.close_chapter, retry_failed: true } : { ...task!.command, retry_failed: true };
        void submit(command);
      }}>恢复未完成轮次（可能计费）</button>{unfinished && <button disabled={busy || running} onClick={() => { if (window.confirm("放弃此轮？已完成的中间结果与输入保留审计，不加入正文。")) void manage({ action: "abandon", run_id: unfinished.operation_id } as ManageCommand); }}>放弃此轮</button>}</div>}
      {running && <p role="status">{waiting ? "正在查询后台任务，离开页面后仍会继续。" : "已停止等待，后台任务没有取消。"}<button onClick={() => void attempt(async () => { await api("/api/story/tasks", { action: "cancel", task_id: task!.task_id }); setError("已请求停止后续步骤；当前模型调用会先保存结果。"); setWaiting(true); })}>取消后续生成</button><button onClick={() => setWaiting(!waiting)}>{waiting ? "停止等待" : "继续查询"}</button></p>}
      {continuation && <div className="wa-recovery"><p>对话已结束，正文等待接续。</p><button disabled={busy || running} onClick={()=>{const command=continuation.exchanges.at(-1)?.command;if(command)void submit({...command,retry_failed:true});}}>接续对话后的正文</button></div>}{conversation ? <ConversationWindow key={conversation.id} session={session} conversation={conversation} busy={busy || running} onSend={command=>void submit(command)} /> : <DialoguePanel session={session} busy={busy || running || !!unfinished} />}
      <form onSubmit={e => { e.preventDefault(); if (!busy && !running && !unfinished) void submit(); }}><label htmlFor="narrative-input">{dialogue ? `对${dialogue.speaker_name}的回应` : "续写要求（可留空）"}</label><textarea id="narrative-input" rows={5} maxLength={12000} value={input} onChange={e => editInput(e.target.value)} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); if (!busy && !running && !unfinished) void submit(); } }} placeholder={dialogue ? "以主角的身份回应，或用括号描述行动……" : "留空即可自然续写，也可指定情节方向、人物行动或文风……"} /><div className="wa-actions"><label><input type="checkbox" checked={close} onChange={e => setClose(e.target.checked)} />本轮完成后结束当前章</label><small>{input.length} / 12000 · Ctrl / ⌘ + Enter 提交</small><button className="wa-primary" disabled={busy || running || !!unfinished || (!!dialogue && !input.trim())}>{dialogue ? "回应并继续剧情" : "推进故事"}</button></div></form></section></div>}
      {panel === "memory" && (memory ? <MemoryPanel memory={memory} snapshot={session.snapshot} busy={busy || running || !!unfinished} onCommand={command => void manage({ action: "memory", command } as ManageCommand)} /> : <p>正在读取人物记忆……</p>)}
      {panel === "chapters" && <section className="wa-chapters"><h2>章节目录</h2><button disabled={busy || running || !!unfinished || !session.turns.some(t => t.chapter === session.chapters.length + 1)} onClick={() => void manage({ action: "close_chapter" })}>结束当前章（不生成新剧情）</button>{session.chapters.map(chapter => <details key={chapter.id}><summary>第 {chapter.number} 章 · {chapter.source_turn_ids.length} 个片段</summary><p>摘要：{chapter.summary.summary}</p><p className="wa-prose-text">{chapter.content}</p><small>来源轮次：{chapter.source_turn_ids.join("、")}</small><button onClick={() => download(title + "-第" + chapter.number + "章.md", chapter.content)}>导出本章</button></details>)}<h2>未解线索</h2><p>下列内容尚未兑现，不属于已发生历史。</p><ul>{session.summary.unresolved_threads.map((thread, i) => <li key={i}>{thread}</li>)}</ul><details><summary>各轮留下的伏笔原文</summary>{session.turns.map(turn => <p key={turn.id}>{turn.prose.foreshadowing.join("；")}</p>)}</details></section>}
      {panel === "settings" && <section className="wa-settings"><h2>写作中的设定修改</h2><p>先载入本作品设定，再编辑、确认，最后核对差异并同步。既有正文会保留。</p><button disabled={busy || running || !!unfinished || props.model.busy} onClick={() => { props.actions.loadSnapshot?.(session.snapshot); setView("setup"); }}>载入此作品设定进行编辑</button>{props.model.snapshot.world.story_id === storyId && <><h3>设定差异</h3><FactChanges before={{ world: session.snapshot.world, characters: session.snapshot.characters }} after={{ world: props.model.snapshot.world, characters: props.model.snapshot.characters }} /><div className="wa-diff"><details><summary>当前服务端设定 · 版本 {session.snapshot.snapshot_revision}</summary><pre>{JSON.stringify(session.snapshot, null, 2)}</pre></details><details><summary>本地待同步设定 · 版本 {props.model.snapshot.snapshot_revision}</summary><pre>{JSON.stringify(props.model.snapshot, null, 2)}</pre></details></div><button disabled={busy || running || !!unfinished || !!props.model.candidate || props.model.snapshot.snapshot_revision <= session.snapshot.snapshot_revision} onClick={() => { if (window.confirm("已核对前后设定？同步会记录两个版本，已有剧情保持原文。")) void manage({ action: "sync", snapshot: props.model.snapshot, confirmed: true } as ManageCommand); }}>确认差异并同步</button></>}</section>}
    </main>}
  </div>;
}
