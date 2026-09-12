import {it,expect} from 'vitest';
import {mkdir,writeFile} from 'node:fs/promises';
import {readModelConfig,ChatCompletionsClient} from '@/lib/ai/model';
import {prosePreview} from '@/lib/ai/completion-stream';
// Opt-in, one paid request, isolated telemetry. This measures transport latency, not literary quality.
it.skipIf(process.env.RUN_MODEL_LATENCY!=='1')('measures first readable prose from the configured API',async()=>{
  const config=readModelConfig();const started=Date.now();let first:number|null=null;
  await mkdir('runtime/performance',{recursive:true});
  try {
    const reply=await new ChatCompletionsClient(config,undefined,1024).complete(
      '写原创中文武侠小说。直接输出JSON，content必须是第一个字段。不输出规划或分析。',
      '写一个150至250字的测试场景：雨夜客栈，一位少年发现桌上留着陌生人的信。包含动作、对白和一个悬念。只返回{"content":"正文"}。',
      async raw=>{if(first===null && prosePreview(raw))first=Date.now()-started;});
    const metrics={model:config.model,firstReadableMs:first,totalMs:Date.now()-started,characters:prosePreview(reply.content).length,telemetry:reply.telemetry,scope:'one short synthetic scene; not full pipeline or quality acceptance'};
    await writeFile('runtime/performance/latest-latency.json',JSON.stringify(metrics,null,2));
    console.log(JSON.stringify(metrics));expect(metrics.characters).toBeGreaterThan(0);
  } catch(error) {
    await writeFile('runtime/performance/latest-latency.json',JSON.stringify({model:config.model,firstReadableMs:first,totalMs:Date.now()-started,error:error instanceof Error?error.message:'failed'}));
    throw error;
  }
},310000);
