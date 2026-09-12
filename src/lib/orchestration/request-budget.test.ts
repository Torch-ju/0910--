import { afterEach, expect, it, vi } from "vitest";
import { fitNarrativeRequest } from "./request-budget";
afterEach(()=>vi.unstubAllEnvs());
it("counts prompt and output reserve, trims optional history without mutating source",()=>{
  vi.stubEnv("NARRATIVE_CONTEXT_CHARS","12000");vi.stubEnv("NARRATIVE_OUTPUT_RESERVE_CHARS","2000");
  const input={facts:"必须保留",recent_prose:[{content:"旧".repeat(6000)},{content:"新".repeat(8000)}],relevant_memory:["可选".repeat(5000)]};
  const before=JSON.stringify(input), result=JSON.parse(fitNarrativeRequest("指令".repeat(1500),input));
  expect(result.facts).toBe(input.facts);expect(result.recent_prose).toHaveLength(1);expect(result.recent_prose[0].content.endsWith("新")).toBe(true);
  expect(JSON.stringify(result).length+3000).toBeLessThanOrEqual(10000);expect(JSON.stringify(input)).toBe(before);
});
it("rejects oversized essential facts rather than silently exceeding budget",()=>{
  vi.stubEnv("NARRATIVE_CONTEXT_CHARS","12000");
  expect(()=>fitNarrativeRequest("指令",{facts:"事".repeat(15000)})).toThrow();
});
