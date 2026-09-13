"use client";
import type { NarrativeTask } from "@/lib/orchestration/tasks";
import { STEP_ORDER } from "@/lib/orchestration/contracts";
import type { Conversation, Run, StorySession, TurnCommand } from "@/lib/orchestration/contracts";
import { pendingDialogue } from "@/lib/orchestration/dialogue";
import { ConversationWindow } from "./ConversationWindow";
import { DialoguePanel } from "./DialoguePanel";
import { STEP_STATUS_LABELS, stepLabel } from "./step-labels";
import { isInternalPrompt } from "./internal-prompts";

export type PendingDialogueCue = NonNullable<ReturnType<typeof pendingDialogue>>;

export type NarrativeComposeProps = {
  session: StorySession; task: NarrativeTask | null; busy: boolean; running: boolean; waiting: boolean;
  unfinished?: Run; lastRun?: Run; conversation: Conversation | null; continuation: Conversation | null; dialogue: PendingDialogueCue | null;
  input: string; onInput: (text: string) => void; close: boolean; onClose: (value: boolean) => void;
  onSubmit: (command?: TurnCommand) => void; onCancelTask: () => void; onToggleWaiting: () => void; onAbandon: () => void;
};

/** Progress, cost-bearing recovery and the narrative input. Shared by the chat entry and the writing desk. */
export function NarrativeCompose({ session, task, busy, running, waiting, unfinished, lastRun, conversation, continuation, dialogue, input, onInput, close, onClose, onSubmit, onCancelTask, onToggleWaiting, onAbandon }: NarrativeComposeProps) {
  const idle = !busy && !running && !unfinished;
  const resume = () => {
    const command = task?.command.dialogue_action ? { ...task.command, retry_failed: true } : unfinished ? { story_id: session.snapshot.world.story_id, operation_id: unfinished.operation_id, base_revision: unfinished.base_revision, input: unfinished.input, ...(unfinished.reply_to ? { reply_to: unfinished.reply_to } : {}), close_chapter: unfinished.close_chapter, retry_failed: true } : task ? { ...task.command, retry_failed: true } : null;
    if (command) onSubmit(command);
  };
  return <section className="wa-compose">
    {lastRun && <div className="wa-progress" aria-live="polite"><b>{lastRun.status === "succeeded" ? "这一段写完了" : lastRun.status === "abandoned" ? "这一段已放弃，你的输入还留着" : "正在生成"}</b>{lastRun.error && <p role="alert">{lastRun.error}</p>}<ol>{STEP_ORDER.map(name => <li key={name} data-state={lastRun.steps[name]?.status ?? "pending"}>{stepLabel(name, lastRun.pipeline)}：{lastRun.steps[name] ? STEP_STATUS_LABELS[lastRun.steps[name]!.status] : "等待"}{lastRun.steps[name]?.started_at && lastRun.steps[name]?.completed_at && <small> · {Math.max(0, (Date.parse(lastRun.steps[name]!.completed_at!) - Date.parse(lastRun.steps[name]!.started_at!)) / 1000).toFixed(1)} 秒</small>}{lastRun.steps[name]?.error && <p>{lastRun.steps[name]!.error}</p>}</li>)}</ol></div>}
    {!running && ((unfinished && unfinished.status !== "waiting_dialogue") || task?.status === "interrupted") && <div className="wa-recovery"><p>{isInternalPrompt(unfinished?.input ?? task?.command.input ?? "") ? "上一次的生成还没有写完" : "上次的输入：" + (unfinished?.input ?? task?.command.input)}</p><button disabled={busy || running} onClick={resume}>接着写上次没写完的（会消耗额度）</button>{unfinished && <button disabled={busy || running} onClick={onAbandon}>放弃这一段</button>}</div>}
    {running && <p role="status">{waiting ? "正在等待生成结果，离开页面也会继续。" : "已停止查看进度，生成仍在继续。"}<button onClick={onCancelTask}>停止这次生成</button><button onClick={onToggleWaiting}>{waiting ? "不再查看" : "继续查看"}</button></p>}
    {!running && !(unfinished && unfinished.status !== "waiting_dialogue") && !(task?.status === "interrupted") && continuation && <div className="wa-recovery"><p>对话结束了，可以接着写正文。</p><button disabled={busy || running} onClick={() => { const command = continuation.exchanges.at(-1)?.command; if (command) onSubmit({ ...command, retry_failed: true }); }}>继续写正文</button></div>}
    {conversation ? <ConversationWindow key={conversation.id} session={session} conversation={conversation} busy={busy || running} onSend={command => onSubmit(command)} /> : <DialoguePanel session={session} busy={busy || running || !!unfinished} />}
    <form onSubmit={event => { event.preventDefault(); if (idle) onSubmit(); }}>
      <label htmlFor="narrative-input">{dialogue ? `回应${dialogue.speaker_name}` : "接下来写什么（可留空）"}</label>
      <textarea id="narrative-input" rows={5} maxLength={12000} value={input} onChange={event => onInput(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); if (idle) onSubmit(); } }} placeholder={dialogue ? "以主角的身份回应，或用括号描述行动……" : "留空也可以，我会顺着故事往下写；也可以指定情节、人物行动或风格……"} />
      <div className="wa-actions"><label><input type="checkbox" checked={close} onChange={event => onClose(event.target.checked)} />写完后结束本章</label><small>{input.length} / 12000 · Ctrl / ⌘ + Enter 提交</small><button className="wa-primary" disabled={!idle || (!!dialogue && !input.trim())}>{dialogue ? "回应并继续" : "继续写"}</button></div>
    </form>
  </section>;
}