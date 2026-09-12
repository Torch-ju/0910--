import { createHash } from 'node:crypto';
import { StoryProviderError } from '@/lib/ai/model';
import { restoreMemory } from './memory';
import { creativeSnapshot } from './creative-context';
import { checked, type NarrativeAgents } from './agents';
import type { MainAgent } from './main-agent';
import { OrchestrationError, type StorySession, type TurnCommand, type Conversation, type ProseOutput } from './contracts';
import { assertId } from './store';
export const NPC_REPLY_SCHEMA = {type:'object',additionalProperties:false,required:['utterance','finished'],properties:{utterance:{type:'string',minLength:1,maxLength:4000},finished:{type:'boolean'}}};
export const NPC_DIALOGUE_PROMPT = `你是小说的NPC对话Agent，只扮演speaker指定的NPC，用户扮演player。根据background、scene、memory和完整messages对话交流，尊重NPC的动机、身份、已知/未知信息及当前关系。不得代替用户说话、决定、行动；用户的愿望不自动变成成功结果，自述不自动变为事实。只返回当前NPC的一次发言，不生成接下来的正文或用户回复。不输出场外的分析、待办和建议选项。utterance是NPC原话，可包含简短动作，但不得编造用户反应。finished=false表示对话尚在进行；只有本话题自然结束、NPC告辞或双方已经明确转入行动时才true。追问、质问、等待用户选择时必须false。不得因为用户只说了一句话就自动结束。已有信息没有记载或明确未知的过去细节，必须承认不知道；不能为了回答追问编造疤痕、衣着、身份、地点、信件内容或此前行动。可描写此刻自己的简短动作与态度，不能把新增线索伪装成既有记忆。只能输出合法JSON对象，禁止直接输出台词或Markdown代码块。返回{utterance:string,finished:boolean}。`;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const continuationId=(id:string)=>'op_'+digest(['dialogue-continuation',id]).slice(0,48);
export function conversationProse(prose:ProseOutput, conversation:Conversation):ProseOutput {
  const lines=conversation.messages.slice(1).map(message=>`${message.name}${message.role==='user'?'回应':'说'}：“${message.text}”`);
  return {...prose,content:[prose.content,...lines].join('\n\n'),dialogue:null};
}
/** One operation per player message. No loop asks the model to invent user input. */
export class NpcDialogueAgent {
  constructor(private readonly main:MainAgent,private readonly agents:NarrativeAgents){}
  async handle(command:TurnCommand, options?:{shouldCancel:()=>Promise<boolean>}):Promise<StorySession> {
    assertId(command.story_id);assertId(command.operation_id);assertId(command.dialogue_id ?? '');
    if(!['reply','finish'].includes(command.dialogue_action ?? '') || !Number.isInteger(command.dialogue_revision) || !command.input?.trim() || command.input.length>12000)throw new OrchestrationError('invalid_dialogue','对话操作、回应或版本无效。',400);
    const snapshot=await this.main.store.exclusive(command.story_id,async()=>{
      const session=await this.main.status(command.story_id);
      const conversation=session.conversations?.find(c=>c.id===command.dialogue_id);
      if(!conversation)throw new OrchestrationError('dialogue_not_found','对话不存在，请刷新。',404);
      if(conversation.status==='abandoned')throw new OrchestrationError('dialogue_abandoned','此对话已放弃。');
      const fingerprint=digest({...command,retry_failed:undefined});
      let exchange=conversation.exchanges.find(e=>e.command.operation_id===command.operation_id);
      if(exchange && exchange.fingerprint!==fingerprint)throw new OrchestrationError('idempotency_conflict','该对话操作ID已用于另一回答。');
      if(exchange?.status==='done')return session;
      if(session.revision!==command.base_revision || conversation.revision!==command.dialogue_revision)throw new OrchestrationError('stale_dialogue','对话已更新，请读取最新消息再回应。');
      if(conversation.status!=='active')throw new OrchestrationError('dialogue_ended','此对话已结束，请继续正文。');
      if(conversation.exchanges.some(e=>e!==exchange && e.status!=='done'))throw new OrchestrationError('dialogue_pending','上一条回应尚未完成，请先恢复。');
      if(await options?.shouldCancel())throw new OrchestrationError('task_cancelled','对话请求已停止，未调用模型。');
      if(!exchange){
        exchange={command:structuredClone(command),fingerprint,status:'running',attempt:1,model_id:'op_'+digest([conversation.id,command.operation_id,1]).slice(0,48)};
        conversation.exchanges.push(exchange);await this.main.store.save(session);
      } else if(!exchange.result && !(await this.agents.hasCompleted(exchange.model_id))) {
        if(!command.retry_failed)throw new OrchestrationError('dialogue_retry_required','上一条对话中断，可恢复已保存的回应。');
        exchange.attempt++;exchange.model_id='op_'+digest([conversation.id,command.operation_id,exchange.attempt]).slice(0,48);
      }
      exchange.status='running';delete exchange.error;await this.main.store.save(session);
      try {
        if(command.dialogue_action==='reply') {
          const run=session.runs.find(r=>r.operation_id===conversation.run_id)!;
          const scene=run.steps.transcription?.result as ProseOutput;
          const memory=await restoreMemory(session);
          const known=await memory.repository.getExtractionContext(command.story_id);
          const result=exchange.result ?? checked<{utterance:string;finished:boolean}>(await this.agents.npcDialogue(exchange.model_id,{
            speaker:conversation.speaker,player:conversation.player,background:creativeSnapshot(session.snapshot),scene,
            memory:{summary:session.summary,known},messages:[...conversation.messages,{role:'user',name:conversation.player.name,text:command.input}],
          }),NPC_REPLY_SCHEMA);
          exchange.result=result;await this.main.store.save(session); // A recovery reuses this answer even if final persistence fails.
          conversation.messages.push({role:'user',name:conversation.player.name,text:command.input,operation_id:command.operation_id},{role:'npc',name:conversation.speaker.speaker_name,text:result.utterance,operation_id:command.operation_id});
          if(result.finished)conversation.status='ready';
        } else conversation.status='ready';
        exchange.status='done';conversation.revision++;await this.main.store.save(session);return session;
      } catch(error) {
        const durable=await this.main.status(command.story_id);
        const saved=durable.conversations!.find(c=>c.id===conversation.id)!.exchanges.find(e=>e.command.operation_id===command.operation_id)!;
        if(saved.status==='done')return durable;
        saved.status='failed';saved.error=error instanceof StoryProviderError?error.error.userMessage:error instanceof Error?error.message:'NPC对话中断。';
        await this.main.store.save(durable);throw error;
      }
    });
    const conversation=snapshot.conversations!.find(c=>c.id===command.dialogue_id)!;
    if(conversation.status==='active')return snapshot;
    // Each continuation has a persisted, deterministic ID. Replaying a finish cannot add a second scene.
    const parent=snapshot.runs.find(r=>r.operation_id===conversation.run_id)!;
    const finalized=await this.main.turn({story_id:command.story_id,operation_id:parent.operation_id,base_revision:parent.base_revision,input:parent.input,close_chapter:parent.close_chapter,...(parent.reply_to?{reply_to:parent.reply_to}:{}),retry_failed:true},options);
    if(finalized.runs.find(r=>r.operation_id===parent.operation_id)?.status!=='succeeded')return finalized;
    const closed=finalized.conversations!.find(c=>c.id===conversation.id)!;
    return this.main.turn({story_id:command.story_id,operation_id:closed.continuation_id,base_revision:closed.continuation_revision!,input:'对话阶段已经结束。承接刚才交流的真实内容和人物态度继续剧情，体现用户明确选择的后果；未获答复的问题仍未获答复，结束对话不代表主角同意。推进到下一次需要主角回应的NPC对话即停笔。'},options);
  }
}

/** Quoted dialogue is a character claim, never upgraded to narrator-confirmed history. */
export function attributeConversationEvidence<T extends {mentions: {evidence:{quote:string;sourceKind:string}}[];events:{evidence:{quote:string;sourceKind:string}}[];facts:{evidence:{quote:string;sourceKind:string}}[];relationships:{evidence:{quote:string;sourceKind:string}}[];identities:{evidence:{quote:string;sourceKind:string}}[]}>(extraction:T,conversation:Conversation):T {
  const copy=structuredClone(extraction);
  const sources=conversation.messages.flatMap(m=>[m.text,`${m.name}${m.role==='user'?'回应':'说'}：“${m.text}”`]);
  for(const item of [...copy.mentions,...copy.events,...copy.facts,...copy.relationships,...copy.identities]){
    if(['narration','explicit_identity_reveal'].includes(item.evidence.sourceKind) && item.evidence.quote && sources.some(text=>text.includes(item.evidence.quote)))item.evidence.sourceKind='character_statement';
  }
  return copy;
}
