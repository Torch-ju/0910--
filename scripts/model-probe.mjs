import { createHash, randomUUID } from "node:crypto";
import { ChatCompletionsClient, RequestLedger, StoryProviderError, readModelConfig } from "../src/lib/ai/model.ts";
const config=readModelConfig();
const ledger=new RequestLedger();
const operationId="op_probe_"+randomUUID().replaceAll("-","");
const fingerprint=createHash("sha256").update("minimal-text-connectivity:"+config.model).digest("hex");
await ledger.reserve(operationId,fingerprint,config.limit,"initial",config.model);
try {
  const reply=await new ChatCompletionsClient(config,fetch,64).complete("You are a text assistant. Answer briefly.","请只回复 OK，不要解释。");
  await ledger.settleAttempt(operationId,reply.telemetry);
  await ledger.finish(operationId,"success",{diagnostic:true,content:reply.content});
  console.log(JSON.stringify({operationId,status:"success",reply:reply.content,telemetry:reply.telemetry}));
} catch(error) {
  const detail=error instanceof StoryProviderError?error.error:{code:"diagnostic_error",userMessage:"诊断请求未完成。",retryable:false};
  if(error instanceof StoryProviderError&&error.telemetry)await ledger.settleAttempt(operationId,error.telemetry);
  await ledger.finish(operationId,"uncertain",undefined,detail);
  console.log(JSON.stringify({operationId,status:"failed",error:detail,telemetry:error instanceof StoryProviderError?error.telemetry:undefined}));
  process.exitCode=1;
}
