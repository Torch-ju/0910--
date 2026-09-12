import type { StorySession } from '@/lib/orchestration/contracts';
import { pendingDialogue, playerRole } from '@/lib/orchestration/dialogue';
export function DialoguePanel({session, busy}:{session:StorySession;busy:boolean}) {
  const cue=pendingDialogue(session),player=playerRole(session);
  const exchanges=session.turns.filter(t=>t.prose.dialogue || t.reply_to).slice(-6);
  if(!cue && !exchanges.length)return null;
  return <section className="wa-dialogue" aria-label="角色对话">
    <p className="wa-eyebrow">你正在扮演 · {player.name}</p>
    {cue && <><h2>{cue.speaker_name}正在与你对话</h2><blockquote><b>{cue.speaker_name}</b><p>{cue.utterance}</p></blockquote>
      <p role="status">{busy ? '正在处理剧情，请稍候。你的下一条回应可以先写在下方。' : '正文待生成 · 等待你的回应'}</p>
      <p>你说的话或做出的行动会影响人物态度与后续故事线。可以拒绝、追问，或用括号描述行动。</p></>}
    {exchanges.length>1 && <details><summary>最近的对话</summary><ol>{exchanges.map(turn=><li key={turn.id}>{turn.reply_to && <p><b>你：</b>{turn.input}</p>}{turn.prose.dialogue && <p><b>{turn.prose.dialogue.speaker_name}：</b>{turn.prose.dialogue.utterance}</p>}</li>)}</ol></details>}
  </section>;
}
