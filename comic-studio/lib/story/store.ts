import { env } from "cloudflare:workers";
import { StoryError, type Story } from "./model";
export function database(){if(!env.DB)throw new StoryError("故事数据库尚未就绪，请先完成数据库初始化。",503);return env.DB;}
export type Run={id:string;story:string;version:number;input:string;status:string;journal:string;error:string|null;updated:number};
export async function readStory(id:string,owner:string){const row=await database().prepare("SELECT state FROM stories WHERE id=? AND owner=?").bind(id,owner).first<{state:string}>();if(!row)throw new StoryError("故事不存在或当前浏览器无权访问。",404);return JSON.parse(row.state) as Story;}
export async function listStories(owner:string){return (await database().prepare("SELECT id,title,version,updated FROM stories WHERE owner=? ORDER BY updated DESC").bind(owner).all()).results;}
export async function createStory(s:Story,owner:string){await database().prepare("INSERT INTO stories(id,owner,title,version,state,updated) VALUES(?,?,?,?,?,?)").bind(s.id,owner,s.title,s.version,JSON.stringify(s),s.updated).run();}
export async function getRun(story:string,id:string){return database().prepare("SELECT * FROM story_runs WHERE story=? AND id=?").bind(story,id).first<Run>();}
export async function latestRun(story:string){return database().prepare("SELECT id,status,error,updated,journal,input,version FROM story_runs WHERE story=? ORDER BY updated DESC LIMIT 1").bind(story).first<{id:string;status:string;error:string|null;updated:number;journal:string;input:string;version:number}>();}
export async function claim(s:Story,owner:string,id:string,input:string){
 const db=database(),existing=await getRun(s.id,id);
 if(existing&&existing.input!==input)throw new StoryError("同一请求不能更改内容，请建立新请求。",409);
 if(existing?.status==="succeeded")return null;
 if(existing&&existing.version!==s.version)throw new StoryError("故事已有新版本，请放弃旧任务并刷新。",409);
 const lock=crypto.randomUUID();const now=Date.now();
 const claimed=await db.prepare("UPDATE stories SET lock=?,lease=? WHERE id=? AND owner=? AND version=? AND (lock IS NULL OR lease<?)").bind(lock,now+600000,s.id,owner,s.version,now).run();
 if(!claimed.meta.changes)throw new StoryError("故事正在处理其他请求或已更新，请稍后刷新。",409);
 await db.prepare("INSERT INTO story_runs(story,id,version,input,status,journal,updated) VALUES(?,?,?,?,?,'{}',?) ON CONFLICT(story,id) DO UPDATE SET status='running',error=NULL,updated=excluded.updated").bind(s.id,id,s.version,input,"running",now).run();
 return {lock,journal:JSON.parse(existing?.journal||"{}") as Record<string,unknown>};
}
export async function checkpoint(story:string,run:string,lock:string,journal:Record<string,unknown>){const db=database();const r=await db.batch([db.prepare("UPDATE stories SET lease=? WHERE id=? AND lock=?").bind(Date.now()+600000,story,lock),db.prepare("UPDATE story_runs SET journal=?,updated=? WHERE story=? AND id=? AND EXISTS(SELECT 1 FROM stories WHERE id=? AND lock=?)").bind(JSON.stringify(journal),Date.now(),story,run,story,lock)]);if(!r[0].meta.changes)throw new StoryError("任务锁已失效，请刷新后继续。",409);}
export async function commit(before:Story,after:Story,run:string,lock:string){
 const db=database();after.version=before.version+1;after.updated=Date.now();
 const value=JSON.stringify(after);if(new TextEncoder().encode(value).length>1700000)throw new StoryError("此存档已达到首版容量，请导出后创建续篇。",413);
 const results=await db.batch([
 db.prepare("INSERT INTO story_revisions(story,version,state,created) SELECT id,version,state,? FROM stories WHERE id=? AND lock=? AND version=?").bind(Date.now(),before.id,lock,before.version),
 db.prepare("UPDATE stories SET state=?,title=?,version=?,updated=? WHERE id=? AND lock=? AND version=?").bind(value,after.title,after.version,after.updated,before.id,lock,before.version),
 db.prepare("UPDATE story_runs SET status='succeeded',error=NULL,updated=? WHERE story=? AND id=? AND EXISTS(SELECT 1 FROM stories WHERE id=? AND lock=? AND version=?)").bind(Date.now(),before.id,run,before.id,lock,after.version),
 db.prepare("UPDATE stories SET lock=NULL,lease=0 WHERE id=? AND lock=? AND version=?").bind(before.id,lock,after.version)]);
 if(!results[1].meta.changes)throw new StoryError("故事版本已变化，结果未覆盖新版本。",409);
 return after;
}
export async function fail(story:string,run:string,lock:string,message:string){const db=database();await db.batch([db.prepare("UPDATE story_runs SET status='failed',error=?,updated=? WHERE story=? AND id=? AND EXISTS(SELECT 1 FROM stories WHERE id=? AND lock=?)").bind(message,Date.now(),story,run,story,lock),db.prepare("UPDATE stories SET lock=NULL,lease=0 WHERE id=? AND lock=?").bind(story,lock)]);}
