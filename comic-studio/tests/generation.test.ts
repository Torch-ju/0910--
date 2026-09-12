import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generate, requestSchema, GenerationError } from '../lib/generation';
import { imagePrompt, sampleProject } from '../lib/comic';
const sample=sampleProject();
const valid={action:'plan' as const,story:'一个怕黑的小女孩遇见一只邮差猫',style:'日系彩漫' as const,count:4 as const};
test('reject invalid count, short story and external image reference',()=>{
 assert.equal(requestSchema.safeParse({...valid,count:100}).success,false);
 assert.equal(requestSchema.safeParse({...valid,story:'hi'}).success,false);
 assert.equal(requestSchema.safeParse({action:'image',style:valid.style,characters:sample.characters,panel:sample.panels[0],reference:'https://attacker.example/image.png'}).success,false);
});
test('plan schema enforces the requested panel count',async()=>{
 const fake=async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...sample,panels:sample.panels.concat(sample.panels.slice(0,2))})}}]});
 await assert.rejects(generate(valid,'test',fake as typeof fetch),/分镜数量/);
});
test('valid generated plan is parsed, stripping untrusted extra fields',async()=>{
 let upstream='';const fake=async(input:RequestInfo|URL,init?:RequestInit)=>{upstream=String(input);const body=JSON.parse(String(init?.body));assert.equal(body.response_format.json_schema.strict,true);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(sample)}}]});};
 const result=await generate(valid,'test',fake as typeof fetch);assert.equal(upstream,'https://api.openai.com/v1/chat/completions');assert.ok('panels' in result);assert.equal('demo' in result,false);
});
test('API errors do not expose provider response or secret',async()=>{
 const fake=async()=>Response.json({error:{message:'sensitive upstream detail'}},{status:401});
 await assert.rejects(generate(valid,'secret',fake as typeof fetch),e=>e instanceof GenerationError&&e.status===401&&!e.message.includes('secret')&&!e.message.includes('sensitive'));
});
test('render uses reference image and current character appearance via edits',async()=>{
 const cast=[{...sample.characters[0],appearance:'紫色雨衣，绿色短靴'}];
 const fake=async(input:RequestInfo|URL,init?:RequestInit)=>{assert.equal(String(input),'https://api.openai.com/v1/images/edits');assert.ok(init?.body instanceof FormData);assert.match(String(init.body.get('prompt')),/紫色雨衣/);assert.ok(init.body.get('image[]') instanceof Blob);assert.equal(init.body.get('response_format'),null);return Response.json({data:[{b64_json:'YWJj'}]});};
 const r=await generate({action:'image',style:valid.style,characters:cast,panel:sample.panels[0],reference:'data:image/png;base64,YWJj'},'test',fake as typeof fetch);assert.deepEqual(r,{image:'data:image/png;base64,YWJj'});
});
test('captions remain separate from rendered artwork',()=>{const panel={...sample.panels[0],dialogue:'独立排版的台词'};assert.ok(!imagePrompt(sample,panel).includes(panel.dialogue));});
