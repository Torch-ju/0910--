import { automaticOperationId, StoryProviderError } from "./model";
const scope = globalThis as typeof globalThis & { storyAutomaticCalls?: Map<string, {fingerprint:string; promise:Promise<unknown>}> };
const active = scope.storyAutomaticCalls ??= new Map();
/** Single-process deduplication; every retry keeps its own durable ledger receipt. */
export async function automaticRetry<T>(ledgerPath:string, operationId:string, fingerprint:string, work:(id:string)=>Promise<T>):Promise<T> {
  const key = ledgerPath + ":" + operationId, running = active.get(key);
  if(running) {
    if(running.fingerprint !== fingerprint) throw new StoryProviderError({code:"idempotency_conflict",userMessage:"同一操作不能更换输入。",retryable:false},409);
    return running.promise as Promise<T>;
  }
  const promise = (async () => {
    for(let retry=0; retry<=2; retry++) {
      try {return await work(retry ? automaticOperationId(operationId,retry) : operationId);}
      catch(error) {
        const recoverable = error instanceof StoryProviderError && (error.error.code === "operation_unavailable" || error.error.code === "request_timeout" || (error.error.code === "provider_error" && (error.error.retryable || error.status === 429)));
        if(!recoverable || retry===2) throw error;
        await new Promise(resolve => setTimeout(resolve, 250 * (retry+1)));
      }
    }
    throw Error("Unreachable");
  })();
  active.set(key,{fingerprint,promise});
  try {return await promise;} finally {active.delete(key);}
}
