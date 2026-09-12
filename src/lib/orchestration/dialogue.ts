import proseSchema from '../../../transcription-agent/output.schema.json';
import type { StorySession, ProseOutput, TurnCommand } from './contracts';
import { OrchestrationError } from './contracts';
export const INTERACTIVE_PROSE_SCHEMA = {
  ...proseSchema,
  required: [...proseSchema.required, 'dialogue'],
  properties: { ...proseSchema.properties, dialogue: { anyOf: [
    { type: 'null' },
    { type: 'object', additionalProperties: false, required: ['speaker_id','speaker_name','utterance'], properties: {
      speaker_id: { anyOf: [{type:'null'},{type:'string',minLength:1,maxLength:96}] },
      speaker_name: {type:'string',minLength:1,maxLength:100}, utterance: {type:'string',minLength:1,maxLength:3000},
    } },
  ] } },
};
export function playerRole(session: StorySession) {
  const players=session.snapshot.characters.characters.filter(c=>c.controlled_by==='user');
  // Do not assign the user an arbitrary NPC when no protagonist is defined.
  return players.length===1 ? {id:players[0].character_id,name:players[0].name.value} : {id:null,name:'主角（你）'};
}
export function pendingDialogue(session: StorySession) {
  const turn=session.turns.at(-1);
  return turn?.prose.dialogue ? {turn_id:turn.id,...turn.prose.dialogue} : null;
}
export function assertDialogueReply(session: StorySession, command: TurnCommand) {
  const pending=pendingDialogue(session);
  if(pending && command.reply_to!==pending.turn_id)throw new OrchestrationError('dialogue_reply_required','NPC正在等待主角回应，请在对话框中回答后继续剧情。');
  if(command.reply_to && command.reply_to!==pending?.turn_id)throw new OrchestrationError('stale_dialogue','该对话已结束或已变化，请读取最新剧情后回应。');
}
export function validateDialogue(value: unknown, session: StorySession, reply?: string) {
  const output=value as ProseOutput;
  if(!output || typeof output.content!=='string')return; // JSON schema reports the structural issue.
  if(reply && !output.content.includes(reply))throw new Error('正文必须逐字保留用户回应，不能替主角改写回答。');
  const cue=output.dialogue;
  const players=session.snapshot.characters.characters.filter(c=>c.controlled_by==='user');
  const names=players.flatMap(c=>[c.name.value,...c.aliases]).filter(Boolean);
  const unauthorized=reply ? output.content.replace(reply,'') : output.content;
  // Check explicit speaker attribution without assigning arbitrary NPC speech to the player.
  for(const name of names) {
    for(const suffix of unauthorized.split(name).slice(1)) {
      if(/^(?:轻声|低声|笑着|点头|随即|立刻|沉声|开口|回答|答道|说道|说|道|回应|承诺){1,4}[：:,，]?\s*[“「][^”」]/.test(suffix))
        throw new Error('不得代替主角编写对白或承诺；保留用户原话，在NPC等待回应处停笔。');
    }
  }
  if(!cue) {
    const quoted=[...unauthorized.matchAll(/[“「]([^”」]+)[”」]/g)].map(m=>m[1]);
    if(quoted.some(line=>/(你|您|阁下|少侠).*(?:[？?]|小心|答应|愿意|看看|如何|跟我|过来|拿着)/.test(line)))
      throw new Error('NPC已发出面向主角的问话、提醒或选择，不能返回空dialogue。请在首次发言处停笔并填写对话停点，不写主角回答。');
    return;
  }
  if(typeof cue.utterance!=='string' || typeof cue.speaker_name!=='string')return;
  const character=session.snapshot.characters.characters.find(c=>c.character_id===cue.speaker_id);
  if(cue.speaker_id && !character)throw new Error('对话人物ID不存在；新人物的speaker_id应为null。');
  if(character?.controlled_by==='user' || session.snapshot.characters.characters.some(c=>c.controlled_by==='user' && c.name.value===cue.speaker_name))throw new Error('对话停点必须由NPC向主角发起，不能替主角发言。');
  if(character && character.name.value!==cue.speaker_name)throw new Error('对话人物姓名与ID不一致。');
  const at=output.content.lastIndexOf(cue.utterance);
  if(at<0 || !/^[\s”"'’」』。！？!?]*$/.test(output.content.slice(at+cue.utterance.length)))throw new Error('正文必须在NPC的原文台词之后立即结束，不能越过对话替用户回答。');
}
