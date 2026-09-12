import { StoryProviderError } from "@/lib/ai/model";

/** Character safety envelope, not a claim about provider token capacity. */
export function fitNarrativeRequest(prompt: string, input: unknown): string {
  const budget = Number(process.env.NARRATIVE_CONTEXT_CHARS ?? 60000);
  const reserve = Number(process.env.NARRATIVE_OUTPUT_RESERVE_CHARS ?? 8000);
  if (!Number.isInteger(budget) || budget < 12000 || !Number.isInteger(reserve) || reserve < 0 || reserve >= budget)
    throw new StoryProviderError({code:"context_config", userMessage:"上下文预算配置无效，请检查总预算与输出预留。", retryable:false}, 422);
  const limit = budget - reserve - prompt.length;
  const copy = structuredClone(input);
  const lists: {key:string; values:unknown[]}[] = [];
  const visit = (value:unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (["recent_prose", "relevant_memory"].includes(key) && Array.isArray(child)) lists.push({key,values:child});
      else visit(child);
    }
  };
  visit(copy);
  const size = () => JSON.stringify(copy).length;
  // Remove optional retrieval first, then older prose. Preserve the latest scene's ending.
  for (const list of lists.filter(l=>l.key === "relevant_memory")) while(size()>limit && list.values.length) list.values.pop();
  for (const list of lists.filter(l=>l.key === "recent_prose")) {
    while(size()>limit && list.values.length>1) list.values.shift();
    const last = list.values[0] as {content?:string;context_excerpt?:boolean} | undefined;
    if(size()>limit && typeof last?.content === "string") {
      const keep = Math.max(0,last.content.length-(size()-limit)-100);
      if(keep>=500) {last.content=Array.from(last.content).slice(-keep).join("");last.context_excerpt=true;}
    }
  }
  const user = JSON.stringify(copy);
  if(user.length>limit) throw new StoryProviderError({code:"context_budget",userMessage:`创作上下文仍超限：提示词与输入 ${prompt.length+user.length} 字符，输入预算 ${budget-reserve} 字符（另预留输出 ${reserve} 字符）。关键设定已保留；本次未发起模型调用，请精简设定或调整预算后恢复。`,retryable:false},422);
  return user;
}
