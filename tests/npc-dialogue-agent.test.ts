import {expect,it,vi} from 'vitest';
import {fixture} from './narrative-fixture';
import {MainAgent} from '@/lib/orchestration/main-agent';
import {NarrativeAgents} from '@/lib/orchestration/agents';
import {INTERACTIVE_PROSE_PROMPT,PROMPTS} from '@/lib/orchestration/prompts';
import {NPC_DIALOGUE_PROMPT,attributeConversationEvidence} from '@/lib/orchestration/npc-dialogue';
import type {StorySession,TurnCommand} from '@/lib/orchestration/contracts';
import {StoryManager} from '@/lib/orchestration/manage';
import {SessionStore} from '@/lib/orchestration/store';
import {join} from 'node:path';
async function setup(){
 const {main,model,command,directory}=await fixture();
 const calls:string[]=[];let failNpc=false,finishNpc=false,failSummary=false;
 const agent=new MainAgent(main.store,new NarrativeAgents({generate:async(id,system,input)=>{
  if(system===NPC_DIALOGUE_PROMPT){calls.push('npc');if(failNpc)throw Error('network');return {utterance:finishNpc?'那我们去找掌柜。':'信还没打开，你想知道什么？',finished:finishNpc};}
  if(system===INTERACTIVE_PROSE_PROMPT){calls.push('prose');const scene=input as {story_state?:unknown};expect(scene.story_state).toBeTruthy();return {content:'雨声中，沈砚问：“你要看看这封信吗？”',current_time:'夜',current_location:'客栈',new_facts:[],timeline_updates:[],foreshadowing:[],chapter_end_hook:'等候回答',dialogue:{speaker_id:'npc_shen',speaker_name:'沈砚',utterance:'你要看看这封信吗？'}};}
  calls.push(system===PROMPTS.summary?'summary':'memory');if(system===PROMPTS.summary && failSummary)throw Error('summary network');return model.generate(id,system);
 }}));
 return {agent,calls,command,directory,setFail:(value:boolean)=>{failNpc=value;},setFinish:(value:boolean)=>{finishNpc=value;},setSummaryFail:(value:boolean)=>{failSummary=value;}};
}
function reply(session:StorySession,id:string,input='我想先看信封。',action:'reply'|'finish'='reply'):TurnCommand{
 const c=session.conversations!.find(c=>c.status==='active')!;
 return {story_id:session.snapshot.world.story_id,operation_id:id,base_revision:session.revision,input,dialogue_action:action,dialogue_id:c.id,dialogue_revision:c.revision};
}
it('pauses before memory/summary, supports multiple NPC exchanges, and automatically repeats the narrative/dialogue loop',async()=>{
 const {agent,calls,command}=await setup();let session=await agent.turn(command);
 expect(calls).toEqual(['prose']);expect(session.turns).toHaveLength(0);expect(session.runs[0].status).toBe('waiting_dialogue');
 await expect(agent.turn({...command,operation_id:'op_bypass'})).rejects.toMatchObject({code:'unfinished_run'});
 const first=reply(session,'op_chat_one');session=await agent.turn(first);expect(calls).toEqual(['prose','npc']);expect(session.conversations![0].messages).toHaveLength(3);expect(session.turns).toHaveLength(0);
 await agent.turn(first);expect(calls).toHaveLength(2);
 await expect(agent.turn({...first,operation_id:'op_stale'})).rejects.toMatchObject({code:'stale_dialogue'});
 session=await agent.turn(reply(session,'op_chat_two','你为什么把信交给我？'));expect(calls).toEqual(['prose','npc','npc']);expect(session.conversations![0].messages).toHaveLength(5);
 const finish=reply(session,'op_end','结束对话','finish');session=await agent.turn(finish);
 expect(calls).toEqual(['prose','npc','npc','memory','summary','prose']);
 expect(session.turns).toHaveLength(1);expect(session.turns[0].prose.content).toContain('我想先看信封。');expect(session.turns[0].prose.content).toContain('你为什么把信交给我？');
 expect(session.conversations![0].status).toBe('closed');expect(session.conversations![1].status).toBe('active');
 await agent.turn(finish);expect(calls).toHaveLength(6);
 session=await agent.turn(reply(session,'op_second_end','结束下一次对话','finish'));expect(session.conversations).toHaveLength(3);expect(session.turns).toHaveLength(2);
});
it('keeps failed user input and only retries the NPC reply; a natural dialogue ending resumes prose',async()=>{
 const {agent,calls,command,setFail,setFinish}=await setup();let session=await agent.turn(command);const input=reply(session,'op_failed','这封信是谁写的？');setFail(true);
 await expect(agent.turn(input)).rejects.toThrow();session=await agent.status(command.story_id);expect(session.conversations![0].exchanges[0].command.input).toBe(input.input);expect(session.conversations![0].messages).toHaveLength(1);
 setFail(false);setFinish(true);session=await agent.turn({...input,retry_failed:true});expect(session.turns).toHaveLength(1);expect(session.conversations![1].status).toBe('active');expect(calls.filter(c=>c==='prose')).toHaveLength(2);
});
it('recovers a failure after dialogue ends without regenerating NPC messages or completed prose',async()=>{
 const {agent,calls,command,setSummaryFail}=await setup();let session=await agent.turn(command);session=await agent.turn(reply(session,'op_reply'));const end=reply(session,'op_finish','结束','finish');setSummaryFail(true);
 session=await agent.turn(end);expect(session.runs[0].status).toBe('blocked');expect(session.conversations![0].status).toBe('ready');
 setSummaryFail(false);session=await agent.turn({...end,retry_failed:true});expect(session.turns).toHaveLength(1);expect(calls.filter(c=>c==='npc')).toHaveLength(1);expect(calls.filter(c=>c==='memory')).toHaveLength(1);expect(calls.filter(c=>c==='prose')).toHaveLength(2);
});
it('exports and restores an active multi-round dialogue without generating or losing its paused prose',async()=>{
 const {agent,calls,command,directory}=await setup();let session=await agent.turn(command);session=await agent.turn(reply(session,'op_reply'));const count=calls.length;
 const backup=await new StoryManager(agent).backup(command.story_id);
 const restored=await new StoryManager(new MainAgent(new SessionStore(join(directory,'imported')))).restore(backup);
 expect(restored.conversations![0].messages).toEqual(session.conversations![0].messages);expect(restored.runs[0].status).toBe('waiting_dialogue');expect(restored.runs[0].steps.transcription?.result).toEqual(session.runs[0].steps.transcription?.result);expect(calls).toHaveLength(count);
});

