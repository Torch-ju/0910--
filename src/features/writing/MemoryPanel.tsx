"use client";
import { useState } from "react";
import type { SerializedMemoryState } from "../../../memory-agent/src/infrastructure/in-memory-repository";
import type { MemoryCommand } from "@/lib/orchestration/contracts";
import type { StorySnapshot } from "@/lib/story/contracts";
export function MemoryPanel({ memory, snapshot, busy, onCommand }: { memory: SerializedMemoryState; snapshot: StorySnapshot; busy: boolean; onCommand: (command: MemoryCommand) => void }) {
  const [source, setSource] = useState(""); const [target, setTarget] = useState(""); const [reason, setReason] = useState(""); const [kind, setKind] = useState<"merge" | "split">("merge");
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (key: string) => setSelected(old => old.includes(key) ? old.filter(x => x !== key) : [...old, key]);
  const name = (id: string) => memory.characters.find(c => c.characterId === id)?.displayName ?? id;
  const pending = memory.notifications.filter(n => n.status !== "acknowledged");
  const assignments = [
    ...memory.facts.filter(x => x.characterId === target).map(x => ({ key: "fact:" + x.factId, label: x.key + "：" + x.value })),
    ...memory.aliases.filter(x => x.characterId === target).map(x => ({ key: "alias:" + x.aliasId, label: "别名：" + x.value })),
    ...memory.events.filter(x => x.participantIds.includes(target)).map(x => ({ key: "event:" + x.eventId, label: "事件：" + x.summary })),
    ...memory.relationships.flatMap(x => [x.fromCharacterId === target ? { key: "from:" + x.relationshipId, label: "关系发起方：" + x.description } : null, x.toCharacterId === target ? { key: "to:" + x.relationshipId, label: "关系接收方：" + x.description } : null].filter(x => x !== null)),
  ];
  return <section className="wa-memory"><h2>人物与记忆</h2><p>初始设定与动态记忆分别保存。展开证据可查看模型抽取的来源及原文。</p>
    {pending.length > 0 && <section><h3>待处理通知</h3>{pending.map(n => <article key={n.notificationId}><p>{n.message}</p><button disabled={busy} onClick={() => onCommand({ kind: "acknowledge", notification_id: n.notificationId })}>标为已读</button><small>已读不会自动解决事实或身份冲突；请根据证据修正身份或同步设定。</small></article>)}</section>}
    {memory.conflicts.filter(c => c.status === "pending").map(c => <p className="wa-error" key={c.conflictId}>未决冲突：{c.description}{c.type === "fact_conflict" && memory.facts.filter(f => c.evidenceIds.includes(f.evidence.evidenceId)).map(f => <button key={f.factId} disabled={busy} onClick={() => { const reason = window.prompt("确认采用“" + f.value + "”的依据："); if (reason?.trim()) onCommand({ kind: "resolve_fact", conflict_id: c.conflictId, fact_id: f.factId, reason, confirmed: true }); }}>确认：{f.value}</button>)}</p>)}
    {memory.characters.map(character => <details key={character.characterId}><summary>{character.displayName} · {character.status === "merged" ? "已合并至 " + name(character.mergedIntoCharacterId ?? "") : "独立人物"}</summary>
      <details><summary>初始设定</summary><pre>{JSON.stringify(snapshot.characters.characters.find(c => c.character_id === character.characterId) ?? "剧情中出现的人物", null, 2)}</pre></details>
      <h3>动态画像</h3><pre>{JSON.stringify(memory.portraits.filter(p => p.characterId === character.characterId).at(-1)?.portrait ?? "尚未积累画像", null, 2)}</pre>
      <h3>事实与证据</h3>{memory.facts.filter(f => f.characterId === character.characterId).map(f => <details key={f.factId}><summary>{f.key}：{f.value}（{f.status}）</summary><pre>{JSON.stringify(f, null, 2)}</pre></details>)}
      <h3>重要事件</h3>{memory.events.filter(e => e.participantIds.includes(character.characterId)).map(e => <details key={e.eventId}><summary>{e.summary}</summary><pre>{JSON.stringify(e, null, 2)}</pre></details>)}
      <h3>关系</h3>{memory.relationships.filter(r => r.fromCharacterId === character.characterId || r.toCharacterId === character.characterId).map(r => <details key={r.relationshipId}><summary>{name(r.fromCharacterId)} → {name(r.toCharacterId)}：{r.description}</summary><pre>{JSON.stringify(r, null, 2)}</pre></details>)}
    </details>)}
    <details><summary>人工修正身份</summary><p>只在证据足够时合并；错误合并可拆回原人物。选择需要归还的记忆，记录会保留。</p><form onSubmit={e => { e.preventDefault(); if (!window.confirm("确认修正身份并保存原因？")) return; const base = { source, target, reason, confirmed: true as const }; onCommand(kind === "merge" ? { kind, ...base } : { kind, ...base, assignments: { factIds: selected.filter(x => x.startsWith("fact:")).map(x => x.slice(5)), aliasIds: selected.filter(x => x.startsWith("alias:")).map(x => x.slice(6)), eventIds: selected.filter(x => x.startsWith("event:")).map(x => x.slice(6)), relationshipEndpoints: selected.filter(x => /^(from|to):/.test(x)).map(x => ({ endpoint: x.startsWith("from:") ? "from" : "to", relationshipId: x.slice(x.indexOf(":") + 1) })) } }); }}>
      <label>修正方式<select value={kind} onChange={e => { setKind(e.target.value as typeof kind); setSource(""); setTarget(""); setSelected([]); }}><option value="merge">确认是同一人物，合并</option><option value="split">撤销错误合并，拆分</option></select></label>
      <label>来源人物<select required value={source} onChange={e => setSource(e.target.value)}><option value="">选择人物</option>{memory.characters.filter(c => kind === "split" ? c.status === "merged" : c.status === "active").map(c => <option key={c.characterId} value={c.characterId}>{c.displayName}</option>)}</select></label>
      <label>目标人物<select required value={target} onChange={e => { setTarget(e.target.value); setSelected([]); }}><option value="">选择人物</option>{memory.characters.filter(c => c.status === "active" && c.characterId !== source).map(c => <option key={c.characterId} value={c.characterId}>{c.displayName}</option>)}</select></label>
      <label>修正依据<textarea required maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label>
      {kind === "split" && <fieldset><legend>归还给来源人物的记忆</legend>{assignments.map(item => <label key={item.key}><input type="checkbox" checked={selected.includes(item.key)} onChange={() => toggle(item.key)} />{item.label}</label>)}</fieldset>}
      <button disabled={busy || !source || !target || !reason.trim()}>确认并保存身份修正</button>
    </form></details>
  </section>;
}
