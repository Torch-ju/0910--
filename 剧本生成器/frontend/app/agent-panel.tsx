"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, FileText, GitBranch, Layers, Pencil, RotateCcw, X } from "lucide-react";
import NovelProgress from "./novel-progress";
import { api, post, requestId } from "./api";

type Node = { id: string; title: string; summary: string; lane: "main" | "auxiliary"; category: string; status: string; include_in_story: boolean; version: number; source_quote: string; next_step: string };
type Story = { id: string; title: string; synopsis: string; chapters: { title: string; content: string; node_ids: string[] }[]; connections: { source_id: string; target_id: string; relation: string; reason: string }[]; assumptions: string[]; status: string; mode: string; skill_name: string; skill_hash: string; node_versions: Record<string, number> };
type AgentState = { agent_revision: number; nodes: Node[]; current_goal: string; next_step: string; stories: Story[]; memory: { main: Node[]; auxiliary: Node[]; main_total: number; auxiliary_total: number; archived_main: number; archived_auxiliary: number } };
type Source = { user: { content: string }; assistant: { content: string }; versions: Node[] };
const categories: Record<string, string> = { protagonist: "主角引导", world: "世界观", plot: "故事线", chat: "辅助闲聊" };
const statusText: Record<string, string> = { draft: "待确认", confirmed: "已确认", withdrawn: "已撤回", stale: "依据已变化" };

