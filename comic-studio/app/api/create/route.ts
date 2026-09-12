import { generate, GenerationError, requestSchema } from "@/lib/generation";
const headers={"Cache-Control":"no-store"};
export async function POST(request:Request){
 try{
  const origin=request.headers.get("origin");
  if(origin&&origin!==new URL(request.url).origin)return Response.json({error:"请求来源不匹配。"},{status:403,headers});
  const key=request.headers.get("x-openai-key")?.trim();
  if(!key||key.length<20||key.length>500)return Response.json({error:"请先连接 AI，填写你自己的 OpenAI API Key。"},{status:401,headers});
  // Keys are supplied per request; never persist, log, or accept arbitrary upstream URLs.
  const reader=request.body?.getReader();if(!reader)return Response.json({error:"缺少请求内容。"},{status:400,headers});
  let size=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>13_000_000){await reader.cancel();return Response.json({error:"内容过大，请缩短描述或重新生成参考图。"},{status:413,headers});}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let raw;try{raw=JSON.parse(new TextDecoder().decode(bytes));}catch{return Response.json({error:"请求内容格式不正确。"},{status:400,headers});}
  const parsed=requestSchema.safeParse(raw);
  if(!parsed.success)return Response.json({error:"请检查故事、角色或分镜内容；故事至少8字，分镜需为4、6或8格。"},{status:400,headers});
  return Response.json(await generate(parsed.data,key),{headers});
 }catch(error){return Response.json({error:error instanceof GenerationError?error.message:"生成失败，已保留当前作品，请重试。"},{status:error instanceof GenerationError?error.status:500,headers});}
}
