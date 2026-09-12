import {it,expect} from 'vitest';
import {mkdir,writeFile} from 'node:fs/promises';
import {NarrativeAgents,checked} from '@/lib/orchestration/agents';
import {NarrativeModelClient} from '@/lib/orchestration/model';
import {RequestLedger} from '@/lib/ai/model';
import {NPC_REPLY_SCHEMA} from '@/lib/orchestration/npc-dialogue';
// Explicit opt-in. Synthetic story; never reads or modifies a user's live novel.
it.skipIf(process.env.RUN_NPC_DIALOGUE_EVAL!=='1')('exchanges two live NPC messages without generating narrative or inventing a player reply',async()=>{
 const directory='runtime/dialogue-evaluation/'+Date.now();await mkdir(directory,{recursive:true});
 const agents=new NarrativeAgents(new NarrativeModelClient(new RequestLedger(directory+'/ledger.json')));
 const messages=[{role:'npc',name:'沈砚',text:'这封信，你要拆开看看吗？'}];
 const input={speaker:{speaker_id:'npc_shen',speaker_name:'沈砚',utterance:messages[0].text},player:{id:'npc_lin',name:'林青'},background:'雨夜客栈。沈砚收到灰衣陌生人送来的封口信；他没有拆开信，不知道内容，也不知道送信人姓名。林青由用户扮演。',scene:'沈砚将未拆的信递到林青面前，正在等待回应。',memory:{summary:'送信人未透露身份。'}};
 const results=[];
 for(const [index,text] of ['先别拆信。这封信是谁给你的？','那个送信人还有什么特征？你能再想想吗？'].entries()){
  messages.push({role:'user',name:'林青',text});const start=Date.now();
  const result=checked<{utterance:string;finished:boolean}>(await agents.npcDialogue('op_dialogue_live_'+index,{...input,messages}),NPC_REPLY_SCHEMA);
  results.push({input:text,...result,durationMs:Date.now()-start});messages.push({role:'npc',name:'沈砚',text:result.utterance});
 }
 await writeFile(directory+'/result.json',JSON.stringify({scope:'two NPC exchanges only; not full live pipeline acceptance',results},null,2));
 console.log(directory);expect(results.every(r=>r.finished===false)).toBe(true);
},310000);
