"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { DocumentKind } from "@/lib/story/contracts";
import { useWorkbenchUi } from "./WorkbenchUiContext";

export function FieldAssistant({ document, path, locked }: { document: DocumentKind; path: string; locked: boolean }) {
  const { model, actions } = useWorkbenchUi(); const [open, setOpen] = useState(false); const [instruction, setInstruction] = useState("");
  const unavailable = locked || model.busy || !!model.candidate;
  const reason = locked ? "该设定已锁定，请先解锁。" : model.busy ? "当前请求尚未完成。" : model.candidate ? "请先采用或保留当前候选。" : "";
  return <div className="sw-field-ai"><button type="button" className="sw-button sw-button--quiet" disabled={unavailable} title={reason || "为这个字段请求 AI 建议"} onClick={() => setOpen(!open)}><Sparkles size={14} />AI建议</button>{locked && <small>{reason}</small>}{open && <div className="sw-field-ai__request"><label>局部要求<textarea value={instruction} rows={2} onChange={(event) => setInstruction(event.target.value)} placeholder="补充这一字段的方向；不会替代共同故事想法。" /></label><button type="button" className="sw-button sw-button--accent" disabled={unavailable || !instruction.trim()} onClick={() => { void actions.suggestField(document, path, instruction); }}>请求建议</button></div>}</div>;
}
