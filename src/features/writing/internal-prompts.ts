/** App-generated chain instructions must never appear as the author's own chat message. */
const INTERNAL_PROMPTS = [
  "根据输入自动识别人物，补全 NPC 画像及必要的前史时间线建议。信息不足时提出待确认建议，不要求用户先回答问题。",
  "根据共同故事想法和已接受的世界、历史、开局需要生成 NPC 候选。",
  "根据共同故事想法和刚采用的世界、历史、开局需要生成 NPC 候选。",
  "根据刚写完的这一段正文，把新出现的地点、事件、势力或时间推进补进世界年表；保留已有事件，不要改写。",
];

export function isInternalPrompt(text: string): boolean {
  const value = text.trim();
  return INTERNAL_PROMPTS.includes(value) || value.startsWith("根据现有条件展开故事开篇");
}