export default function AgentPanel({ pid, revision, revisionKey, running, onChanged, initialTab = "nodes" }: { pid: string; revision: number; revisionKey: string; running: boolean; onChanged: () => Promise<void>; initialTab?: string }) {
  const [state, setState] = useState<AgentState | null>(null);
  const [tab, setTab] = useState(initialTab);
  const [lane, setLane] = useState("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Node | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [storyId, setStoryId] = useState("");
  const load = useCallback(async () => { const data = await api<AgentState>(`/projects/${pid}/agent`); setState(data); }, [pid]);
  useEffect(() => {
    let cancelled = false;
    api<AgentState>(`/projects/${pid}/agent`).then(data => { if (!cancelled) setState(data); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [pid, revisionKey]);

  async function save(node: Node, change: Partial<Node> = {}) {
    const n = { ...node, ...change };
    await api(`/projects/${pid}/nodes/${n.id}`, { method: "PATCH", body: JSON.stringify({ title: n.title, summary: n.summary, lane: n.lane, category: n.category, status: n.status === "stale" ? "draft" : n.status, include_in_story: n.include_in_story, base_version: node.version, request_id: requestId() }) });
  }
  async function mutate(node: Node, change: Partial<Node>) {
    setBusy(true); setError("");
    try { await save(node, change); setEditing(null); await load(); await onChanged(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function confirmMain() {
    if (!state) return;
    setBusy(true); setError("");
    try {
      for (const n of state.nodes.filter(n => n.lane === "main" && n.status === "draft")) await save(n, { status: "confirmed" });
      await load(); await onChanged();
    } catch (e) { setError((e as Error).message); await load(); } finally { setBusy(false); }
  }
  async function compose() {
    if (!state) return;
    setBusy(true); setError("");
    try { await api(`/projects/${pid}/stories/compose`, post({ request_id: requestId(), base_revision: revision, agent_revision: state.agent_revision, use_summaries: true })); setTab("story"); setStoryId(""); await onChanged(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const story = state?.stories.find(s => s.id === storyId) || state?.stories[0];
  const names = Object.fromEntries((state?.nodes || []).map(n => [n.id, n.title]));

  return <section className="agent-workbench">
    <div className="agent-heading"><div><span className="eyebrow">STORY AGENT · 测试版</span><h2>把对话，连成你的故事。</h2><p>问答摘要 → 故事节点 → Skill 构思 → 逐章写作 → 收尾审校</p></div><button className="primary" disabled={busy || running || !state} onClick={() => void compose()}><GitBranch size={16} /> {running ? "任务进行中" : "连接节点生成故事"}</button></div>
    {error && <div className="error-banner" role="alert">{error}<button className="icon-button" aria-label="关闭 Agent 提示" onClick={() => setError("")}><X size={16} /></button></div>}
    <div className="agent-goal"><span>主角方向</span><strong>{state?.current_goal || "正在恢复记忆…"}</strong><small>下一步：{state?.next_step}</small></div>
    <div className="agent-tabs"><button className={tab === "memory" ? "active" : ""} onClick={() => setTab("memory")}><Layers size={15} /> 持续摘要</button><button className={tab === "nodes" ? "active" : ""} onClick={() => setTab("nodes")}><GitBranch size={15} /> 故事节点 <b>{state?.nodes.length || 0}</b></button><button className={tab === "story" ? "active" : ""} onClick={() => setTab("story")}><FileText size={15} /> 完整故事 <b>{state?.stories.length || 0}</b></button></div>
    {tab === "memory" && state && <div className="memory-columns">
      {(["main", "auxiliary"] as const).map(l => <section className={`memory-column ${l}`} key={l}><h3>{l === "main" ? "主线记忆" : "辅助记忆"}</h3><p>{l === "main" ? "主角的目标、选择，以及世界与情节的推进。" : "闲聊、偏好与情绪可以启发转折和支线，故事仍围绕主角目标展开。"}</p>{state.memory[l].length === 0 && <div className="agent-empty">这一侧还没有摘要，继续对话后会自动整理。</div>}{state.memory[l].map(n => <article key={n.id}><span>{statusText[n.status]}</span><h4>{n.title}</h4><p>{n.summary}</p></article>)}<small>共 {l === "main" ? state.memory.main_total : state.memory.auxiliary_total} 个有效摘要；此处展示最近 {l === "main" ? 8 : 4} 个，所有原文与完整摘要保留在节点中。</small></section>)}
    </div>}
    {tab === "nodes" && state && <div className="nodes-view"><div className="node-toolbar"><label>查看 <select aria-label="节点分类筛选" value={lane} onChange={e => setLane(e.target.value)}><option value="all">全部节点</option><option value="main">主线节点</option><option value="auxiliary">辅助节点</option></select></label><button className="text-button" disabled={busy || !state.nodes.some(n => n.lane === "main" && n.status === "draft")} onClick={() => void confirmMain()}><Check size={14} /> 确认全部待定主线节点</button></div>
      {state.nodes.length === 0 && <div className="agent-empty"><GitBranch size={28} /><h3>让第一段对话成为一个节点。</h3><p>回到对话，告诉助手主角想做什么；也可以聊聊生活，看看主辅线如何分别记录。</p></div>}
      <div className="node-grid">{state.nodes.filter(n => lane === "all" || n.lane === lane).map(n => <article className={`agent-node ${n.lane} ${n.status}`} key={n.id}><div className="node-meta"><span>{n.lane === "main" ? "主线" : "辅助"} · {categories[n.category]}</span><span>{statusText[n.status]} · v{n.version}</span></div><h3>{n.title}</h3><p>{n.summary}</p><blockquote>“{n.source_quote}”</blockquote><small>{n.next_step}</small>
        <div className="node-buttons">{n.status !== "confirmed" && n.status !== "withdrawn" && <button disabled={busy} className="accept" onClick={() => void mutate(n, { status: "confirmed", include_in_story: n.lane === "auxiliary" })}><Check size={13} /> 确认节点</button>}<button className="text-button" onClick={() => setEditing({ ...n })}><Pencil size={12} /> 编辑 / 分类</button><button className="text-button" onClick={() => { void api<Source>(`/projects/${pid}/nodes/${n.id}/source`).then(setSource).catch(e => setError(e.message)); }}>查看原文</button>{n.status === "confirmed" && <button disabled={busy} className="text-button" onClick={() => void mutate(n, { status: "withdrawn" })}>撤回</button>}{n.status === "withdrawn" && <button disabled={busy} className="text-button" onClick={() => void mutate(n, { status: "draft" })}><RotateCcw size={12} /> 恢复待定</button>}</div>
        {n.lane === "auxiliary" && n.status === "confirmed" && <label className="aux-include"><input type="checkbox" checked={n.include_in_story} disabled={busy} onChange={e => void mutate(n, { include_in_story: e.target.checked })} /> 允许影响剧情（以主线为主）</label>}
      </article>)}</div></div>}
    {tab === "story" && <div className="story-view"><NovelProgress pid={pid} running={running} onChanged={onChanged} />{running && <div className="generating" role="status"><span className="pulse-dot" /> 正在通过 Jin Yong Perspective Skill 构思、逐章写作与审校…</div>}{!story && !running && <div className="agent-empty"><FileText size={28} /><h3>故事会从你确认的节点中生长。</h3><p>至少准备一个主角节点和另一个主线节点，再点击“连接节点生成故事”。</p></div>}{story && !running && <>
      <div className="story-toolbar"><select aria-label="故事草稿版本" value={story.id} onChange={e => setStoryId(e.target.value)}>{state?.stories.map((s, i) => <option key={s.id} value={s.id}>草稿 {state.stories.length-i} · {s.title}{s.status === "stale" ? "（过期）" : ""}</option>)}</select><a className="export-button" href={`/api/v1/projects/${pid}/stories/${story.id}/export`} download>导出故事</a></div>
      <div className="story-status">{story.mode === "mock" ? "模拟故事：仅验节点连接，非真实创作效果" : "模型生成草稿：等待你审阅"}{story.status === "stale" && <strong> · 节点或资料已变化，请重新生成</strong>}</div><h2>{story.title}</h2><p className="story-synopsis">{story.synopsis}</p>
      <details className="connection-map" open><summary>节点如何连接 · {story.skill_name}</summary>{story.connections.map((e, i) => <div className="story-edge" key={i}><div><span>{names[e.source_id]}</span><ArrowRight size={14} /><span>{names[e.target_id]}</span></div><p>{({ follows: "承接", causes: "因果", supports: "辅助", payoff: "伏笔回收" } as Record<string, string>)[e.relation]}：{e.reason}</p></div>)}</details>
      {story.chapters.map((c, i) => <article className="story-chapter" key={i}><h3>{c.title}</h3><p>{c.content}</p><small>节点依据：{c.node_ids.map(id => `${names[id]} · v${story.node_versions[id]}`).join(" / ")}</small></article>)}
      <div className="story-assumptions"><h3>补写与待确认</h3>{story.assumptions.length ? <ul>{story.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul> : <p>模型未列出额外假设，仍需核对正文是否忠于节点。</p>}<small>创作技能：{story.skill_name} · 版本指纹 {story.skill_hash.slice(0, 12)}</small></div>
    </>}</div>}
    {editing && <div className="modal-backdrop"><form className="modal editor-modal" role="dialog" aria-modal="true" aria-label="编辑故事节点" onSubmit={e => { e.preventDefault(); void mutate(editing, {}); }}><button type="button" className="modal-close icon-button" aria-label="关闭节点编辑" onClick={() => setEditing(null)}><X size={19} /></button><h2>整理这个故事节点</h2><label>节点标题<input required maxLength={80} value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} /></label><label>主辅线<select aria-label="主辅线" value={editing.lane} onChange={e => setEditing({ ...editing, lane: e.target.value as Node["lane"], category: e.target.value === "auxiliary" ? "chat" : "plot", include_in_story: false })}><option value="main">主线</option><option value="auxiliary">辅助</option></select></label><label>节点类型<select aria-label="节点类型" value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })}>{Object.entries(categories).filter(([key]) => editing.lane === "main" ? key !== "chat" : key === "chat").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>摘要<textarea aria-label="节点摘要" required maxLength={800} value={editing.summary} onChange={e => setEditing({ ...editing, summary: e.target.value })} /></label>{error && <p className="field-error">{error}</p>}<button className="primary" disabled={busy}>保存节点版本</button></form></div>}
    {source && <div className="modal-backdrop"><div className="modal history-modal" role="dialog" aria-modal="true" aria-label="节点来源"><button className="modal-close icon-button" aria-label="关闭节点来源" onClick={() => setSource(null)}><X size={19} /></button><h2>摘要从哪里来</h2><h3>用户原文</h3><p className="source-text">{source.user.content}</p><h3>助手引导</h3><p className="source-text">{source.assistant.content}</p><h3>节点版本 · {source.versions.length}</h3>{source.versions.map(n => <article key={n.version}><span>v{n.version} · {n.lane === "main" ? "主线" : "辅助"} · {statusText[n.status]}</span><p>{n.summary}</p></article>)}</div></div>}
  </section>;
}
