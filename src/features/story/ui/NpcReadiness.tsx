"use client";
import { useState } from "react";
import type { WorkbenchModel, WorkbenchActions } from "@/lib/story/contracts";
type WorkbenchProps = { model: WorkbenchModel; actions: WorkbenchActions };
import { npcBlockingQuestions } from "@/lib/story/npc-readiness";

export function NpcReadiness({ model, actions }: WorkbenchProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const questions = npcBlockingQuestions(model.snapshot);
  if (model.busy) return <div className="sw-empty" role="status">{model.stage}。完成后自动填入人物档案。</div>;
  if (model.candidate) return <div className="sw-empty" role="status">正在自动应用生成结果……</div>;
  if (!model.snapshot.world.title.value.trim()) return <div className="sw-empty">请先生成世界框架，再生成 NPC 画像；也可以手动添加人物。</div>;
  return <section className="sw-empty" aria-label="NPC 画像生成条件">
    {questions.length ? <><p>有 {questions.length} 个待确认问题，AI 会依据输入提出画像建议；你也可以先补充。</p>{questions.map(question => <form className="sw-question" key={question} onSubmit={event => { event.preventDefault(); const answer = answers[question]?.trim(); if (!answer) return; actions.answerQuestion(question, answer); setAnswers(old => ({ ...old, [question]: "" })); }}><label>{question}<input value={answers[question] ?? ""} onChange={event => setAnswers(old => ({ ...old, [question]: event.target.value }))} placeholder="填写你的决定" /></label><button className="sw-button sw-button--quiet" disabled={!answers[question]?.trim()}>保存回答</button></form>)}<p>无需逐项回答即可生成；建议不会被标记成你已确认的事实。</p></> : <p>世界框架已就绪，生成后会自动填入 NPC 人物档案。</p>}
    <button type="button" className="sw-button sw-button--accent" onClick={() => void actions.generateNpcs()}>生成 NPC 画像</button><p><small>画像指文字人物档案；生成会调用已配置的文本模型。</small></p>
  </section>;
}
