import type { PresetId } from "@/lib/story/contracts";

export type StoryPreset = {
  id: PresetId;
  label: string;
  description: string;
  starter_prompt: string;
};

export const STORY_PRESETS: Record<PresetId, StoryPreset> = {
  western_fantasy: {
    id: "western_fantasy",
    label: "西方魔幻",
    description: "从魔法、王国、遗迹或边境的一个想法开始，不预设角色阵容。",
    starter_prompt: "我想创作一个西方魔幻故事，核心画面是……",
  },
  eastern_wuxia: {
    id: "eastern_wuxia",
    label: "东方武侠",
    description: "从江湖、门派、恩怨或行旅的一个想法开始，不预设角色阵容。",
    starter_prompt: "我想创作一个东方武侠故事，核心画面是……",
  },
};

export const getStoryPreset = (id: PresetId): StoryPreset => STORY_PRESETS[id];
