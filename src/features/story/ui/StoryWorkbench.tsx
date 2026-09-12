"use client";
import { NpcReadiness } from "./NpcReadiness";

import { useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ChevronDown, ChevronRight, Lock, LockKeyholeOpen, Merge, Plus, Trash2 } from "lucide-react";
import type { DocumentKind, Fact, FactStatus, WorkbenchProps } from "@/lib/story/contracts";
import { FieldAssistant } from "./FieldAssistant";
import "./StoryWorkbench.css";
export { StoryWorkbench as default, StoryWorkbench } from "./StoryWorkbenchProvider";

type AnyFact = Fact<string | string[]>;
const sources = { user_explicit: "用户设定", user_edited: "用户改写", ai_inferred: "AI 推断", ai_suggestion: "AI 建议" };
const statuses: Record<FactStatus, string> = { draft: "草稿", pending_confirmation: "待确认", confirmed: "已确认", rejected: "已拒绝" };
const textList = (value: string[]) => value.join("、");
const ids = (value: string) => value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
export function toPointer(path: string) { return path.startsWith("/") ? path : "/" + path.split(".").map((part) => part.replaceAll("~", "~0").replaceAll("/", "~1")).join("/"); }

function Button({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={"sw-button " + className} type="button" {...props}>{children}</button>;
}

function FactEditor({ label, path, fact, document, actions, compact = false }: { label: string; path: string; fact: AnyFact; document: DocumentKind; actions: WorkbenchProps["actions"]; compact?: boolean }) {
  const current = fact.value;
  const isList = Array.isArray(current);
  const value = Array.isArray(current) ? textList(current) : current;
  const [draft, setDraft] = useState<string | null>(null);
  const displayValue = draft ?? value;
  const edit = () => { if (draft !== null && draft !== value) actions.editFact(document, toPointer(path), isList ? ids(draft) : draft); setDraft(null); };
  return <div className={"sw-fact " + (compact ? "sw-fact--compact" : "")}>
    <div className="sw-fact__top"><label htmlFor={"fact-" + path}>{label}</label><span className={"sw-badge sw-badge--" + fact.status}>{statuses[fact.status]}</span><span className="sw-source">{sources[fact.source]}</span></div>
    {compact ? <input id={"fact-" + path} value={displayValue} readOnly={fact.locked} onChange={(event) => setDraft(event.target.value)} onBlur={edit} placeholder="留白，等待共同确定" /> : <textarea id={"fact-" + path} rows={isList ? 2 : 3} value={displayValue} readOnly={fact.locked} onChange={(event) => setDraft(event.target.value)} onBlur={edit} placeholder="留白，等待共同确定" />}
    <div className="sw-fact__actions"><select aria-label={label + "确认状态"} value={fact.status} disabled={fact.locked} onChange={(event) => actions.setFactStatus(document, toPointer(path), event.target.value as FactStatus)}>{Object.entries(statuses).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select><Button aria-label={(fact.locked ? "解除锁定：" : "锁定：") + label} className="sw-icon-button" onClick={() => actions.toggleLock(document, toPointer(path))}>{fact.locked ? <Lock size={15} /> : <LockKeyholeOpen size={15} />}{fact.locked ? "已锁" : "锁定"}</Button><FieldAssistant document={document} path={toPointer(path)} locked={fact.locked} /></div>
  </div>;
}

function Fold({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  const [expanded, setExpanded] = useState(open);
  return <section className="sw-fold"><button className="sw-fold__title" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}<span>{title}</span></button>{expanded && <div className="sw-fold__body">{children}</div>}</section>;
}

function TripleCollection({ title, prefix, items, actions }: { title: string; prefix: string; items: Array<{ name: AnyFact; description: AnyFact; importance: AnyFact }>; actions: WorkbenchProps["actions"] }) {
  return <Fold title={title + " · " + items.length}><div className="sw-collection">{items.length === 0 && <p className="sw-empty">尚未写入{title}。这里会保留有意的空白。</p>}{items.map((item, index) => <article className="sw-record" key={prefix + index}><FactEditor label="名称" path={prefix + "." + index + ".name"} fact={item.name} document="world" actions={actions} compact /><FactEditor label="说明" path={prefix + "." + index + ".description"} fact={item.description} document="world" actions={actions} compact /><FactEditor label="叙事作用" path={prefix + "." + index + ".importance"} fact={item.importance} document="world" actions={actions} compact /></article>)}</div></Fold>;
}

export function WorldPanel({ model, actions }: WorkbenchProps) {
  const world = model.snapshot.world;
  const facts: Array<[string, string, AnyFact]> = [["故事名称", "title", world.title], ["一句话方向", "logline", world.logline], ["世界摘要", "summary", world.summary], ["类型", "genre", world.genre], ["主题", "themes", world.themes], ["叙事气质", "tone", world.tone], ["时代", "setting.era", world.setting.era], ["地理", "setting.geography", world.setting.geography], ["社会结构", "setting.society", world.setting.society], ["力量体系", "setting.technology_or_power_system", world.setting.technology_or_power_system], ["核心冲突", "core_conflict.description", world.core_conflict.description], ["冲突力量", "core_conflict.forces", world.core_conflict.forces], ["成败后果", "core_conflict.stakes", world.core_conflict.stakes], ["悬而未决", "core_conflict.open_issues", world.core_conflict.open_issues]];
  const constraints = [...world.hard_constraints, ...world.prohibited_content];
  return <section className="sw-panel"><header className="sw-panel__intro"><p className="sw-eyebrow">WORLD FRAMEWORK</p><h2>世界框架</h2><p>每一处留白都可直接书写；来源、确认状态和锁定状态随事实同行。</p></header><div className="sw-fact-grid">{facts.map(([label, path, fact]) => <FactEditor key={path} label={label} path={path} fact={fact} document="world" actions={actions} />)}</div>
    <TripleCollection title="地点" prefix="setting.locations" items={world.setting.locations} actions={actions} /><TripleCollection title="世界规则" prefix="setting.world_rules" items={world.setting.world_rules} actions={actions} /><TripleCollection title="组织" prefix="organizations" items={world.organizations} actions={actions} />
    <Fold title={"初始大纲 · " + world.initial_outline.length}><div className="sw-collection">{world.initial_outline.length === 0 ? <p className="sw-empty">未来方向尚未确定，不把它伪装成已经发生的历史。</p> : world.initial_outline.map((item, index) => <article className="sw-record" key={item.beat_id}><FactEditor label="大纲节点" path={"initial_outline." + index + ".title"} fact={item.title} document="world" actions={actions} compact /><FactEditor label="方向说明" path={"initial_outline." + index + ".description"} fact={item.description} document="world" actions={actions} compact /><FactEditor label="意图" path={"initial_outline." + index + ".purpose"} fact={item.purpose} document="world" actions={actions} compact /></article>)}</div></Fold>
    <Fold title={"约束与边界 · " + constraints.length}><div className="sw-collection">{constraints.map((item, index) => { const first = index < world.hard_constraints.length; const itemIndex = first ? index : index - world.hard_constraints.length; return <article className="sw-record" key={item.constraint_id}><p className="sw-record__label">{item.category}</p><FactEditor label="约束内容" path={(first ? "hard_constraints." : "prohibited_content.") + itemIndex + ".text"} fact={item.text} document="world" actions={actions} compact /></article>; })}{constraints.length === 0 && <p className="sw-empty">尚无明确约束，可稍后在对话中提出。</p>}</div></Fold>
    <Questions questions={world.open_questions} actions={actions} />
  </section>;
}

function Questions({ questions, actions }: { questions: WorkbenchProps["model"]["snapshot"]["world"]["open_questions"]; actions: WorkbenchProps["actions"] }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return <Fold title={"待回答的问题 · " + questions.length}><div className="sw-questions">{questions.length === 0 && <p className="sw-empty">目前没有需要澄清的问题。</p>}{questions.map((item) => <article key={item.question_id} className="sw-question"><p>{item.question}</p><small>{item.blocking ? "影响确认" : "可暂存"} · {item.importance}</small><div><input value={answers[item.question_id] ?? ""} placeholder="写下你的回答" onChange={(event) => setAnswers({ ...answers, [item.question_id]: event.target.value })} /><Button className="sw-button--quiet" onClick={() => actions.answerQuestion(item.question, answers[item.question_id] ?? "")}>回答</Button></div></article>)}</div></Fold>;
}

export function CharactersPanel({ model, actions }: WorkbenchProps) {
  const [expanded, setExpanded] = useState<string | null>(null); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const characters = model.snapshot.characters.characters; const relationships = model.snapshot.characters.relationships;
  const name = (id: string) => characters.find((item) => item.character_id === id)?.name.value || "未知人物";
  const details = (item: typeof characters[number]): Array<[string, string, AnyFact]> => [["姓名", "name", item.name], ["身份", "identity", item.identity], ["叙事定位", "role", item.role], ["外貌", "appearance", item.appearance], ["性格", "personality", item.personality], ["欲望", "desire", item.desire], ["恐惧", "fear", item.fear], ["秘密", "secret", item.secret], ["背景", "background", item.background], ["说话方式", "speech_style", item.speech_style], ["行为倾向", "behavior_tendencies", item.behavior_tendencies], ["开局状态", "current_state", item.current_state], ["出场条件", "entrance_condition", item.entrance_condition], ["已知信息", "known_information", item.known_information], ["未知信息", "unknown_information", item.unknown_information], ["成长起点", "growth_arc.starting_state", item.growth_arc.starting_state], ["成长压力", "growth_arc.pressure_point", item.growth_arc.pressure_point], ["可能方向", "growth_arc.possible_direction", item.growth_arc.possible_direction]];
  return <section className="sw-panel"><header className="sw-panel__intro"><p className="sw-eyebrow">CHARACTER PROFILES</p><h2>NPC 画像</h2><p>人物数量不预设。先写下世界，再让 AI 提出候选；也可以从空白中亲自开始。</p></header><div className="sw-panel__toolbar"><Button onClick={actions.addCharacter}><Plus size={16} />添加人物</Button><select aria-label="选择被合并人物" value={from} onChange={(event) => setFrom(event.target.value)}><option value="">选择来源</option>{characters.map((item) => <option key={item.character_id} value={item.character_id}>{item.name.value || "未命名人物"}</option>)}</select><select aria-label="选择合并目标人物" value={to} onChange={(event) => setTo(event.target.value)}><option value="">选择目标</option>{characters.map((item) => <option key={item.character_id} value={item.character_id}>{item.name.value || "未命名人物"}</option>)}</select><Button disabled={characters.length < 2 || !from || !to || from === to} className="sw-button--quiet" onClick={() => actions.mergeCharacters(from, to)}><Merge size={16} />合并选择</Button></div>
  {(characters.length === 0 || model.candidate?.origin === "npcs") && <NpcReadiness model={model} actions={actions} />}<div className="sw-characters">{characters.map((item, index) => { const open = expanded === item.character_id; const related = relationships.filter((relation) => relation.from_character_id === item.character_id || relation.to_character_id === item.character_id); return <article className="sw-character" key={item.character_id}><header><button type="button" className="sw-character__toggle" aria-expanded={open} onClick={() => setExpanded(open ? null : item.character_id)}>{open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}<span><b>{item.name.value || "未命名人物"}</b><small>{item.controlled_by === "user" ? "由用户操控" : "NPC"} · {item.role.value || "定位待定"}</small></span></button><Button className="sw-icon-button sw-danger" aria-label={"删除" + (item.name.value || "人物")} onClick={() => actions.removeCharacter(item.character_id)}><Trash2 size={16} />删除</Button></header>{open && <div className="sw-character__body"><div className="sw-fact-grid">{details(item).map(([label, path, fact]) => <FactEditor key={path} label={label} path={"characters." + index + "." + path} fact={fact} document="characters" actions={actions} />)}</div><section className="sw-relations"><p className="sw-record__label">关系读取</p>{related.length ? related.map((relation) => <p key={relation.relationship_id}>{name(relation.from_character_id)} <span>→</span> {name(relation.to_character_id)}：{relation.type}，{relation.description.value || "说明留白"}</p>) : <p className="sw-empty">还没有与其他人物连接的关系。</p>}</section></div>}</article>; })}</div>{relationships.length > 0 && <Fold title={"关系设定 · " + relationships.length}><div className="sw-collection">{relationships.map((relation, index) => <article className="sw-record" key={relation.relationship_id}><p className="sw-record__label">{name(relation.from_character_id)} → {name(relation.to_character_id)} · {relation.type}</p><FactEditor label="关系说明" path={"relationships." + index + ".description"} fact={relation.description} document="characters" actions={actions} compact /><FactEditor label="当前状态" path={"relationships." + index + ".current_state"} fact={relation.current_state} document="characters" actions={actions} compact /><FactEditor label="可能走向" path={"relationships." + index + ".possible_direction"} fact={relation.possible_direction} document="characters" actions={actions} compact /></article>)}</div></Fold>}</section>;
}
