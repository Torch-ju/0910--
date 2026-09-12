import { expect,it } from "vitest";
import { creativeSnapshot } from "./creative-context";
import { createSnapshot, createCharacter } from "@/lib/story/factory";
it("drops editor metadata while preserving identities, facts, sources and the authoritative snapshot",()=>{
  const snapshot=createSnapshot('western_fantasy');snapshot.characters.characters.push(createCharacter('艾琳','npc_elin'));
  snapshot.operations.push({operation_id:"op_test",fingerprint:"x".repeat(100000),revision:1});
  const original=JSON.stringify(snapshot),context=creativeSnapshot(snapshot) as typeof snapshot;
  expect(context.characters.characters[0].name).toEqual({value:"艾琳",evidence:[],locked:false,source:"user_edited",status:"pending_confirmation"});
  expect(context.characters.characters[0].character_id).toBe('npc_elin');
  expect(JSON.stringify(context).length).toBeLessThan(original.length);
  expect(JSON.stringify(snapshot)).toBe(original);expect(context.world.created_at).toBeUndefined();expect(context.operations).toBeUndefined();
});
