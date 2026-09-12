"use client";
import { useEffect, useRef, useState } from 'react';
import type { Conversation, StorySession, TurnCommand } from '@/lib/orchestration/contracts';
import { uid } from '@/lib/story/factory';
export function ConversationWindow({session,conversation,busy,onSend}:{session:StorySession;conversation:Conversation;busy:boolean;onSend:(command:TurnCommand)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [visible,setVisible]=useState(true),[draft,setDraft]=useState('');
  const key='shuzhongren.dialogue-draft.'+session.snapshot.world.story_id+'.'+conversation.id;
  const pending=conversation.exchanges.find(e=>e.status!=='done');
  useEffect(()=>{queueMicrotask(()=>setDraft(localStorage.getItem(key) ?? ''));},[key]);
  useEffect(()=>{if(visible && !dialog.current?.open)dialog.current?.showModal();},[visible]);
  const send=(action:'reply'|'finish')=>{
    if(busy || (action==='reply' && !draft.trim()))return;
    const command:TurnCommand={story_id:session.snapshot.world.story_id,operation_id:uid('op'),base_revision:session.revision,input:action==='reply'?draft.trim():'结束当前对话，继续剧情。',dialogue_action:action,dialogue_id:conversation.id,dialogue_revision:conversation.revision};
    onSend(command);
  };
  useEffect(()=>{
    const sent=conversation.exchanges.at(-1);
    if(sent?.status==='done' && sent.command.dialogue_action==='reply')queueMicrotask(()=>setDraft(old=>{if(old.trim()===sent.command.input){localStorage.removeItem(key);return '';}return old;}));
  },[conversation.revision,conversation.exchanges,key]);
  return <><section className="wa-dialogue"><b>正文已暂停 · 对话进行中</b><p>你扮演 {conversation.player.name}，正在与 {conversation.speaker.speaker_name}交流。</p><button onClick={()=>setVisible(true)}>打开NPC对话窗口</button></section>
    <dialog ref={dialog} className="wa-conversation" aria-labelledby="conversation-title" onCancel={()=>setVisible(false)} onClose={()=>setVisible(false)}>
      <header><div><small>正文已暂停 · 你扮演 {conversation.player.name}</small><h2 id="conversation-title">与{conversation.speaker.speaker_name}对话</h2></div><button type="button" aria-label="暂时收起对话窗口" onClick={()=>{dialog.current?.close();setVisible(false);}}>收起</button></header>
      <div className="wa-chat-log" role="log" aria-label="NPC对话记录" aria-live="polite">{conversation.messages.map((message,index)=><article key={index} data-role={message.role}><b>{message.role==='user'?'你 · ':''}{message.name}</b><p>{message.text}</p></article>)}</div>
      <p role="status">{busy?'NPC正在回应或整理对话，请稍候。':'等待你回应，正文不会自动推进。'}</p>
      {pending && <div role="alert"><p>{pending.error ?? '上一条回应尚未完成，已保留原文。'}</p><button disabled={busy} onClick={()=>onSend({...pending.command,retry_failed:true})}>恢复这条对话</button></div>}
      <form onSubmit={event=>{event.preventDefault();send('reply');}}><label htmlFor="npc-reply">你对NPC的回应</label><textarea id="npc-reply" rows={3} maxLength={12000} value={draft} onChange={event=>{setDraft(event.target.value);localStorage.setItem(key,event.target.value);}} placeholder="以主角身份说话，或用括号描述行动……"/>
      <div className="wa-actions"><button type="submit" disabled={busy || !!pending || !draft.trim()}>发送给NPC</button><button type="button" disabled={busy || !!pending} onClick={()=>send('finish')}>结束对话并继续正文</button></div></form>
      <small>可进行多轮交流。自然结束或点击结束后，主 Agent 会根据整段对话继续故事。</small>
    </dialog></>;
}
