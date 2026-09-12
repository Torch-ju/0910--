"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
type Step = { id: string; title: string; question: string; category: string; answer: { summary: string; status: string } | null };
type Progress = { steps: Step[]; answered: number; total: number; next: Step | null };
export default function GuidedInterview({pid, revision, enabled, questionId, onSelect}: {pid: string; revision: number; enabled: boolean; questionId: string | null; onSelect: (id: string | null) => void}) {
  const [data, setData] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let live = true; api<Progress>(`/projects/${pid}/guidance`).then(d => { if (live) setData(d); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [pid, revision]);
  const selected = data?.steps.find(s => s.id === questionId) || data?.next;
  return <section className="guided-interview" aria-label="世界观与时间线引导"><div className="interview-heading"><strong>世界观与时间线</strong><span>{data?.answered || 0} / {data?.total || 9} 已记录</span></div>{error && <p role="alert">{error}</p>}
    {enabled && selected ? <><p className="interview-question">{selected.question}</p><small>在下方输入回答，每次问答会形成摘要。简短回答也可以，重要内容可在节点中修改。</small><button className="text-button" onClick={() => onSelect(null)}>切换自由对话 / 闲聊</button></> : <><p>从世界规则开始，一起理清主角与事件的来龙去脉。</p><button className="accept" disabled={!data} onClick={() => onSelect((data?.next || data?.steps[0])?.id || null)}>开始问答引导</button></>}
    <details><summary>查看世界观与时间线摘要</summary><ol>{data?.steps.map(s => <li key={s.id}><button className="text-button" onClick={() => onSelect(s.id)}>{s.title} · {s.answer ? "修改回答" : "回答问题"}</button><p>{s.answer?.summary || "尚待探索"}</p></li>)}</ol></details>
  </section>;
}
