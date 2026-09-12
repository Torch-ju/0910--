import { expect, it } from "vitest";
import { validateExtraction } from "./memory";
const extraction = (quote: string) => ({ mentions: [{ref:"shen",displayName:"沈砚",characterIdHint:"npc_shen",evidence:{sourceKind:"narration",segmentId:"prose",quote,confidence:1}}], events:[], facts:[], relationships:[], identities:[] });
it("restores only quote typography to a unique verbatim source span", () => {
  const text = '沈砚说：“走吧。”';
  for (const quote of ['沈砚说："走吧。"', '沈砚说：\\"走吧。\\"']) {
    expect(validateExtraction(extraction(quote), text, new Set(['npc_shen'])).mentions[0].evidence.quote).toBe(text);
  }
});
it("still rejects altered wording and ambiguous typographic matches", () => {
  expect(() => validateExtraction(extraction('沈砚说："留下。"'), '沈砚说：“走吧。”', new Set(['npc_shen']))).toThrow();
  expect(() => validateExtraction(extraction('沈砚说："走吧。"'), '沈砚说：“走吧。”沈砚说：“走吧。”', new Set(['npc_shen']))).toThrow();
});
