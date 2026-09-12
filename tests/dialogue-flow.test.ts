import {createHash} from "node:crypto";
import type {TurnCommand} from "@/lib/orchestration/contracts";
import {expect,it} from 'vitest';
import {fixture} from './narrative-fixture';
import {MainAgent} from '@/lib/orchestration/main-agent';
import {NarrativeAgents} from '@/lib/orchestration/agents';
import {INTERACTIVE_PROSE_PROMPT,PROMPTS} from '@/lib/orchestration/prompts';
import {pendingDialogue,validateDialogue,playerRole} from '@/lib/orchestration/dialogue';
import {StoryManager} from '@/lib/orchestration/manage';
import {SessionStore} from '@/lib/orchestration/store';
import {join} from 'node:path';
it('pauses at NPC speech and carries the exact player answer into the next scene, with durable replay',async()=>{
  const {main,session,model,command,directory}=await fixture();
  const requests:unknown[]=[];let proseCalls=0,failReplySummary=false;
  const agent=new MainAgent(main.store,new NarrativeAgents({generate:async(id,system,input,_schema,refine)=>{
    if(system===PROMPTS.summary && failReplySummary)throw Error("reply summary interrupted");
    if(system!==INTERACTIVE_PROSE_PROMPT)return model.generate(id,system);
    proseCalls++;requests.push(input);
    const reply=(input as {npc_response?:{player_response:string}}).npc_response?.player_response;
    const line=reply?'你想先查信封，还是去问掌柜？':'你愿意和我一起查看这封信吗？';
    const output={content:(reply?'林青回答：“'+reply+'”沈砚把信放在桌上。':'雨声中，沈砚取出一封信。')+'沈砚问：“'+line+'”',current_time:'二更',current_location:'客栈',new_facts:[],timeline_updates:[],foreshadowing:['信'],chapter_end_hook:'等待回应',dialogue:{speaker_id:'npc_shen',speaker_name:'沈砚',utterance:line}};
    refine?.(output);return output;
  }}));
  const first=await legacyTurn(agent,command);expect(first.runs[0].status).toBe('succeeded');
  expect(playerRole(first)).toEqual({id:'npc_lin',name:'林青'});expect(pendingDialogue(first)?.turn_id).toBe(command.operation_id);expect(proseCalls).toBe(1);
  const saved=await main.status(command.story_id);expect(pendingDialogue(saved)).toEqual(pendingDialogue(first));
  const next={...command,operation_id:'op_reply',base_revision:2,input:'我先看信封，不打开信。'};
  await expect(legacyTurn(agent,next)).rejects.toMatchObject({code:'dialogue_reply_required'});
  await expect(legacyTurn(agent,{...next,reply_to:'op_wrong'})).rejects.toMatchObject({code:'dialogue_reply_required'});expect(proseCalls).toBe(1);
  const answer={...next,reply_to:command.operation_id};failReplySummary=true;
  const blocked=await legacyTurn(agent,answer);expect(blocked.runs.at(-1)?.status).toBe('blocked');
  expect(blocked.runs.at(-1)?.reply_to).toBe(command.operation_id);
  expect(pendingDialogue(blocked)?.turn_id).toBe(command.operation_id);
  failReplySummary=false;const second=await legacyTurn(agent,{...answer,retry_failed:true});
  expect(second.turns).toHaveLength(2);expect(second.turns[1].reply_to).toBe(command.operation_id);
  expect(second.turns[1].prose.content).toContain(answer.input);expect(requests[1]).toMatchObject({npc_response:{turn_id:command.operation_id,player_response:answer.input},player:{id:'npc_lin'}});
  expect(pendingDialogue(second)?.utterance).toContain('查信封');
  expect((await legacyTurn(agent,answer)).turns).toHaveLength(2);expect(proseCalls).toBe(2);
  await expect(legacyTurn(agent,{...answer,input:'换一个回答'})).rejects.toMatchObject({code:'idempotency_conflict'});
  const manager=new StoryManager(agent);const backup=await manager.backup(command.story_id);
  const target=new StoryManager(new MainAgent(new SessionStore(join(directory,'restored')),new NarrativeAgents(model)));
  const restored=await target.restore(backup);expect(pendingDialogue(restored)).toEqual(pendingDialogue(second));
  expect(session.turns).toHaveLength(0);
});
it('rejects dialogue that speaks for the player, continues past the question, or changes the answer',async()=>{
  const {session}=await fixture();
  const base={content:'沈砚问：“你是谁？”',current_time:'夜',current_location:'客栈',new_facts:[],timeline_updates:[],foreshadowing:[],chapter_end_hook:'问话',dialogue:{speaker_id:'npc_shen',speaker_name:'沈砚',utterance:'你是谁？'}};
  expect(()=>validateDialogue(base,session)).not.toThrow();
  expect(()=>validateDialogue({...base,content:base.content+'林青答应了。'},session)).toThrow('立即结束');
  expect(()=>validateDialogue({...base,dialogue:{...base.dialogue,speaker_id:'npc_lin',speaker_name:'林青'}},session)).toThrow('不能替主角');
  expect(()=>validateDialogue(base,session,'我拒绝。')).toThrow('逐字保留');
});
it('retains a pending question when a reply fails and reuses completed prose on recovery',async()=>{
  const {main,model,command}=await fixture();let fail=true,prose=0;
  const agent=new MainAgent(main.store,new NarrativeAgents({generate:async(id,system)=>{
    if(system===INTERACTIVE_PROSE_PROMPT){prose++;return {content:'沈砚问：“你是谁？”',current_time:'夜',current_location:'客栈',new_facts:[],timeline_updates:[],foreshadowing:[],chapter_end_hook:'问话',dialogue:{speaker_id:'npc_shen',speaker_name:'沈砚',utterance:'你是谁？'}};}
    if(system===PROMPTS.summary && fail)throw Error('offline');return model.generate(id,system);
  }}));
  const blocked=await legacyTurn(agent,command);expect(blocked.turns).toHaveLength(0);expect(pendingDialogue(blocked)).toBeNull();
  fail=false;const done=await legacyTurn(agent,{...command,retry_failed:true});expect(pendingDialogue(done)?.utterance).toBe('你是谁？');expect(prose).toBe(1);
});

