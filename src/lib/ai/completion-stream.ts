export class StreamProgressError extends Error {}
type Usage = {prompt_tokens?:unknown;completion_tokens?:unknown;total_tokens?:unknown};
export type CompletionPayload = {choices?:{message?:{content?:string};finish_reason?:string}[];usage?:Usage};
export async function readCompletion(response:Response, progress?:(text:string)=>Promise<void>):Promise<CompletionPayload> {
  if(!response.headers.get("content-type")?.includes("text/event-stream")) return response.json();
  if(!response.body) throw Error("Empty model stream");
  const reader=response.body.getReader(), decoder=new TextDecoder();
  let buffer="", data:string[]=[], content="", reason:string|undefined, usage:Usage|undefined;
  const dispatch=async()=>{
    if(!data.length)return;const raw=data.join("\n");data=[];
    if(raw==="[DONE]")return;
    const event=JSON.parse(raw);if(event.error)throw Error("Model stream error");
    const choice=event.choices?.find((c:{index?:number})=>c.index===0) ?? event.choices?.[0];
    if(typeof choice?.delta?.content==="string") {content+=choice.delta.content;try { await progress?.(content); } catch (error) { console.error("preview progress skipped:", error); }}
    if(choice?.finish_reason)reason=choice.finish_reason;
    if(event.usage)usage=event.usage;
  };
  const line=async(value:string)=>{if(value.endsWith("\r"))value=value.slice(0,-1);if(!value)await dispatch();else if(value.startsWith("data:"))data.push(value.slice(5).trimStart());};
  try {
    while(true){const chunk=await reader.read();buffer+=decoder.decode(chunk.value,{stream:!chunk.done});let at:number;while((at=buffer.indexOf("\n"))>=0){await line(buffer.slice(0,at));buffer=buffer.slice(at+1);}if(chunk.done)break;}
    if(buffer)await line(buffer);await dispatch();
    if(!reason)throw Error("Model stream ended without completion");
    return {choices:[{message:{content},finish_reason:reason}],usage};
  } finally { await reader.cancel().catch(()=>{});reader.releaseLock(); }
}
/** A preview only: never used for facts, memories or final validation. */
export function prosePreview(raw:string):string {
  const match=/"content"\s*:\s*"((?:[^"\\]|\\[\s\S])*)/.exec(raw);
  if(!match)return "";
  const value=match[1];
  // An escape may be split across chunks. Trim only the unfinished suffix.
  for(let trim=0;trim<=6 && trim<=value.length;trim++){
    try{return JSON.parse('"'+value.slice(0,value.length-trim)+'"');}catch{}
  }
  return "";
}
