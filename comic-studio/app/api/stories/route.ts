import { z } from "zod";
import {newStory,StoryError,exportMarkdown} from "@/lib/story/model";
import {actionSchema,workflow,type Step} from "@/lib/story/workflow";
import {modelClient} from "@/lib/story/ai";
import {database,readStory,listStories,createStory,claim,commit,fail,checkpoint,getRun,latestRun} from "@/lib/story/store";
const headers={"Cache-Control":"no-store"};
async function identity(request:Request){let token=request.headers.get("cookie")?.split(";").map(s=>s.trim()).find(s=>s.startsWith("manxiang_owner="))?.slice(15);let cookie="";if(!token||!/^[0-9a-f-]{36}$/.test(token)){token=crypto.randomUUID();cookie=`manxiang_owner=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${new URL(request.url).protocol==="https:"?"; Secure":""}`;}const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));return {owner:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join(""),cookie};}
function reply(data:unknown,cookie:string,status=200){return Response.json(data,{status,headers:{...headers,...(cookie?{"Set-Cookie":cookie}:{})}});}
export async function GET(request:Request){let cookie="";try{const identityResult=await identity(request);cookie=identityResult.cookie;const {owner}=identityResult;const url=new URL(request.url),id=url.searchParams.get("id");if(!id)return reply({stories:await listStories(owner)},cookie);let story=await readStory(id,owner);const revision=url.searchParams.get("revision");if(revision){const row=await database().prepare("SELECT state FROM story_revisions WHERE story=? AND version=?").bind(id,Number(revision)).first<{state:string}>();if(!row)throw new StoryError("历史版本不存在。",404);story=JSON.parse(row.state);}
 const format=url.searchParams.get("format");if(format){const body=format==="md"?exportMarkdown(story):JSON.stringify({formatVersion:1,exportedAt:new Date().toISOString(),story},null,2);return new Response(body,{headers:{...headers,"Content-Type":format==="md"?"text/markdown;charset=utf-8":"application/json","Content-Disposition":`attachment; filename="manxiang-${story.version}.${format==="md"?"md":"json"}"`}});}
 const versions=(await database().prepare("SELECT version,created FROM story_revisions WHERE story=? ORDER BY version DESC LIMIT 100").bind(id).all()).results;const run=await latestRun(id);return reply({story,versions,run:run?{id:run.id,status:run.status,error:run.error,updated:run.updated,steps:Object.keys(JSON.parse(run.journal)),command:{...JSON.parse(run.input),version:run.version}}:null},cookie);
 }catch(e){return reply({error:e instanceof StoryError?e.message:"存档读取失败，请检查数据库初始化后重试。"},cookie,e instanceof StoryError?e.status:503);}}
const command=z.object({id:z.string().uuid().optional(),version:z.number().int().nonnegative().optional(),requestId:z.string().uuid(),action:z.union([z.literal("create"),actionSchema]),payload:z.unknown()});
export async function POST(request:Request){let cookie="";try{
 if(request.headers.get("origin")&&request.headers.get("origin")!==new URL(request.url).origin)throw new StoryError("请求来源不匹配。",403);
 if(request.headers.get("content-type")?.split(";")[0]!=="application/json")throw new StoryError("只接受 JSON 请求。",415);
 const {owner,cookie:c}=await identity(request);cookie=c;const body=await request.text();if(new TextEncoder().encode(body).length>100000)throw new StoryError("输入过长。",413);
 const cmd=command.parse(JSON.parse(body));
 if(cmd.action==="create"){const p=z.object({idea:z.string().trim().min(8).max(3000)}).parse(cmd.payload);const s=newStory(cmd.requestId,p.idea);try{await createStory(s,owner);}catch{const existing=await readStory(s.id,owner);return reply({story:existing},cookie);}return reply({story:s},cookie);}
 if(!cmd.id||cmd.version===undefined)throw new StoryError("缺少故事版本。");const s=await readStory(cmd.id,owner);const previous=await getRun(s.id,cmd.requestId);const input=JSON.stringify({action:cmd.action,payload:cmd.payload});
 if(previous?.status==="succeeded"){if(previous.input!==input)throw new StoryError("请求 ID 已用于其他内容。",409);return reply({story:s},cookie);}
 if(s.version!==cmd.version)throw new StoryError("故事已有新版本，请刷新后继续。",409);
 const claimed=await claim(s,owner,cmd.requestId,input);if(!claimed)return reply({story:s},cookie);
 const {lock,journal}=claimed;
 if(previous?.status==="failed"){
  // A validation failure invalidates the candidate, while successful chapter work survives.
  if(previous.error?.includes("摘要")||previous.error?.includes("记忆")){delete journal.memory;delete journal["memory-check"];}
  if(previous.error?.includes("校验未通过")){delete journal.prose;delete journal["prose-check"];delete journal.rewrite;delete journal["rewrite-check"];}
 }
 const step:Step=async(name,work)=>{if(Object.hasOwn(journal,name))return journal[name] as Awaited<ReturnType<typeof work>>;const value=await work();journal[name]=value;await checkpoint(s.id,cmd.requestId,lock,journal);return value;};
 try{const result=await workflow(s,cmd.action,cmd.payload,modelClient(request.headers.get("x-ai-key")||request.headers.get("x-openai-key")||"",request.headers.get("x-ai-provider")||"openai"),step);return reply({story:await commit(s,result,cmd.requestId,lock)},cookie);}catch(e){const message=e instanceof StoryError?e.message:e instanceof z.ZodError?"请补齐字段并检查字数限制。":"任务未完成，已保存成功阶段，请重试。";await fail(s.id,cmd.requestId,lock,message);return reply({error:message,requestId:cmd.requestId},cookie,e instanceof StoryError?e.status:400);}
 }catch(e){return reply({error:e instanceof StoryError?e.message:"请求格式不正确或数据库暂不可用。"},cookie,e instanceof StoryError?e.status:400);}}
