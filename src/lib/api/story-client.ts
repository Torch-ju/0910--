import type { AgentEndpoint, AgentRequest, AppError, FrameworkResult, NpcResult, ProviderStatus, RevisionResult } from "@/lib/story/contracts";
export class RequestError extends Error { constructor(public detail:AppError){super(detail.userMessage);} }
export async function getProviderStatus():Promise<ProviderStatus>{
  const response=await fetch("/api/story/status",{cache:"no-store"});
  if(!response.ok)throw new RequestError({code:"STATUS_UNAVAILABLE",userMessage:"暂时无法读取模型配置。",retryable:true});
  return response.json();
}
export async function callStoryApi(endpoint:AgentEndpoint,body:AgentRequest):Promise<FrameworkResult|NpcResult|RevisionResult>{
  let response:Response;
  try{response=await fetch("/api/story/"+endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(1140000)});}
  catch{throw new RequestError({code:"CONNECTION_UNCERTAIN",userMessage:"连接中断或等待超时。原请求可能仍在执行，重试会沿用同一个操作标识。",retryable:true,requestId:body.operation_id});}
  let data:unknown;try{data=await response.json();}catch{throw new RequestError({code:"INVALID_RESPONSE",userMessage:"服务端未返回有效 JSON，原故事仍然保留。",retryable:false,requestId:body.operation_id});}
  if(!response.ok){const e=(data as {error?:AppError}).error;throw new RequestError(e??{code:"REQUEST_FAILED",userMessage:"生成未完成，请稍后重试。",retryable:false,requestId:body.operation_id});}
  return data as FrameworkResult|NpcResult|RevisionResult;
}
