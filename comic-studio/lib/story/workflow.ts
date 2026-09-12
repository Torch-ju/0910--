import { z } from "zod";
import { type Story, type Memory, worldSchema,heroSchema,nodeSchema,sceneSchema,memorySchema,requireState,StoryError,context,ensureBudget,activeEntries,mergeMemories,needsArchive } from "./model";
import type { ModelCall } from "./ai";
import {skillText,skillVersion,skillSha256} from "./skill";
export type Action="world"|"confirmWorld"|"hero"|"confirmHero"|"discuss"|"confirmNode"|"write"|"archive"|"rewrite"|"acceptRewrite"|"discardRewrite"|"revise";
export const actionSchema=z.enum(["world","confirmWorld","hero","confirmHero","discuss","confirmNode","write","archive","rewrite","acceptRewrite","discardRewrite","revise"]);
export type Step=<T>(name:string,work:()=>Promise<T>)=>Promise<T>;
const worldExample={era:"架空王朝",rules:"武学有肉身极限",conflict:"门派与朝廷争夺名册",tone:"冷峻江湖",boundaries:"不提前揭露妹妹身份"};
const heroExample={name:"林澈",identity:"被逐出师门的少年",appearance:"右手旧伤",personality:"重义又惧失去归属",goal:"救妹妹",limits:"不会游泳，武学尚浅",voice:"克制、直率"};
const nodeExample={title:"交出名册",start:"傍晚，旧渡口",content:"以名册换妹妹平安",motivation:"救妹妹",choice:"交出名册",result:"得到保证，被逐出师门",cost:"失去师门庇护",preserve:"右手旧伤",forbidden:"不揭示妹妹所在地",freedom:"可补充配角与试探"};
const sceneExample={title:"渡口",blocks:[{type:"narration",speaker:"",content:"林澈停在渡口。"},{type:"dialogue",speaker:"林澈",content:"人呢？"}]};
const memoryExample={id:"fact-name",kind:"fact",content:"名册交给阿宁",status:"active",source:"",evidence:"正文出现交付动作"};
const payloadText=z.object({text:z.string().trim().min(1).max(6000)});
export async function workflow(original:Story,action:Action,payload:unknown,call:ModelCall,step:Step):Promise<Story>{
 const s=structuredClone(original);const ctx=()=>JSON.stringify(context(s));
 const record=(...messages:Story["chat"])=>{s.chat.push(...messages);s.conversation.push(...messages);};
 const check=async(label:string,prompt:string)=>{const result=await step(label,()=>call("一致性检查",prompt,z.object({ok:z.boolean(),issues:z.array(z.string())}),{ok:true,issues:[]}));requireState(result.ok,"内容校验未通过："+result.issues.join("；"));};
 if(action==="world"){
  requireState(!s.worldConfirmed,"世界已确认，请使用设定修订流程。");const {text}=payloadText.parse(payload);
  const r=await step("world",()=>call("世界观引导 Agent",`作者故事：${s.idea}\n补充：${text}\n现有草案：${JSON.stringify(s.world)}\n给出江湖世界草案；缺失偏好请建议，不要求全书大纲。`,z.object({world:worldSchema,questions:z.array(z.string()).max(2)}),{world:worldExample,questions:["希望江湖更冷峻还是温暖？"]}));
  s.world=r.world;record({role:"author",text},{role:"hero",text:r.questions.join("\n")||"世界观草案已准备好，请审阅四项核心设定。"});
 }else if(action==="confirmWorld"){
  requireState(!s.entries.length,"已有正文，请使用设定修订流程。");s.world=worldSchema.parse(payload);s.worldConfirmed=true;s.worldVersion++;s.hero=null;s.heroConfirmed=false;s.node=null;s.nodeConfirmed=false;
 }else if(action==="hero"){
  requireState(s.worldConfirmed,"请先确认世界观。");requireState(!s.heroConfirmed,"主角已确认，请使用设定修订。");
  const cast=await step("hero",()=>call("人物 Agent",`根据世界设计有弱点、有矛盾的江湖主角，不预设必须行善。\n${ctx()}`,z.object({hero:heroSchema,npcs:z.array(heroSchema).max(4)}),{hero:heroExample,npcs:[]}));s.hero=cast.hero;s.npcs=cast.npcs;
 }else if(action==="confirmHero"){
  requireState(s.worldConfirmed&&!s.entries.length,"确认人物需要已确认世界且尚未开始正文。");const cast=z.object({hero:heroSchema,npcs:z.array(heroSchema).max(4)}).parse(payload);s.hero=cast.hero;s.npcs=cast.npcs;s.heroConfirmed=true;s.heroVersion++;
 }else if(action==="discuss"){
  requireState(s.heroConfirmed,"请先确认主角。");ensureBudget(s);const {text}=payloadText.parse(payload);
  const reply=await step("discussion",()=>call("主角引导 Agent",`你是已确认的小说主角，与小说外的作者讨论当前重大事件。只追问至多两个关键缺项。作者拥有最终决定权。不要写长篇正文。已有答案不重复问；信息齐全则提出完整节点草案。回顾不生成节点。如果要求改变已发生事实，解释需使用修订功能。\n${ctx()}\n作者：${text}`,z.object({reply:z.string().min(1).max(4000),node:nodeSchema.nullable()}),{reply:"我若交出名册，要付出什么代价？",node:null}));
  record({role:"author",text},{role:"hero",text:reply.reply});if(s.node)s.nodeConfirmed=false;if(reply.node){s.node=reply.node;s.nodeId=crypto.randomUUID();s.nodeConfirmed=false;}
 }else if(action==="confirmNode"){
  requireState(s.heroConfirmed,"请先确认主角。");s.node=nodeSchema.parse(payload);s.nodeId=s.nodeId||crypto.randomUUID();s.nodeConfirmed=true;
 }else if(action==="write"){
  requireState(s.worldConfirmed&&s.heroConfirmed&&s.node&&s.nodeId&&s.nodeConfirmed,"请先确认世界、人物与当前节点。");
  if(activeEntries(s).length&&(needsArchive(s)||new TextEncoder().encode(ctx()+skillText).length>55000))await archive(s,call,step);
  ensureBudget(s,new TextEncoder().encode(skillText).length);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(skillText))),b=>b.toString(16).padStart(2,"0")).join("");requireState(hash===skillSha256,"金庸 skill 校验失败，正文生成已停止。");
  const result=await step("prose",()=>call("正文 Agent",`使用下列固定 skill 的创作方法写原创江湖小说。产品适配约束：只输出小说场景和结构化资料，不以金庸身份自我介绍，不改变作者确认的世界与节点结果。作者在小说之外。写完整节点的主要内容、选择、结果和代价；允许黑暗人物与道德灰度。每个场景推动事件、关系或伏笔，避免水剧情。新增加的持久事实或伏笔全部列入 changes。变更旧事实沿用其ID并提供正文依据，新增ID不得复用。遇到需要作者决定的重要缺口，返回 question 并不生成场景。\nSKILL：\n${skillText}\n正式故事资料：\n${ctx()}`,z.object({scenes:z.array(sceneSchema).max(8),changes:z.array(memorySchema).max(30),anchor:z.string().max(2000),question:z.string().max(1500)}),{scenes:[sceneExample],changes:[memoryExample],anchor:"渡口，林澈刚交出名册",question:""}));
  if(result.question){record({role:"hero",text:result.question});s.nodeConfirmed=false;return s;}
  requireState(result.scenes.length,"正文缺少有效场景。");
  await check("prose-check",`核验正文：是否覆盖确认节点的主要内容、结果与代价，是否违背人物/世界/禁区，有无不必要重复，有无正文与事实变化不一致或漏记重要变化。未通过必须说明问题。\n上下文${ctx()}\n候选${JSON.stringify(result)}`);
  const entryId=crypto.randomUUID();s.memories=mergeMemories(s.memories,result.changes,entryId);
  s.entries.push({id:entryId,nodeId:s.nodeId,node:s.node,scenes:result.scenes,memories:result.changes.map(m=>m.id),changes:result.changes,skill:skillVersion,created:Date.now()});s.anchor=result.anchor;s.node=null;s.nodeId=null;s.nodeConfirmed=false;
  record({role:"hero",text:"这个节点已写入正文。接下来，你希望我面对怎样的选择？"});
 }else if(action==="archive"){
  await archive(s,call,step);
 }else if(action==="rewrite"){
  const p=z.object({entryId:z.string(),text:z.string().min(1).max(4000)}).parse(payload);const entry=s.entries.find(e=>e.id===p.entryId);requireState(entry,"没有找到要改写的正文。");
  const result=await step("rewrite",()=>call("正文润色 Agent",`调用金庸写作方法，按要求局部改写以下正文。保持所有事实、结果、说话人、伏笔和指定台词。不得新增重大事件。\n${skillText}\n世界${JSON.stringify(s.world)}\n人物${JSON.stringify(s.hero)}\n原作${JSON.stringify(entry)}\n要求${p.text}`,z.object({scenes:z.array(sceneSchema).min(1).max(8)}),{scenes:[sceneExample]}));
  await check("rewrite-check",`比较改写与原作，必须保持人物、关键事实、节点结果、伏笔、指定台词。若要求改变重大事件则不通过。\n原作${JSON.stringify(entry)}\n改写${JSON.stringify(result)}`);
  s.rewrite={entryId:entry.id,scenes:result.scenes};
 }else if(action==="acceptRewrite"){
  requireState(s.rewrite,"没有待接受的改写。");const candidate=s.rewrite;s.entries=s.entries.map(e=>e.id===candidate.entryId?{...e,scenes:candidate.scenes}:e);s.rewrite=null;
 }else if(action==="discardRewrite"){s.rewrite=null;
 }else if(action==="revise"){
  const p=z.object({entryId:z.string().nullable(),world:worldSchema,hero:heroSchema,npcs:z.array(heroSchema).max(4)}).parse(payload);
  requireState(p.entryId||!s.entries.length,"已有正文的设定修订必须选择重写起点。");
  const index=p.entryId?s.entries.findIndex(e=>e.id===p.entryId):s.entries.length;requireState(index>=0,"修订起点不存在。");
  // Explicit author-approved rollback: preserve complete previous revision in the store.
  const removed=new Set(s.entries.slice(index).map(e=>e.id));s.entries=s.entries.slice(0,index);s.chapters=s.chapters.filter(c=>!c.entryIds.some(id=>removed.has(id)));
  s.memories=s.entries.reduce<Memory[]>((memories,e)=>mergeMemories(memories,e.changes,e.id),[]);
  requireState(!removed.size||s.memories.every(m=>!removed.has(m.source)),"修订状态无法恢复。");
  s.world=p.world;s.hero=p.hero;s.npcs=p.npcs;s.chat=[];s.worldVersion++;s.heroVersion++;s.worldConfirmed=true;s.heroConfirmed=true;s.summary="";s.anchor=s.entries.at(-1)?.node.result||"修订后的新起点";s.node=null;s.nodeId=null;s.nodeConfirmed=false;s.rewrite=null;s.revision++;record({role:"hero",text:"作者已建立修订起点，受影响正文已移出当前版本；旧版本仍可导出。请描述修订后的重大事件。"});
 }
 return s;
}
async function archive(s:Story,call:ModelCall,step:Step){
 const entries=activeEntries(s);
 if(!entries.length){const r=await step("discussion-summary",()=>call("讨论摘要 Agent",`压缩创作讨论，保留已确认答案、待决问题、作者拒绝方向。不要编造章节或剧情事实。${JSON.stringify({node:s.node,discussion:s.chat})}`,z.object({summary:z.string().max(5000)}),{summary:"当前节点仍待确认代价"}));s.chat=[{role:"hero",text:r.summary}];return;}
 const chapter=await step("chapter",()=>call("章节 Agent",`只组织已有内容，给出章节标题。不得新增正文或解决伏笔。${JSON.stringify(entries.map(e=>({id:e.id,node:e.node})))}`,z.object({title:z.string().min(1).max(100)}),{title:"渡口决别"}));
 const summary=await step("memory",()=>call("摘要 Agent",`生成上一章摘要、章末衔接和讨论摘要。保留全部active记忆ID；不要重写角色卡。人物事实以正式记录为准，计划不是已发生事件。returned retainedIds 必须包含所有仍有效的记忆ID。\n${JSON.stringify({world:s.world,hero:s.hero,node:s.node,entries,memories:s.memories,anchor:s.anchor,discussion:s.chat.slice(-12)})}`,z.object({summary:z.string().min(1).max(7000),anchor:z.string().min(1).max(2000),discussion:z.string().max(4000),retainedIds:z.array(z.string())}),{summary:"本章关键事件",anchor:"渡口，事件刚结束",discussion:"作者正在考虑下一次选择",retainedIds:s.memories.filter(m=>m.status==="active").map(m=>m.id)}));
 const retained=new Set(summary.retainedIds);requireState(s.memories.filter(m=>m.status==="active").every(m=>retained.has(m.id)),"摘要遗漏关键事实或未解决伏笔，未切换上下文。请重试整理。");
 const verify=await step("memory-check",()=>call("记忆校验",`核对摘要、章末位置和讨论摘要与来源，不能改变角色、事件或将计划写成事实。\n来源${JSON.stringify({entries,node:s.node,chat:s.chat.slice(-12),memories:s.memories})}\n摘要${JSON.stringify(summary)}`,z.object({ok:z.boolean(),issues:z.array(z.string())}),{ok:true,issues:[]}));requireState(verify.ok,"摘要连续性检查失败："+verify.issues.join("；"));
 s.chapters.push({id:crypto.randomUUID(),title:chapter.title,entryIds:entries.map(e=>e.id),status:"ready",summary:summary.summary});s.summary=summary.summary;s.anchor=summary.anchor;s.chat=[{role:"hero",text:summary.discussion}];
}
