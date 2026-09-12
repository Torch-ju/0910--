import common from "../../../schemas/common.schema.json";
import worldSchema from "../../../schemas/story-world.schema.json";
import charactersSchema from "../../../schemas/character-profiles.schema.json";
import type { CharacterProfiles, Fact, FieldTarget, StoryWorld } from "./contracts";
import { atPath, StoryError } from "./state";
import { isFact } from "./validation";

type Schema = Record<string, unknown>;
const documents: Record<string, Schema> = {
  [common.$id]: common, [worldSchema.$id]: worldSchema, [charactersSchema.$id]: charactersSchema,
};
function dereference(node: Schema, document: Schema): { node: Schema; document: Schema } {
  if (typeof node.$ref !== "string") return { node, document };
  const url = new URL(node.$ref, document.$id as string);
  const nextDocument = documents[url.origin + url.pathname];
  if (!nextDocument) throw new StoryError("FIELD_SCHEMA", "字段引用了未知的 Schema。");
  const resolved = dereference(atPath(nextDocument, decodeURIComponent(url.hash.slice(1))) as Schema, nextDocument);
  return { ...resolved, node: { ...resolved.node, ...(node.description ? { description: node.description } : {}) } };
}
const tasks: Record<string, string> = {
  title: "拟定能够体现核心意象的故事名称，不把故事写成宣传口号。",
  logline: "提炼人物处境和核心冲突的一句话方向，不预定结局。",
  summary: "概括故事世界与开局局势，不续写未来剧情。",
  genre: "识别故事类型；优先用户选择，不擅自更换世界流派。",
  themes: "提炼可在冲突和人物选择中体现的主题；区分用户明确主题与 AI 推断。",
  tone: "提出与故事想法一致的叙事气质，而非新增世界事实。",
  era: "描述时代背景，保留虚构纪年和未确定时间，不伪造公历日期。",
  geography: "描述相关地理空间和可达关系，不任意改写已有地点。",
  society: "描述社会结构、权力和日常秩序，遵守已确认组织。",
  technology_or_power_system: "描述力量或技术的能力、代价、限制，避免无限力量。",
  name: "为当前实体提出名称；无名人物的建议姓名不得伪装成用户原话。",
  identity: "明确人物社会身份，保留用户指定身份与控制属性。",
  role: "说明人物在初始冲突中的叙事作用，不预定人物结局。",
  appearance: "提出可识别的外貌特征，避免无依据套用刻板身份。",
  personality: "提出可体现在行为中的性格特征及内在张力。",
  desire: "提出该人物个人化的核心欲望，联系背景与当前冲突。",
  fear: "提出与人物欲望和经历相连的核心恐惧。",
  secret: "提出未被其他人物普遍知晓的秘密；新增历史只能建议。",
  background: "基于已接受世界历史整理人物前史，不把新事件当成既定事实。",
  speech_style: "描述句式、用词和语气，并给出短小表达例子。",
  behavior_tendencies: "提出遭遇压力和选择时的可观察行为倾向。",
  entrance_condition: "描述开局出场条件，不宣称未来事件已经发生。",
  current_state: "描述故事开局时的处境和状态。",
  known_information: "列出该人物有依据知道的信息，不泄露其他人物秘密。",
  unknown_information: "列出该人物尚不知道但相关的信息。",
  starting_state: "描述成长起点，不能提前完成成长。",
  pressure_point: "提出能够触发人物变化的压力。",
  possible_direction: "只建议开放的变化方向，不能确认或锁定未来结局。",
  time_label: "保留虚构纪年或相对时间；时间未知时明确不确定，不编造日期。",
  stakes: "说明核心冲突可能损害的利益和代价，不决定谁获胜。",
  forces: "提炼冲突力量，不把组织和群体自动拆成个人。",
  open_issues: "列出尚待共同创作确定的问题，不擅自填成确定事实。",
  purpose: "说明该大纲方向的叙事意图，保持未来计划性质。",
  importance: "说明当前实体对世界和开局的作用，不新增已发生的剧情。",
  text: "整理具体约束或边界，不解除用户禁令，不将建议擅自标为硬约束。",
};

/** Resolve the selected Fact through the public schemas, not a hand-written field schema. */
export function getFieldContract(world: StoryWorld, characters: CharacterProfiles, target: FieldTarget) {
  const fact = atPath(target.document === "world" ? world : characters, target.path);
  if (!isFact(fact) || !(typeof fact.value === "string" || Array.isArray(fact.value))) throw new StoryError("FIELD_NOT_CREATIVE", "只有创作内容字段支持 AI 建议，系统标识与权限不可改写。");
  if (fact.locked) throw new StoryError("LOCKED_CHANGE", "请先明确解锁这个字段，再请求 AI 建议。");
  let current: { node: Schema; document: Schema } = { node: target.document === "world" ? worldSchema : charactersSchema, document: target.document === "world" ? worldSchema : charactersSchema };
  const parts = target.path.slice(1).split("/");
  for (const part of parts) {
    current = dereference(current.node, current.document);
    const child = current.node.type === "array" && /^(0|[1-9][0-9]*)$/.test(part)
      ? current.node.items : (current.node.properties as Record<string, Schema> | undefined)?.[part];
    if (!child || typeof child !== "object") throw new StoryError("FIELD_SCHEMA", "字段不在当前公共 Schema 中。");
    current = { node: child as Schema, document: current.document };
  }
  const resolved = dereference(current.node, current.document).node;
  const properties = resolved.properties as Record<string, Schema>;
  if (!properties?.value || !properties.evidence) throw new StoryError("FIELD_SCHEMA", "字段不是带来源的 Fact。");
  const name = parts.at(-1) ?? "";
  const description = String(current.node.description ?? resolved.description ?? target.path);
  const category = target.path.includes("/timeline/") ? "世界历史或开局时间线" : target.path.includes("/world_rules/") ? "世界规则的能力、限制及例外" : target.path.includes("/relationships/") ? "人物关系及其现状" : target.path.includes("/initial_outline/") ? "尚未发生的创作计划" : target.document === "characters" ? "当前人物画像" : "世界框架";
  const task = category + "；" + (tasks[name] ?? "只完善当前字段的描述，保持实体身份和全部引用不变。") + " 字段含义：" + description;
  const schema: Schema = {
    type: "object", additionalProperties: false, required: ["fact", "explanation", "warnings"],
    properties: {
      fact: { type: "object", additionalProperties: false, required: ["value", "source", "evidence"], properties: {
        value: properties.value, evidence: properties.evidence,
        source: { type: "string", enum: ["user_explicit", "ai_inferred", "ai_suggestion"] },
      } },
      explanation: { type: "string", maxLength: 4000 },
      warnings: { type: "array", items: { type: "string" } },
    },
  };
  return { schema, task, description, value: fact as Fact<string | string[]> };
}
