"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import type { AgentEndpoint, AgentRequest, AppError, Candidate, CharacterProfiles, FieldTarget, FrameworkResult, NpcResult, ProviderStatus, StorySnapshot, StoryWorld, WorkbenchActions, WorkbenchModel } from "@/lib/story/contracts";
import { prepareCandidate } from "@/lib/story/candidate";
import { getFieldContract } from "@/lib/story/field-contract";
import { createCharacter, createSnapshot, createTimelineEvent, fact, now, uid } from "@/lib/story/factory";
import { acceptCandidate, atPath, confirmSnapshot, editFact, mergeCharacters, mutateSnapshot, reconcileIncoming, removeCharacter, setFactStatus, StoryError, syncGrowth } from "@/lib/story/state";
import { isFact, validatePair, walkFacts } from "@/lib/story/validation";
import { deserializeWorkspace, exportDocument, serializeWorkspace, STORAGE_KEY, type PendingRequest } from "@/lib/story/storage";
import { callStoryApi, getProviderStatus, RequestError } from "@/lib/api/story-client";
type Internal = { snapshot:StorySnapshot;previous:StorySnapshot|null;candidate:Candidate|null;pending:PendingRequest|null;busy:boolean;stage:string;error:AppError|null;savedAt:string|null;provider:ProviderStatus|null;restored:boolean;storageBroken:boolean;autoNpcs:boolean };
const hasBlocking = (snapshot:StorySnapshot) => snapshot.recognition?.questions.some(q=>q.blocking) || [...snapshot.world.open_questions,...snapshot.characters.characters.flatMap(c=>c.open_questions)].some(q=>q.blocking&&q.status==="open");
const initial=():Internal=>({snapshot:createSnapshot(),previous:null,candidate:null,pending:null,busy:false,stage:"等待你的故事",error:null,savedAt:null,provider:null,restored:false,storageBroken:false,autoNpcs:true});
function errorOf(e:unknown):AppError{
  if(e instanceof RequestError)return e.detail;
  if(e instanceof StoryError)return {code:e.code,userMessage:e.message,retryable:false,fieldErrors:e.issues};
  return {code:"LOCAL_ERROR",userMessage:e instanceof Error?e.message:"操作未完成，原内容仍然保留。",retryable:true};
}
export function useWorkbench():{model:WorkbenchModel;actions:WorkbenchActions}{
  const [state,dispatch]=useReducer((s:Internal,p:Partial<Internal>)=>({...s,...p}),undefined,initial);
  const latest=useRef(state);
  const skipNextSave=useRef(false);
  const saveEpoch=useRef(0);
  useLayoutEffect(()=>{latest.current=state;},[state]);
  const update=useCallback((patch:Partial<Internal>)=>{latest.current={...latest.current,...patch};dispatch(patch);},[]);
  const refreshStatus=useCallback(async()=>{try{update({provider:await getProviderStatus()});}catch(e){update({error:errorOf(e)});}},[update]);
  useEffect(()=>{
    queueMicrotask(()=>{
      try{
        const raw=localStorage.getItem(STORAGE_KEY);
        if(raw){const data=deserializeWorkspace(raw);update({snapshot:data.current,previous:data.previous,candidate:data.candidate,pending:data.pending,savedAt:data.saved_at,restored:true,error:data.pending?{code:"PENDING_REQUEST",userMessage:"上次请求的结果尚未确认。可重试原操作查询结果，或明确选择以新请求重新发起（可能计费）。",retryable:true}:null,stage:data.pending?"上次请求尚未确认，可重试原操作以查询结果":"已恢复上次创作"});}
        else update({restored:true});
      }catch(e){update({restored:true,storageBroken:true,error:errorOf(e),stage:"本地记录需检查，尚未覆盖"});}
      void refreshStatus();
    });
  },[update,refreshStatus]);
  const save=useCallback(()=>{
    const s=latest.current;
    if(!s.restored||s.storageBroken)return;
    try{
      const stamp=now();
      localStorage.setItem(STORAGE_KEY,serializeWorkspace({version:1,current:s.snapshot,previous:s.previous,candidate:s.candidate,pending:s.pending,saved_at:stamp}));
      update({savedAt:stamp,error:s.error?.code==="SAVE_FAILED"?null:s.error});
    }catch(e){update({error:{code:"SAVE_FAILED",userMessage:"本地保存失败。内容仍在当前页面，可重试或导出。"+(e instanceof Error?" "+e.message:""),retryable:true}});}
  },[update]);
  useEffect(()=>{
    if(!state.restored||state.storageBroken)return;
    if(skipNextSave.current){skipNextSave.current=false;return;}
    const epoch=saveEpoch.current;
    const timer=setTimeout(()=>{if(epoch===saveEpoch.current)save();},500);
    return ()=>clearTimeout(timer);
  },[state.snapshot,state.previous,state.candidate,state.pending,state.restored,state.storageBroken,save]);
  const change=useCallback((fn:(s:StorySnapshot)=>StorySnapshot)=>{
    const old=latest.current.snapshot;
    try{const next=fn(old);if(next!==old)update({snapshot:next,previous:old,error:null,savedAt:null});}
    catch(e){update({error:errorOf(e)});}
  },[update]);
  const run=useCallback(async(endpoint:AgentEndpoint,input:string,target?:AgentRequest["target"],characterId?:string,field?:FieldTarget)=>{
    const s=latest.current;if(s.busy)return;
    if(!input.trim()){update({error:{code:"EMPTY_INPUT",userMessage:"先写下你的故事想法。",retryable:false}});return;}
    if(endpoint==="npcs"&&!s.snapshot.world.title.value.trim()){update({error:{code:"WORLD_REQUIRED",userMessage:"请先构建或填写世界框架，再生成 NPC。",retryable:false}});return;}
    if(endpoint==="npcs"&&hasBlocking(s.snapshot)){update({error:{code:"OPEN_QUESTIONS",userMessage:"世界已保留，请先回答识别反馈中的关键问题，再生成 NPC。",retryable:false}});return;}
    if(!s.snapshot.input.trim()){update({error:{code:"SHARED_IDEA_REQUIRED",userMessage:"请先填写共同故事想法；局部要求不能替代故事总设定。",retryable:false}});return;}
    if(field){try{getFieldContract(s.snapshot.world,s.snapshot.characters,field);}catch(e){update({error:errorOf(e)});return;}}
    if(s.candidate){update({error:{code:"CANDIDATE_PENDING",userMessage:"请先采用或放弃当前候选修改，再发起新的生成。",retryable:false}});return;}
    const before=structuredClone(s.snapshot);
    const context={story_idea:before.input,user_notes:[...new Set(before.messages.filter(m=>m.role==="user"&&m.content!==before.input&&m.content!==input).map(m=>m.content))]};
    const body:AgentRequest={operation_id:uid("op"),base_revision:before.snapshot_revision,preset_id:before.preset_id,input,context,world:before.world,characters:before.characters,recognition:before.recognition,...(target?{target}:{}),...(characterId?{character_id:characterId}:{}),...(field?{field}:{})};
    const fingerprint=JSON.stringify({...body,operation_id:undefined});
    if(s.pending?.endpoint===endpoint&&s.pending.fingerprint===fingerprint)body.operation_id=s.pending.body.operation_id;
    const userMessage={id:uid("message"),role:"user" as const,content:input,created_at:now()};
    update({busy:true,error:null,pending:{endpoint,body,fingerprint},snapshot:{...before,messages:s.pending?.fingerprint===fingerprint?before.messages:[...before.messages,userMessage]},stage:endpoint==="framework"?"故事框架 Agent 正在理解并整理世界与历史":endpoint==="npcs"?"NPC Agent 正在依据世界与时间线塑造人物":endpoint==="field"?"正在结合共同故事上下文生成字段建议":"正在生成局部修改建议"});
    save();
    if(latest.current.storageBroken||latest.current.error?.code==="SAVE_FAILED"){update({busy:false,stage:"请求状态未能保存，尚未调用模型"});return;}
    try{
      const result=await callStoryApi(endpoint,body);
      const evidence=[context.story_idea,input,...context.user_notes].join("\n");
      const world="world" in result && result.world?reconcileIncoming(result.world,before.world,evidence) as StoryWorld:structuredClone(before.world);
      const characters="characters" in result && result.characters?reconcileIncoming(result.characters,before.characters,evidence) as CharacterProfiles:structuredClone(before.characters);
      if(world.story_id!==before.world.story_id||characters.story_id!==before.world.story_id)throw new StoryError("STORY_MISMATCH","模型返回了另一故事的标识，原状态已保留。");
      world.revision=before.world.revision;world.created_at=before.world.created_at;world.updated_at=before.world.updated_at;world.change_log=structuredClone(before.world.change_log);
      characters.revision=before.characters.revision;characters.created_at=before.characters.created_at;characters.updated_at=before.characters.updated_at;characters.change_log=structuredClone(before.characters.change_log);
      const temp={...before,world,characters};syncGrowth(temp);
      const suggestions="timeline_suggestions" in result?(result as NpcResult).timeline_suggestions??[]:before.timeline_suggestions;
      const candidate:Candidate={operation_id:body.operation_id,base_revision:before.snapshot_revision,fingerprint,world,characters,timeline_suggestions:reconcileIncoming(suggestions,before.timeline_suggestions,evidence) as Candidate["timeline_suggestions"],recognition:"recognition" in result?(result as FrameworkResult).recognition:before.recognition,summary:result.assistant_message,warnings:"warnings" in result?result.warnings:[],origin:endpoint,...(field?{field}:{}),base:{world:before.world,characters:before.characters,story_idea:before.input,preset_id:before.preset_id,timeline_suggestions:before.timeline_suggestions}};
      const current=latest.current.snapshot;
      const {issues}=prepareCandidate(current,candidate);
      update({candidate,pending:null,busy:false,stage:issues.length?"候选设定存在冲突，请检查后修改":"候选设定已生成，等待你采用",error:issues.length?{code:"CANDIDATE_CONFLICT",userMessage:issues[0].message,retryable:false,fieldErrors:issues}:null,snapshot:{...current,messages:[...current.messages,{id:uid("message"),role:"assistant",content:result.assistant_message,created_at:now()}]}});
    }catch(e){update({busy:false,error:errorOf(e),stage:"本次生成未完成，原始内容已保留"});}
    finally{void refreshStatus();}
  },[update,refreshStatus,save]);
  const actions=useMemo<WorkbenchActions>(()=>({
    loadSnapshot(snapshot){
      const current=latest.current;if(current.busy)return;
      if(!window.confirm("载入此作品设定？当前浏览器草稿会先备份。"))return;
      try { const raw=localStorage.getItem(STORAGE_KEY);if(raw)localStorage.setItem(STORAGE_KEY+".archive."+current.snapshot.world.story_id+"."+Date.now(),raw); }
      catch { update({error:{code:"BACKUP_FAILED",userMessage:"草稿备份失败，未载入。",retryable:true}});return; }
      update({snapshot:structuredClone(snapshot),previous:current.snapshot,candidate:null,pending:null,error:null,stage:"已载入作品设定，修改后请确认并同步"});save();
    },
    setPreset(preset){
      const s=latest.current;
      if(s.snapshot.preset_id===preset)return;
      if(s.snapshot.world.title.value||s.snapshot.characters.characters.length){update({error:{code:"PRESET_HAS_CONTENT",userMessage:"已有故事不会被场景模板覆盖。请先保存并新建故事，再选择场景。",retryable:false}});return;}
      change(old=>mutateSnapshot(old,uid("op"),"preset:"+preset,"选择世界风格",next=>{next.preset_id=preset;}));
    },
    setInput(input){update({snapshot:{...latest.current.snapshot,input},savedAt:null});},
    generateFramework(){return run("framework",latest.current.snapshot.input);},
    generateNpcs(){return run("npcs","根据共同故事想法和已接受的世界、历史、开局需要生成 NPC 候选。");},
    revise(target,instruction,characterId){return run("revise",instruction,target,characterId);},
    suggestField(document,path,instruction){return run("field",instruction.trim()||"依据共同故事上下文，为当前字段提出一份具体且一致的建议。",undefined,undefined,{document,path});},
    setAutoNpcs(autoNpcs){update({autoNpcs});},
    editFact(doc,path,value){change(s=>editFact(s,doc,path,value));},
    setFactStatus(doc,path,status){change(s=>setFactStatus(s,doc,path,status));},
    toggleLock(doc,path){change(s=>mutateSnapshot(s,uid("op"),"lock:"+doc+path,"用户切换设定锁定",next=>{const f=atPath(next[doc],path);if(!isFact(f))throw new StoryError("INVALID_PATH","无效设定字段。");f.locked=!f.locked;f.updated_at=now();},s.snapshot_revision,false));},
    confirmAll(){
      if(latest.current.candidate){update({error:{code:"CANDIDATE_PENDING",userMessage:"先采用或放弃候选修改，再确认当前设定。",retryable:false}});return;}
      if(!window.confirm("确认当前非空且未拒绝的基础设定？未决问题仍会保留，之后也可以修改。"))return;
      change(confirmSnapshot);save();
      if(!latest.current.error)update({stage:"基础设定已确认，可继续修改或导出"});
    },
    addCharacter(){change(s=>mutateSnapshot(s,uid("op"),"add-character","用户添加人物",next=>{next.characters.characters.push(createCharacter());}));},
    removeCharacter(id){if(window.confirm("删除这个人物及其关系引用，并记录不再自动加入的要求？上一份快照会保留，已锁定内容需要先解锁。"))change(s=>removeCharacter(s,id));},
    mergeCharacters(source,target){if(window.confirm("合并后保留目标人物 ID 与已有设定；不同内容会记为待确认问题。"))change(s=>mergeCharacters(s,source,target));},
    addTimelineEvent(){change(s=>mutateSnapshot(s,uid("op"),"add-event","用户添加历史事件",next=>{next.world.timeline.push(createTimelineEvent());}));},
    removeTimelineEvent(id){if(window.confirm("删除这个历史事件，并清理人物前史和事件先后引用？"))change(s=>mutateSnapshot(s,uid("op"),"remove-event:"+id,"用户删除历史事件",next=>{next.world.timeline=next.world.timeline.filter(e=>e.event_id!==id);for(const e of next.world.timeline)e.after_event_ids=e.after_event_ids.filter(v=>v!==id);for(const c of next.characters.characters)c.timeline_event_ids=c.timeline_event_ids.filter(v=>v!==id);}));},
    editTimelineMeta(id,values){change(s=>mutateSnapshot(s,uid("op"),JSON.stringify({id,values}),"用户修改时间线排序或关联",next=>{const e=next.world.timeline.find(e=>e.event_id===id);if(!e)throw new StoryError("NOT_FOUND","事件不存在。");Object.assign(e,values);}));},
    acceptCandidate(){
      const current=latest.current,c=current.candidate;if(!c||current.busy)return;
      const old=current.snapshot;
      try{
        const prepared=prepareCandidate(old,c);
        if(prepared.issues.length)throw new StoryError("CANDIDATE_CONFLICT",prepared.issues[0].message,prepared.issues);
        const next=acceptCandidate(old,prepared.candidate);
        update({snapshot:next,previous:old,candidate:null,error:null,savedAt:null,stage:"候选已加入草案，可编辑并确认"});save();
        const framework=c.origin==="framework"||(!c.origin&&old.characters.characters.length===0&&!!next.recognition&&!!next.world.title.value.trim());
        if(framework&&current.autoNpcs&&!latest.current.error){
          if(hasBlocking(next)){update({stage:"世界已采用，请先回答关键问题后生成 NPC"});return;}
          void run("npcs","根据共同故事想法和刚采用的世界、历史、开局需要生成 NPC 候选。");
        }
      }catch(e){update({error:errorOf(e)});}
    },
    rejectCandidate(){update({candidate:null,error:null,stage:"已放弃候选，保留当前设定"});},
    acceptTimelineSuggestion(id){change(s=>mutateSnapshot(s,uid("op"),"accept-event:"+id,"用户采用 NPC 前史事件建议",next=>{const e=next.timeline_suggestions.find(e=>e.event_id===id);if(!e)throw new StoryError("NOT_FOUND","事件建议不存在。");if(next.world.timeline.some(v=>v.event_id===id))throw new StoryError("DUPLICATE_ID","此事件已经存在。");walkFacts(e,f=>{if(typeof f.value==="string"&&f.value.trim()){f.status="confirmed";f.updated_at=now();}});next.world.timeline.push(e);for(const c of next.characters.characters)if(e.related_character_ids.includes(c.character_id))c.timeline_event_ids=[...new Set([...c.timeline_event_ids,id])];next.timeline_suggestions=next.timeline_suggestions.filter(e=>e.event_id!==id);}));},
    rejectTimelineSuggestion(id){change(s=>mutateSnapshot(s,uid("op"),"reject-event:"+id,"用户拒绝 NPC 前史事件建议",next=>{next.timeline_suggestions=next.timeline_suggestions.filter(e=>e.event_id!==id);}));},
    undo(){
      const s=latest.current;if(!s.previous)return;
      if(s.busy){update({error:{code:"REQUEST_RUNNING",userMessage:"请求进行中，请先等待结果再撤销。",retryable:false}});return;}
      change(current=>mutateSnapshot(current,uid("op"),"undo:"+current.snapshot_revision,"用户恢复上一份有效内容",next=>{const previous=structuredClone(s.previous!);next.world=previous.world;next.characters=previous.characters;next.recognition=previous.recognition;next.timeline_suggestions=previous.timeline_suggestions;},current.snapshot_revision,false));
      update({candidate:null,pending:null});
    },
    save,
    exportJson(kind){
      try{const text=exportDocument(latest.current.snapshot,kind);const url=URL.createObjectURL(new Blob([text],{type:"application/json;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=kind==="world"?"story_world.json":"character_profiles.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
      catch(e){update({error:errorOf(e)});}
    },
    restart(){
      const s=latest.current;if(s.busy)return;
      if(!window.confirm("新建故事？当前记录将保留为本地备份，请先导出重要内容。"))return;
      try{const raw=localStorage.getItem(STORAGE_KEY);if(raw)localStorage.setItem(STORAGE_KEY+".archive."+s.snapshot.world.story_id+"."+Date.now(),raw);}
      catch{update({error:{code:"BACKUP_FAILED",userMessage:"备份失败，未清空当前故事。请先导出。",retryable:true}});return;}
      update({...initial(),restored:true,provider:s.provider,stage:"新故事已准备好"});
      save();
    },
    clearData(){
      const s=latest.current;if(s.busy)return;
      if(!window.confirm("清空本浏览器中‘书中人’保存的故事、候选和本地备份？此操作不可撤销，请先导出重要内容。"))return;
      try{
        for(const key of Object.keys(localStorage))if(key===STORAGE_KEY||key.startsWith(STORAGE_KEY+".archive."))localStorage.removeItem(key);
      }catch(e){update({error:{code:"CLEAR_FAILED",userMessage:"本地数据清除失败，当前故事仍然保留。"+(e instanceof Error?" "+e.message:""),retryable:true}});return;}
      saveEpoch.current+=1;
      skipNextSave.current=true;
      update({...initial(),restored:true,provider:s.provider,stage:"本地数据已清空"});
    },
    dismissError(){update({error:null});},
    async startNewAttempt(){
      const s=latest.current;if(s.busy||!s.pending)return;
      if(!window.confirm("原请求的状态可能不确定，也可能已经计费。确定以新的操作标识重新发起一次？这可能产生新的模型费用。"))return;
      const pending=s.pending;update({pending:null,error:null});
      await run(pending.endpoint,pending.body.input,pending.body.target,pending.body.character_id,pending.body.field);
    },
    answerQuestion(question,answer){
      if(!answer.trim())return;
      change(s=>mutateSnapshot(s,uid("op"),JSON.stringify({question,answer}),"用户回答澄清问题",next=>{
        for(const q of [...next.world.open_questions,...next.characters.characters.flatMap(c=>c.open_questions)])if(q.question===question){q.status="resolved";q.answer={...fact(answer,"user_explicit"),status:"confirmed",evidence:[answer]};}
        if(next.recognition)next.recognition.questions=next.recognition.questions.filter(q=>q.question!==question);
        next.input+="\n补充："+question+" "+answer;
        next.messages.push({id:uid("message"),role:"user",content:question+"\n"+answer,created_at:now()});
      }));
    }
  }),[change,update,run,save]);
  const prepared=useMemo(()=>state.candidate?prepareCandidate(state.snapshot,state.candidate):null,[state.snapshot,state.candidate]);
  const issues=useMemo(()=>prepared?.issues??validatePair(state.snapshot.world,state.snapshot.characters),[prepared,state.snapshot]);
  const model:WorkbenchModel={snapshot:state.snapshot,busy:state.busy,stage:state.stage,error:state.error,savedAt:state.savedAt,candidate:prepared?.candidate??null,issues,candidateCanApply:!!prepared&&!issues.length&&!state.busy,autoNpcs:state.autoNpcs,provider:state.provider,canUndo:!!state.previous,restored:state.restored,canStartNewAttempt:!!state.pending&&!state.busy};
  return {model,actions};
}
