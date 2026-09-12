"use client";
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api, post } from './api';
export default function ModelSettings({onClose, onConnected}: {onClose: () => void; onConnected: () => Promise<void>}) {
  const [key, setKey] = useState('');
  const [model, setModel] = useState('deepseek-flash');
  const [budget, setBudget] = useState(100);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { let live = true; api<{provider: string; model: string; configured: boolean; call_budget: number}>('/model/status').then(s => { if (!live) return; if (s.provider === 'deepseek') {setModel(s.model); setConfigured(s.configured);} setBudget(s.call_budget || 100); }).catch(e => {if (live) setError(e.message);}); return () => {live = false;}; }, []);
  async function connect() {
    setBusy(true); setError('');
    try { await api('/model/connect', post({api_key:key, model, call_budget:budget})); setKey(''); await onConnected(); onClose(); }
    catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  return <div className="modal-backdrop"><form className="modal" role="dialog" aria-modal="true" aria-label="接入模型 API" onSubmit={e => {e.preventDefault(); void connect();}}><button type="button" disabled={busy} className="modal-close icon-button" aria-label="关闭模型设置" onClick={onClose}><X size={19}/></button><h2>接入模型 API</h2><p>接入 DeepSeek 后，由真实模型引导问答并创作小说。密钥仅保存到本机后端 .env，不会回显。</p><label>服务商<input value="DeepSeek · 官方接口" readOnly /></label><label>API Key<input aria-label="DeepSeek API Key" type="password" autoComplete="off" required={!configured} value={key} onChange={e => setKey(e.target.value)} placeholder={configured ? '已保存，留空沿用现有密钥' : '填写 DeepSeek 平台创建的密钥'} /></label><label>模型名称<input required value={model} onChange={e => setModel(e.target.value)} /></label><label>累计请求次数上限<input type="number" min={1} max={100000} required value={budget} onChange={e => setBudget(Number(e.target.value))}/></label><p>检查连接只验证密钥和模型列表。启用后，对话和小说生成会调用 DeepSeek 并按其规则计费。</p>{error && <p className="field-error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy ? '正在检查连接…' : '检查连接并启用'}</button></form></div>;
}
