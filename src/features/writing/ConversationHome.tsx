"use client";
import { useEffect, useRef } from "react";
import type { WorkbenchModel } from "@/lib/story/contracts";
import type { Conversation, Run, StorySession, TurnCommand } from "@/lib/orchestration/contracts";
import type { NarrativeTask } from "@/lib/orchestration/tasks";
import { GenerationStatus, pipelineSteps } from "./GenerationStatus";
import { NarrativeCompose, type PendingDialogueCue } from "./NarrativeCompose";
import { NarrativeProse } from "./NarrativeProse";

export type ConversationHomeProps = {
  model: WorkbenchModel; session: StorySession | null; title: string;
  idea: string; onIdeaChange: (text: string) => void;
  task: NarrativeTask | null; busy: boolean; running: boolean; waiting: boolean;
  unfinished?: Run; lastRun?: Run; conversation: Conversation | null; continuation: Conversation | null; dialogue: PendingDialogueCue | null;
  input: string; onInput: (text: string) => void; close: boolean; onClose: (value: boolean) => void;
  onStart: () => void; onSubmit: (command?: TurnCommand) => void; onOpenWorkbench: () => void;
  onRefresh: () => void; onExport: () => void; onCancelTask: () => void; onToggleWaiting: () => void; onAbandon: () => void;
  worldAhead?: boolean; onSyncWorld?: () => void;
};

/** Minimal chat-first entry: one conversation for the setup agents, the prose and the narrative input. */
export function ConversationHome(props: ConversationHomeProps) {
  const { model, session } = props;
  const starting = !session && model.busy;
  const log = useRef<HTMLDivElement | null>(null);
  const messages = model.snapshot.messages;
  const world = model.snapshot.world;
  const hasWorld = !!world.title.value.trim();
  const stage = starting ? (model.stage || "正在生成世界观、人物和开篇") : model.busy ? model.stage : props.running ? "正在往下写" : session ? `已写 ${session.turns.length} 段 · 第 ${session.chapters.length + 1} 章` : "写下第一句话，世界就开始生长";
  const canStart = !props.busy && !model.busy && model.restored && !!props.idea.trim();
  useEffect(() => { const node = log.current; if (node) node.scrollTop = node.scrollHeight; }, [messages.length, session?.turns.length, starting, props.running]);
  return <main className="wa-home">
    <header className="wa-home__head">
      <div>
        <p className="wa-eyebrow">{session ? "继续这个故事" : "开始一个新故事"}</p>
        <h1>{session ? props.title : "书中人"}</h1>
        <p className="wa-home__stage" role="status">{stage}</p>
      </div>
      {session && <div className="wa-actions"><button type="button" onClick={props.onRefresh} disabled={props.busy}>刷新</button><button type="button" onClick={props.onExport}>导出全文</button></div>}
    </header>
    {(starting || props.unfinished) && <GenerationStatus label={starting ? "正在生成世界观、人物和开篇" : "正在往下写这一段"} steps={props.unfinished ? pipelineSteps(props.unfinished) : undefined} startedAt={props.unfinished?.created_at} />}
    <div className="wa-home__log" ref={log} aria-label="创作对话">
      {messages.length === 0 && !hasWorld && !starting && <article className="wa-home__message" data-role="assistant"><small>书中人</small><p>写下你想写的故事。我会先生成世界观、人物和开篇，之后我们就在这个对话里继续。</p></article>}
      {messages.map(message => <article key={message.id} className="wa-home__message" data-role={message.role}><small>{message.role === "user" ? "你" : message.role === "assistant" ? "书中人" : "系统"}</small><p>{message.content}</p></article>)}
      {starting && <article className="wa-home__message" data-role="assistant"><small>书中人</small><p>{model.stage}……</p></article>}
      {hasWorld && <article className="wa-home__card"><b>世界观和人物已经就绪</b><p>{world.title.value}{world.logline.value ? " · " + world.logline.value : world.summary.value ? " · " + world.summary.value : ""}</p><p><small>{model.snapshot.characters.characters.length} 个角色 · 年表 {world.timeline.length} 条 · 第 {model.snapshot.snapshot_revision} 版设定</small></p><button type="button" onClick={props.onOpenWorkbench}>查看和修改设定</button>{props.worldAhead && <p className="wa-home__ahead" role="status">世界观已经有新的演化（第 {model.snapshot.snapshot_revision} 版），并入故事后下一轮写作就会用上。<button type="button" onClick={props.onSyncWorld}>并入故事</button></p>}</article>}
    </div>
    {session ? <>
      <NarrativeProse session={session} unfinished={props.unfinished} />
      <NarrativeCompose session={session} task={props.task} busy={props.busy} running={props.running} waiting={props.waiting} unfinished={props.unfinished} lastRun={props.lastRun} conversation={props.conversation} continuation={props.continuation} dialogue={props.dialogue} input={props.input} onInput={props.onInput} close={props.close} onClose={props.onClose} onSubmit={props.onSubmit} onCancelTask={props.onCancelTask} onToggleWaiting={props.onToggleWaiting} onAbandon={props.onAbandon} />
    </> : <section className="wa-compose">
      <form onSubmit={event => { event.preventDefault(); if (canStart) props.onStart(); }}>
        <label htmlFor="narrative-input">故事想法</label>
        <textarea id="narrative-input" rows={5} maxLength={12000} value={props.idea} onChange={event => props.onIdeaChange(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); if (canStart) props.onStart(); } }} placeholder="例如：一个少年镖师护送一口空棺回乡，途中发现棺中另有其人。" />
        <div className="wa-actions"><small>{props.idea.length} / 12000 · Ctrl / ⌘ + Enter 开始</small><button className="wa-primary" disabled={!canStart}>{starting ? "正在生成…" : "开始故事"}</button></div>
      </form>
    </section>}
  </main>;
}