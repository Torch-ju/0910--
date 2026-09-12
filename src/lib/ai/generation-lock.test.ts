import { expect, it } from "vitest";
import { sharedStoryGeneration } from "./generation-lock";
it("shares concurrent identical generation, blocks changed input and allows independent stories",async()=>{
  let release!:(value:string)=>void,calls=0;
  const work=()=>{calls++;return new Promise<string>(resolve=>{release=resolve;});};
  const first=sharedStoryGeneration('story-a','same',work),second=sharedStoryGeneration('story-a','same',work);
  await expect(sharedStoryGeneration('story-a','changed',work)).rejects.toMatchObject({error:{code:'generation_running'}});
  expect(await sharedStoryGeneration('story-b','same',async()=> 'independent')).toBe('independent');
  release('result');expect(await first).toBe('result');expect(await second).toBe('result');expect(calls).toBe(1);
  expect(await sharedStoryGeneration('story-a','next',async()=> 'next')).toBe('next');
});
