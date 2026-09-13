"use client";
import type { Run, StorySession } from "@/lib/orchestration/contracts";

/** Renders the committed turns plus the streaming preview. Shared by the chat entry and the writing desk. */
export function NarrativeProse({ session, unfinished }: { session: StorySession; unfinished?: Run }) {
  const pendingProse = unfinished?.steps.transcription;
  const previewText = (pendingProse?.status === "done" ? (pendingProse.result as { content?: string })?.content : pendingProse?.preview) ?? "";
  return <section aria-label="小说正文" className="wa-prose">
    {session.turns.length === 0 && !previewText && <div className="wa-empty"><h2>故事将从这里展开</h2><p>写一句你想要的走向，或者直接留空让我接着写。</p></div>}
    {session.turns.map((turn, index) => <article key={turn.id} id={turn.id}><small>第 {turn.chapter} 章 · 片段 {index + 1}</small><p>{turn.prose.content}</p></article>)}
    {previewText && <article aria-label="正在生成的正文"><small>{pendingProse?.status === "done" ? (unfinished?.status === "waiting_dialogue" ? "正文暂停，等角色对话结束" : unfinished?.status === "blocked" ? "正文写完了，整理中断，可以继续" : "正文写完了，正在整理记忆") : pendingProse?.status === "failed" ? "生成中断，下面是未完成的预览" : "正在写下这一段…"} · 预览，尚未完成整轮保存</small><p>{previewText}</p></article>}
  </section>;
}
