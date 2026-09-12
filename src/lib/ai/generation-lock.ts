import { StoryProviderError } from "./model";
const scope=globalThis as typeof globalThis & {storyGeneration?:Map<string,{fingerprint:string;promise:Promise<unknown>}>};
const calls=scope.storyGeneration??=new Map();
export async function sharedStoryGeneration<T>(key:string,fingerprint:string,work:()=>Promise<T>):Promise<T>{
  const current=calls.get(key);
  if(current){
    if(current.fingerprint!==fingerprint)throw new StoryProviderError({code:"generation_running",userMessage:"这个故事正在生成，请等待当前结果；新输入已保留。",retryable:false},409);
    return current.promise as Promise<T>;
  }
  const promise=Promise.resolve().then(work);calls.set(key,{fingerprint,promise});
  try{return await promise;}finally{calls.delete(key);}
}
