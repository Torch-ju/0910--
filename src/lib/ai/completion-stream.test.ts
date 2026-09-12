import { describe, expect, it, vi } from "vitest";
import { readCompletion, prosePreview } from "./completion-stream";
import { ChatCompletionsClient } from "./model";
function stream(text:string) {
  const bytes=new TextEncoder().encode(text);
  return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close();}}),{headers:{"content-type":"text/event-stream"}});
}
const event=(content:string,finish_reason:string|null=null)=>'data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason}]})+'\r\n\r\n';
describe("prose streaming",()=>{
  it("decodes split Chinese bytes, escapes, usage and ignores stream comments",async()=>{
    const pieces=['{"content":"雨落','江湖。\\n他道：\\"走吧\\"。','","current_time":"夜"}'];
    const previews:string[]=[];
    const response=stream(': heartbeat\r\n\r\n'+pieces.map(p=>event(p)).join('')+event('','stop')+'data: {"choices":[],"usage":{"total_tokens":42}}\r\n\r\ndata: [DONE]\r\n\r\n');
    const result=await readCompletion(response,async raw=>{previews.push(prosePreview(raw));});
    expect(previews[0]).toBe('雨落');expect(previews.at(-1)).toBe('雨落江湖。\n他道："走吧"。');
    expect(result.usage?.total_tokens).toBe(42);expect(result.choices?.[0].message?.content).toBe(pieces.join(''));
  });
  it("waits for a real finish marker and never accepts a disconnected partial result",async()=>{
    await expect(readCompletion(stream(event('{"content":"残段')))).rejects.toThrow('without completion');
    expect(prosePreview('{"content":"雨\\u4')).toBe('雨');
    expect(prosePreview('{"current_time":"夜"}')).toBe('');
  });
  it("accepts a JSON response when a provider does not stream",async()=>{
    const payload={choices:[{message:{content:'{"content":"完整"}'},finish_reason:'stop'}]};
    expect(await readCompletion(Response.json(payload))).toEqual(payload);
  });
  it("requests streaming without imposing a prose token limit and marks local save failures non-retryable",async()=>{
    const fetcher=vi.fn(async()=>stream(event('{"content":"雨落"}')+event('','stop')));
    const client=new ChatCompletionsClient({baseUrl:'http://localhost',model:'test',apiKey:'fake'},fetcher,null);
    await expect(client.complete('system','input',async()=>{throw Error('disk full');})).rejects.toMatchObject({error:{code:'preview_save_failed',retryable:false}});
    const body=JSON.parse((fetcher.mock.calls as unknown as [string,RequestInit][])[0][1].body as string);
    expect(body.stream).toBe(true);expect(body.max_tokens).toBeUndefined();expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

it("requests structured JSON for the NPC dialogue client",async()=>{
  let sent:Record<string,unknown>={};
  const client=new ChatCompletionsClient({baseUrl:'http://localhost',model:'test',apiKey:'fake'},async(_url,init)=>{sent=JSON.parse(init.body as string);return Response.json({choices:[{message:{content:'{"utterance":"不知道。","finished":false}'},finish_reason:'stop'}]});},null,true);
  await client.complete('NPC JSON','input');expect(sent.response_format).toEqual({type:'json_object'});
});
