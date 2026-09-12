"use client";
import { useEffect, useState } from 'react';
import { api, post } from './api';
type Progress = {id: string; status: string; stage: string; planned_chapters: number; chapter_index: number; characters: number; chapters: {title: string; content: string; finished: boolean}[]; error: {message:string} | null; can_resume: boolean; repair_notes: string[]};
export default function NovelProgress({pid, running, onChanged}: {pid:string; running:boolean; onChanged:()=>Promise<void>}) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {let live=true; const update=()=>{void api<{run:Progress|null}>(`/projects/${pid}/novel-progress`).then(d=>{if(live)setProgress(d.run);}).catch(e=>{if(live)setError(e.message);});}; update(); const timer=setInterval(update, 1800); return()=>{live=false;clearInterval(timer);};},[pid,running]);
  async function action(resume: boolean) {
    if(!progress)return;setBusy(true);setError('');
    try {await api(resume ? `/projects/${pid}/novels/${progress.id}/resume` : `/runs/${progress.id}/cancel`, post({}));await onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  if(!progress || progress.status==='succeeded')return error?<p role="alert">{error}</p>:null;
  return <div className="novel-progress"><h3>{!["queued", "running"].includes(progress.status) ? "写作已暂停 · 进度已保存" : ({planning:'正在构思完整情节',writing:'正在逐章写作',reviewing:'正在检查情节完整性',repairing:'正在修订未收束情节',complete:'正在保存完整故事'} as Record<string,string>)[progress.stage] || '准备写作'}</h3><p>第 {Math.min(progress.chapter_index+1,progress.planned_chapters)} / {progress.planned_chapters || '待规划'} 章 · 已保存 {progress.characters.toLocaleString()} 字符</p><small>按情节需要逐段写作，不设总字数上限。通过收尾检查后才归入完整故事，支持中断后继续。</small>{progress.error&&<p className="field-error">{progress.error.message}</p>}{error&&<p role="alert">{error}</p>}<div className="node-buttons">{running&&<button className="accept" disabled={busy} onClick={()=>void action(false)}>暂停写作</button>}{progress.can_resume&&<button className="primary" disabled={busy||running} onClick={()=>void action(true)}>继续写作</button>}</div>{progress.repair_notes.length>0&&<details><summary>待修订内容</summary>{progress.repair_notes.map((s,i)=><p key={i}>{s}</p>)}</details>}<details><summary>查看已保存正文（尚未完成）</summary>{progress.chapters.map((c,i)=><article className="story-chapter" key={i}><h3>{c.title}{!c.finished&&' · 写作中'}</h3><p>{c.content}</p></article>)}</details></div>;
}
