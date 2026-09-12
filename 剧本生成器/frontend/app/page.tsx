"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ModelSettings from "./model-settings";
import GuidedInterview from "./guided-interview";
import AgentPanel from "./agent-panel";
import { ArrowDownToLine, ArrowRight, BookOpen, Check, ChevronRight, Feather, History, Leaf, Menu, MessageCircle, Pencil, Plus, RotateCcw, Send, Sparkles, Square, X } from "lucide-react";
import { api, post, requestId, kinds, type Artifact, type Health, type Message, type Project, type Workspace } from "./api";

const active = (status?: string) => status === "queued" || status === "running";
type Editor = { artifact?: Artifact; title: string; content: string; kind: string; revision: number; requestId: string };

export default function Home() {
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [agentInitialTab, setAgentInitialTab] = useState("nodes");
  const [agentOpen, setAgentOpen] = useState(false);
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [lane, setLane] = useState("auto");
  const [projects, setProjects] = useState<Project[]>([]);
  const [pid, setPid] = useState<string | null>(null);
  const [ws, setWs] = useState<Workspace | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [tab, setTab] = useState<"chat" | "notes">("chat");
  const [menuOpen, setMenuOpen] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [history, setHistory] = useState<Artifact[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const selected = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const pendingSend = useRef<{ pid: string; text: string; revision: number; id: string; lane: string; questionId: string | null } | null>(null);
  const running = active(ws?.latest_run?.status);
  const runId = ws?.latest_run?.id;

  const refresh = useCallback(async (id: string) => {
    const [detail, conversation, list] = await Promise.all([
      api<Workspace>(`/projects/${id}`),
      api<{ items: Message[]; next_cursor: string | null }>(`/projects/${id}/messages`),
      api<{ items: Project[] }>("/projects"),
    ]);
    if (selected.current !== id) return;
    setWs(detail); setMessages(conversation.items); setCursor(conversation.next_cursor); setProjects(list.items);
  }, []);

  const select = useCallback(async (id: string) => {
    selected.current = id; setPid(id); setWs(null); setMessages([]); setError("");
    setQuestionId(null); setMenuOpen(false); setTab("chat"); setAgentOpen(false);
    localStorage.setItem("liubai-project", id);
    setInput(localStorage.getItem(`liubai-draft-${id}`) || "");
    try { await refresh(id); } catch (e) { setError((e as Error).message); }
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api<{ items: Project[] }>("/projects"), api<Health>("/health")]).then(([list, status]) => {
      if (cancelled) return;
      setProjects(list.items); setHealth(status);
      const saved = localStorage.getItem("liubai-project");
      if (saved && list.items.some(p => p.id === saved)) void select(saved);
    }).catch(() => { if (!cancelled) setError("暂时连接不到工作区。请检查后端服务，再刷新页面。"); });
    return () => { cancelled = true; };
  }, [select]);

  useEffect(() => { if (pid) localStorage.setItem(`liubai-draft-${pid}`, input); }, [input, pid]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length, running]);

  useEffect(() => {
    if (!pid || !running || !runId) return;
    const stream = new EventSource(`/api/v1/runs/${runId}/events`);
    const update = () => { void refresh(pid).catch(() => setError("连接中断，正在尝试恢复；输入和已保存资料仍在。")); };
    stream.addEventListener("done", update);
    stream.addEventListener("error", update);
    const timer = setInterval(update, 1500);
    return () => { stream.close(); clearInterval(timer); };
  }, [pid, running, runId, refresh]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault(); if (!title.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ project: Project }>("/projects", post({ title: title.trim() }));
      setNewOpen(false); setTitle(""); await select(result.project.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function send(text = input) {
    if (!pid || !ws || !text.trim() || busy || running) return;
    setBusy(true); setError("");
    const old = pendingSend.current;
    const req = old && old.pid === pid && old.text === text && old.lane === lane && old.questionId === questionId ? old : { pid, text, lane, questionId, revision: ws.project.revision, id: requestId() };
    pendingSend.current = req;
    try {
      await api(`/projects/${pid}/turns`, post({ text, client_request_id: req.id, base_revision: req.revision, lane: req.questionId ? "main" : req.lane, question_id: req.questionId }));
      pendingSend.current = null;
      if (selected.current === pid) setInput(current => current === text ? "" : current);
      await refresh(pid);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof Error && "code" in e && e.code === "VERSION_CONFLICT") pendingSend.current = null;
      await refresh(pid).catch(() => {});
    } finally { setBusy(false); }
  }

  async function decision(action: string, target_id: string) {
    if (!pid || !ws || busy) return;
    setBusy(true); setError("");
    try {
      await api(`/projects/${pid}/decisions`, post({ action, target_id, base_revision: ws.project.revision, request_id: requestId() }));
      await refresh(pid);
    } catch (e) { setError((e as Error).message); await refresh(pid).catch(() => {}); }
    finally { setBusy(false); }
  }

  async function saveEditor(e: React.FormEvent) {
    e.preventDefault(); if (!editor || !pid) return;
    setBusy(true); setError("");
    try {
      const path = `/projects/${pid}/artifacts${editor.artifact ? `/${editor.artifact.id}` : ""}`;
      await api(path, { method: editor.artifact ? "PATCH" : "POST", body: JSON.stringify({
        title: editor.title, content: editor.content, kind: editor.kind,
        base_version: editor.artifact?.version || 0, base_revision: editor.revision, request_id: editor.requestId,
      }) });
      setEditor(null); await refresh(pid);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  function openEditor(a?: Artifact) {
    setEditor({ artifact: a, title: a?.title || "", content: a?.content || "", kind: a?.kind || "project_brief", revision: ws?.project.revision || 0, requestId: requestId() });
  }

  async function older() {
    if (!pid || !cursor) return;
    try {
      const page = await api<{ items: Message[]; next_cursor: string | null }>(`/projects/${pid}/messages?before=${encodeURIComponent(cursor)}`);
      setMessages(prev => [...page.items, ...prev]); setCursor(page.next_cursor);
    } catch (e) { setError((e as Error).message); }
  }

  useEffect(() => {
    if (!pid || !questionId || ws?.latest_run?.status !== "succeeded") return;
    let live = true;
    api<{steps: {id: string; answer: unknown}[]; next: {id: string} | null}>(`/projects/${pid}/guidance`).then(d => {
      if (live && d.steps.find(s => s.id === questionId)?.answer) setQuestionId(d.next?.id || null);
    }).catch(() => {});
    return () => { live = false; };
  }, [pid, ws?.latest_run?.id, ws?.latest_run?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generateNovel() {
    if (!pid || !ws || busy) return;
    setBusy(true); setError("");
    try {
      if (active(ws.latest_run?.status)) await api(`/runs/${ws.latest_run!.id}/cancel`, post({}));
      const latest = await api<Workspace>(`/projects/${pid}`);
      await api(`/projects/${pid}/stories/compose`, post({ request_id: requestId(), base_revision: latest.project.revision, agent_revision: latest.project.agent_revision, use_summaries: true }));
      setAgentInitialTab("story"); setAgentOpen(true);
      await refresh(pid);
    } catch (e) { setError((e as Error).message); await refresh(pid).catch(() => {}); }
    finally { setBusy(false); }
  }

  async function stop() {
    if (!ws?.latest_run || !pid) return;
    try { await api(`/runs/${ws.latest_run.id}/cancel`, post({})); await refresh(pid); }
    catch (e) { setError((e as Error).message); }
  }

  const notes = ws?.artifacts.filter(a => a.active) || [];
  const withdrawn = ws?.artifacts.filter(a => !a.active) || [];
  const pending = ws?.proposals.filter(q => q.status === "pending") || [];

  return <div className="app-shell">{modelSettingsOpen && <ModelSettings onClose={() => setModelSettingsOpen(false)} onConnected={async () => { setHealth(await api<Health>("/health")); }} />}
    <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
      <Link className="brand" href="/" aria-label="留白首页"><span className="brand-mark"><Feather size={23} /></span><span>留白<small>让故事，慢慢发生。</small></span></Link>
      <button className="new-project" onClick={() => setNewOpen(true)}><Plus size={17} /> 开始一个新故事</button>
      <div className="side-label">我的故事 <span>{projects.length.toString().padStart(2, "0")}</span></div>
      <nav className="project-list" aria-label="故事项目">
        {projects.length === 0 && <p className="sidebar-empty">还没有故事。<br />第一个念头，值得被记下。</p>}
        {projects.map(p => <button key={p.id} onClick={() => void select(p.id)} className={`project-link ${pid === p.id ? "selected" : ""}`}><BookOpen size={16} /><span>{p.title}<small>{p.focus}</small></span>{pid === p.id && <span className="tiny-dot" />}</button>)}
      </nav>
      <div className="side-bottom"><div className="quote">落笔之前，<br />先听见心里的故事。</div><div className="local-label"><span className="tiny-dot" /> 本地工作区 <span>Agent 测试版</span></div></div>
    </aside>
    {menuOpen && <button className="menu-shade" aria-label="关闭菜单" onClick={() => setMenuOpen(false)} />}
    <main className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="打开项目菜单" onClick={() => setMenuOpen(true)}><Menu size={20} /></button><span>写作工作室</span>{ws && <><ChevronRight size={14} /><strong>{ws.project.title}</strong></>}</div>
        <div className="top-actions"><button className="agent-toggle" onClick={() => setModelSettingsOpen(true)}>接入模型 API</button>{pid && <button className="agent-toggle" onClick={() => { setAgentInitialTab("nodes"); setAgentOpen(v => !v); }}>{agentOpen ? "返回对话" : "故事 Agent"}</button>}<span className={`mode-badge ${health?.mode === "real" ? "real" : ""}`}><span className="tiny-dot" />{health ? health.mode === "mock" ? "模拟体验" : "真实模型" : "连接中"}</span>{pid && <a className="export-button" href={`/api/v1/projects/${pid}/export`} download><ArrowDownToLine size={15} /><span>导出资料</span></a>}</div>
      </header>
      {health?.mode === "mock" && <div className="mode-notice">当前使用固定示例回复，供体验保存与确认流程。接入模型后，才能验证真实写作引导效果。</div>}
      {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setError("")}><X size={16} /></button></div>}
      {!pid ? <section className="welcome">
        <div className="welcome-decoration"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><Feather size={48} strokeWidth={1} /><span className="seal">起笔</span></div>
        <div className="eyebrow">A PLACE FOR YOUR STORIES</div><h1>每个故事，<br />都从一点<span>留白</span>开始。</h1>
        <p>不必先想好整个江湖。一个人、一封信，<br />或一句没说出口的话，都可以成为开端。</p>
        <button className="primary start-button" onClick={() => setNewOpen(true)}>开始我的故事 <ArrowRight size={17} /></button>
        <div className="welcome-features"><span><MessageCircle size={17} /> 一起梳理想法</span><span><Leaf size={17} /> 由你决定方向</span><span><BookOpen size={17} /> 留住每次灵感</span></div>
        <span className="welcome-footer">慢慢想，慢慢写。你的故事，不必着急。</span>
      </section> : !ws ? <div className="loading">正在找回你的故事…{error && <button onClick={() => void select(pid)}>重新连接</button>}</div> : <>
        <div className={`mobile-tabs ${agentOpen ? "agent-hidden" : ""}`}><button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>对话引导</button><button className={tab === "notes" ? "active" : ""} onClick={() => setTab("notes")}>故事资料 · {notes.length}</button></div>
        <div className={`workspace ${agentOpen ? "agent-hidden" : ""}`}>
          <section className={`conversation ${tab === "notes" ? "mobile-hidden" : ""}`}>
            <div className="conversation-header"><div><span className="eyebrow">CHAPTER ZERO</span><h2>先找到，故事的那颗种子。</h2></div><span className="stage-tag">构思中</span></div>
            <div className="message-scroll">
              {cursor && <button className="text-button older" onClick={() => void older()}>查看更早的对话</button>}
              {messages.length === 0 && <div className="intro-message"><div className="assistant-avatar"><Feather size={20} /></div><div><div className="message-author">留白 <span>你的写作伙伴</span></div><p>很高兴陪你写下这个故事。</p><p>你可以从脑海里的一幅画面、一个人物，或一段已经写下的文字开始。还没有方向，也没关系。</p><p className="intro-question">此刻，你最想写的是什么？</p><div className="starter-options"><button onClick={() => setInput("我想写一个人物，他最想得到的是…")}><Pencil size={15} /> 我有一个模糊的想法</button><button onClick={() => void send("还没想法，给我启发")} disabled={busy}><Sparkles size={15} /> 还没方向，给我一点启发</button></div></div></div>}
              {messages.map(m => <article key={m.id} className={`message ${m.role}`}><div className={m.role === "user" ? "user-avatar" : "assistant-avatar"}>{m.role === "user" ? "你" : <Feather size={18} />}</div><div className="message-body"><div className="message-author">{m.role === "user" ? "你" : "留白"}<span>{m.role === "assistant" ? "写作伙伴" : "创作者"}</span></div><div className="message-text">{m.content}</div>
                {ws.proposals.filter(q => q.message_id === m.id).map(q => <div className={`proposal ${q.status}`} key={q.id}><div className="proposal-label"><span>方向 {String(q.ordinal).padStart(2, "0")} · {kinds[q.kind]}</span><span>{({ pending: "尚未采用", accepted: "已采用", rejected: "已拒绝", stale: "依据已变化" } as Record<string, string>)[q.status]}</span></div><h3>{q.title}</h3><p>{q.content}</p><div className="rationale">{q.rationale}</div>{q.status === "pending" && <div className="proposal-actions"><button className="accept" disabled={busy} onClick={() => void decision("accept", q.id)}><Check size={14} /> 采用这个方向</button><button className="text-button" disabled={busy} onClick={() => void decision("reject", q.id)}>暂不采用</button></div>}</div>)}
              </div></article>)}
              {running && <div className="generating" role="status"><span className="pulse-dot" /> 正在整理这次想法…<small>完成后会显示回复，尚未采用任何建议</small></div>}
              {ws.latest_run?.error && !running && <div className="run-error" role="status"><p>{ws.latest_run.error.message}</p><button className="text-button" disabled={busy} onClick={() => { const m = messages.find(m => m.id === ws.latest_run?.message_id); if (m) void send(m.content); }}><RotateCcw size={14} /> 基于最新资料重新发送</button></div>}
              <div ref={bottom} />
            </div>
            <div className="composer-wrap"><GuidedInterview pid={pid} revision={ws.project.agent_revision} enabled={questionId !== null} questionId={questionId} onSelect={id => { setQuestionId(id); if (id) setLane("main"); }} /><div className="quick-actions"><button className="generate-novel" disabled={busy} onClick={() => void generateNovel()}><BookOpen size={14} /> 生成小说</button><select aria-label="对话方向" value={lane} onChange={e => setLane(e.target.value)}><option value="auto">自动区分</option><option value="main">推进主线</option><option value="auxiliary">辅助闲聊</option></select><button disabled={busy || running} onClick={() => void send("先跳过这个问题")}><ArrowRight size={13} /> 先跳过</button><button disabled={busy || running} onClick={() => void send("给我启发")}><Sparkles size={13} /> 给我启发</button><span>想法不必完整，写下来就好。</span></div>
              <form className="composer" onSubmit={e => { e.preventDefault(); void send(); }}><textarea aria-label="你的想法" placeholder="说说你的想法，或接着上一次继续…" value={input} maxLength={12000} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} /><div className="composer-footer"><span>Enter 发送 · Shift + Enter 换行</span>{running ? <button type="button" className="send-button" aria-label="停止生成" onClick={() => void stop()}><Square size={15} /></button> : <button className="send-button" aria-label="发送想法" disabled={busy || !input.trim()}><Send size={16} /></button>}</div></form><div className="composer-note"><Check size={12} /> 生成小说会停止当前回复，使用已保存摘要；未发送文字不会加入</div>
            </div>
          </section>
          <aside className={`notes-panel ${tab === "chat" ? "mobile-hidden" : ""}`}>
            <div className="notes-heading"><div><h2>故事手记</h2><p>把每一次决定，留在这里。</p></div><BookOpen size={21} strokeWidth={1.4} /></div>
            <div className="progress-card"><div><span>当前旅程</span><span>01 / 起笔</span></div><div className="journey"><span className="current" /><span /><span /><span /></div><strong>从一个念头开始</strong><p>先找到人物和他面前的难题。后续再慢慢展开。</p></div>
            <div className="notes-section-title"><span>已确认设定 <b>{notes.length}</b></span><button className="icon-button" aria-label="添加设定" onClick={() => openEditor()}><Plus size={17} /></button></div>
            {notes.length === 0 && <div className="empty-notes"><Leaf size={27} strokeWidth={1.2} /><h3>这里，等你的决定</h3><p>采用对话中的建议，或写下自己的设定，它们就会留在这里。</p><button className="text-button" onClick={() => openEditor()}>写下第一条设定 <Plus size={13} /></button></div>}
            {notes.map(a => <div className="note-card" key={a.id}><span className="note-kind">{kinds[a.kind]} <span>v{a.version}</span></span><h3>{a.title}</h3><p>{a.content}</p><div className="note-actions"><button className="text-button" onClick={() => openEditor(a)}><Pencil size={12} /> 编辑</button><button className="text-button" onClick={() => { void api<{ items: Artifact[] }>(`/projects/${pid}/artifacts/${a.id}/versions`).then(r => setHistory(r.items)).catch(e => setError(e.message)); }}><History size={12} /> 历史</button><button className="text-button" disabled={busy} onClick={() => void decision("withdraw", a.id)}>撤回</button></div></div>)}
            {pending.length > 0 && <div className="pending-note"><span className="tiny-dot" /> {pending.length} 条建议等你斟酌<small>未采用的建议不会成为正式设定。</small></div>}
            {withdrawn.length > 0 && <details className="withdrawn"><summary>已撤回 · {withdrawn.length}</summary>{withdrawn.map(a => <div key={a.id}><span>{a.title}</span><button className="text-button" disabled={busy} onClick={() => void decision("restore", a.id)}>恢复</button></div>)}</details>}
            <div className="notes-footnote">故事可以改写，<br />每一次选择都有迹可循。</div>
          </aside>
        </div>
        {agentOpen && <AgentPanel key={`${pid}-${agentInitialTab}`} initialTab={agentInitialTab} pid={pid} revision={ws.project.revision} revisionKey={`${ws.project.agent_revision}-${ws.latest_run?.id}-${ws.latest_run?.status}`} running={running} onChanged={() => refresh(pid)} />}
      </>}
    </main>
    {newOpen && <div className="modal-backdrop"><form className="modal" onSubmit={createProject} role="dialog" aria-modal="true" aria-labelledby="new-title"><button type="button" className="modal-close icon-button" aria-label="关闭" onClick={() => setNewOpen(false)}><X size={20} /></button><Feather size={28} className="modal-symbol" /><span className="eyebrow">A NEW BEGINNING</span><h2 id="new-title">给这个故事，一个名字。</h2><p>暂定的也很好。你可以先从一段念头开始。</p><label>故事名称<input autoFocus value={title} onChange={e => setTitle(e.target.value)} maxLength={80} placeholder="例如：渡口来信" required /></label>{error && <p className="field-error">{error}</p>}<button className="primary" disabled={busy || !title.trim()}>建立故事 <ArrowRight size={16} /></button></form></div>}
    {editor && <div className="modal-backdrop"><form className="modal editor-modal" onSubmit={saveEditor} role="dialog" aria-modal="true" aria-labelledby="edit-title"><button type="button" className="modal-close icon-button" aria-label="关闭编辑" onClick={() => setEditor(null)}><X size={20} /></button><span className="eyebrow">YOUR STORY, YOUR CHOICE</span><h2 id="edit-title">{editor.artifact ? "修改这条设定" : "写下你的设定"}</h2><p>保存后成为正式资料，旧版本仍会保留。</p><label>标题<input required maxLength={80} value={editor.title} onChange={e => setEditor({ ...editor, title: e.target.value })} /></label><label>类型<select value={editor.kind} onChange={e => setEditor({ ...editor, kind: e.target.value })}>{Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>内容<textarea aria-label="内容" required maxLength={12000} value={editor.content} onChange={e => setEditor({ ...editor, content: e.target.value })} /></label>{error && <p className="field-error">{error}</p>}<button className="primary" disabled={busy}>保存设定 <Check size={16} /></button></form></div>}
    {history && <div className="modal-backdrop"><div className="modal history-modal" role="dialog" aria-modal="true" aria-label="设定历史"><button className="modal-close icon-button" aria-label="关闭历史" onClick={() => setHistory(null)}><X size={20} /></button><h2>每一次改写，都留有痕迹。</h2>{history.map(a => <article key={`${a.id}-${a.version}`}><span className="eyebrow">版本 {a.version}</span><h3>{a.title}</h3><p>{a.content}</p><small>{new Date(a.created_at).toLocaleString("zh-CN")}</small></article>)}</div></div>}
  </div>;
}