it('resumes exactly once after a crash between committing dialogue and starting the next scene',async()=>{
 const {agent,calls,command}=await setup();const session=await agent.turn(command);
 const end=reply(session,'op_finish_crash','结束','finish'),nextId=session.conversations![0].continuation_id;
 const original=agent.turn.bind(agent);let fail=true;
 vi.spyOn(agent,'turn').mockImplementation(async(c,options)=>{if(c.operation_id===nextId && fail){fail=false;throw Error('process exited before continuation');}return original(c,options);});
 await expect(agent.turn(end)).rejects.toThrow('process exited');
 const committed=await agent.status(command.story_id);expect(committed.turns).toHaveLength(1);expect(committed.conversations![0].status).toBe('closed');
 const recovered=await agent.turn({...end,retry_failed:true});expect(recovered.conversations![1].status).toBe('active');expect(calls).toEqual(['prose','memory','summary','prose']);
 await agent.turn(end);expect(calls).toHaveLength(4);
});
it('recovers a persisted NPC result when its final message save fails, without paying for the answer again',async()=>{
 const {agent,calls,command}=await setup();const session=await agent.turn(command),answer=reply(session,'op_save_failed');
 const save=agent.store.save.bind(agent.store);let fail=true;
 vi.spyOn(agent.store,'save').mockImplementation(async value=>{if(fail && value.conversations?.[0].messages.length===3){fail=false;throw Error('disk write failed');}return save(value);});
 await expect(agent.turn(answer)).rejects.toThrow('disk write failed');
 const recovered=await agent.turn({...answer,retry_failed:true});expect(recovered.conversations![0].messages).toHaveLength(3);expect(calls).toEqual(['prose','npc']);
});

it('keeps unsupported NPC details as attributed claims instead of narrator facts',async()=>{
 const {agent,command}=await setup();const session=await agent.turn(command),conversation=session.conversations![0];
 conversation.messages.push({role:'npc',name:'沈砚',text:'送信人虎口有旧疤。',operation_id:'op_claim'});
 const extraction={mentions:[],events:[],facts:[{evidence:{quote:'虎口有旧疤',sourceKind:'narration'}},{evidence:{quote:'雨落客栈',sourceKind:'narration'}}],relationships:[],identities:[]};
 const result=attributeConversationEvidence(extraction,conversation);
 expect(result.facts[0].evidence.sourceKind).toBe('character_statement');expect(result.facts[1].evidence.sourceKind).toBe('narration');expect(extraction.facts[0].evidence.sourceKind).toBe('narration');
});