// Explicitly retain coverage of pre-upgrade interactive_v1 receipts and backups.
async function legacyTurn(agent:MainAgent,command:TurnCommand){
 const session=await agent.status(command.story_id);
 if(!session.runs.some(r=>r.operation_id===command.operation_id)){
   const fingerprint=createHash('sha256').update(JSON.stringify({story_id:command.story_id,input:command.input,base_revision:command.base_revision,close_chapter:command.close_chapter??false,...(command.reply_to?{reply_to:command.reply_to}:{})})).digest('hex');
   // Invalid reply tests must fail before creating a pending run.
   const pending=pendingDialogue(session);if(pending && command.reply_to!==pending.turn_id)return agent.turn(command);
   session.runs.push({pipeline:'interactive_v1',operation_id:command.operation_id,fingerprint,base_revision:command.base_revision,input:command.input,close_chapter:command.close_chapter??false,...(command.reply_to?{reply_to:command.reply_to}:{}),status:'running',steps:{},created_at:new Date().toISOString()});await agent.store.save(session);
 }
 return agent.turn(command);
}

it('rejects missing interaction cues and invented player speech while allowing quiet transitions',async()=>{
  const {session}=await fixture();
  expect(()=>validateDialogue({content:'沈砚问：“你愿意看看这封信吗？”',dialogue:null},session)).toThrow('空dialogue');
  expect(()=>validateDialogue({content:'林青说道：“我答应。”',dialogue:null},session)).toThrow('不得代替主角');
  expect(()=>validateDialogue({content:'夜雨落在无人山道上。',dialogue:null},session)).not.toThrow();
  expect(()=>validateDialogue({content:'林青说道：“我答应。”',dialogue:null},session,'我答应。')).not.toThrow();
});
