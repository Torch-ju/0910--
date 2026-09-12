import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
const readJson=async(path)=>JSON.parse(await readFile(path,"utf8"));
const ajv=new Ajv2020({allErrors:true,strict:true});addFormats(ajv);
ajv.addSchema(await readJson(resolve("schemas/common.schema.json")));
const validateWorld=ajv.compile(await readJson(resolve("schemas/story-world.schema.json")));
const validateCharacters=ajv.compile(await readJson(resolve("schemas/character-profiles.schema.json")));
const world=await readJson(resolve(process.argv[2]??"examples/story_world.json"));
const characters=await readJson(resolve(process.argv[3]??"examples/character_profiles.json"));
const validWorld=validateWorld(world),validCharacters=validateCharacters(characters);
if(!validWorld||!validCharacters||world.story_id!==characters.story_id) {
 console.error(JSON.stringify({result:"FAIL",world:validateWorld.errors,characters:validateCharacters.errors,sameStory:world.story_id===characters.story_id}));process.exitCode=1;
} else console.log(JSON.stringify({result:"PASS",scope:"JSON Schema and matching story ID",worldRevision:world.revision,characterRevision:characters.revision,npcCount:characters.characters.length,timelineCount:world.timeline.length}));

