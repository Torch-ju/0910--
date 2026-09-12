import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {modelClient} from '../lib/story/ai';
const schema=z.object({text:z.string()});
const key='test-only-key-not-a-real-secret';
function response(content:string,finish='stop'){return Response.json({choices:[{finish_reason:finish,message:{content}}]});}
test('provider routing and token contracts',async t=>{
 for(const provider of ['deepseek','openai'])await t.test(provider,async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{assert.equal(String(url),provider==='deepseek'?'https://api.deepseek.com/chat/completions':'https://api.openai.com/v1/chat/completions');const body=JSON.parse(String(init?.body));assert.equal(new Headers(init?.headers).get('Authorization'),`Bearer ${key}`);assert.equal(body.response_format.type,'json_object');if(provider==='deepseek'){assert.equal(body.model,'deepseek-flash');assert.equal(body.max_tokens,9000);assert.equal(body.thinking.type,'disabled');assert.equal(body.max_completion_tokens,undefined);}else{assert.equal(body.model,'gpt-4.1-mini');assert.equal(body.max_completion_tokens,9000);assert.equal(body.max_tokens,undefined);}return response('{"text":"江湖"}');};
 try{assert.deepEqual(await modelClient(key,provider)('世界观','故事',schema,{text:''}),{text:'江湖'});}finally{globalThis.fetch=original;}
 });
});
test('empty JSON retries; truncated output and invalid credentials fail',async()=>{
 const original=globalThis.fetch;let count=0;
 try{globalThis.fetch=async()=>response(++count===1?'':'{"text":"重试成功"}');assert.equal((await modelClient(key,'deepseek')('角色','故事',schema,{})).text,'重试成功');assert.equal(count,2);
 globalThis.fetch=async()=>response('{"text":"半段"}','length');await assert.rejects(modelClient(key,'deepseek')('正文','故事',schema,{}),/未完整/);
 globalThis.fetch=async()=>new Response('',{status:401});await assert.rejects(modelClient(key,'deepseek')('正文','故事',schema,{}),/Key 无效/);
 globalThis.fetch=async()=>{throw Error('must not call');};await assert.rejects(modelClient(key,'unknown')('正文','故事',schema,{}),/不支持/);
 }finally{globalThis.fetch=original;}
});
