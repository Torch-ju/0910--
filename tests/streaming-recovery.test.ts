import {expect,it} from 'vitest';
import {fixture} from './narrative-fixture';
import {MainAgent} from '@/lib/orchestration/main-agent';
import {NarrativeAgents} from '@/lib/orchestration/agents';
import {PROMPTS,INTERACTIVE_PROSE_PROMPT} from '@/lib/orchestration/prompts';
it('persists previews without publishing facts, then recovers only the failed summary',async()=>{
  const {main,model,command}=await fixture();let failSummary=true,previews=0;
  const agent=new MainAgent(main.store,new NarrativeAgents({generate:async(id,system,_input,_schema,_refine,progress)=>{
    if(system===PROMPTS.summary && failSummary)throw Error('offline');
    if(system===INTERACTIVE_PROSE_PROMPT){
      await progress?.('{"content":"雨落');previews++;
      const pending=await main.store.load(command.story_id);
      if(!pending)throw Error("missing session");
      expect(pending.turns).toHaveLength(0);expect(pending.memory_journal).toHaveLength(0);
      expect(pending.runs[0].pipeline).toBe('dialogue_v2');
      expect(pending.runs[0].steps.transcription?.preview).toBe('雨落');
      expect(pending.runs[0].steps.transcription?.first_content_at).toBeTruthy();
    }
    return model.generate(id,system);
  }}));
  const failed=await agent.turn(command);
  expect(failed.runs[0].status).toBe('blocked');expect(failed.runs[0].steps.transcription?.status).toBe('done');
  expect(failed.turns).toHaveLength(0);expect(failed.runs[0].steps.transcription?.completed_at).toBeTruthy();
  failSummary=false;const restored=await agent.turn({...command,retry_failed:true});
  expect(restored.turns).toHaveLength(1);expect(previews).toBe(1);expect(model.calls).toBe(3);
});
