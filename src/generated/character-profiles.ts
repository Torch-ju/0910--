/* Generated from JSON Schema. Do not edit. */

/**
 * 动态 NPC 画像与人物关系集合。
 */
export interface CharacterProfiles {
  /**
   * 数据契约版本。
   */
  schema_version: "1.0.0";
  /**
   * 人物文档类型。
   */
  document_type: "character_profiles";
  /**
   * 与世界文档一致的故事 ID。
   */
  story_id: string;
  /**
   * 文档修订号。
   */
  revision: number;
  /**
   * 文档创建的系统时间。
   */
  created_at: string;
  /**
   * 最后更新的系统时间。
   */
  updated_at: string;
  /**
   * 人数由用户输入和故事需要决定；允许尚无人物的草稿，不设固定人数。
   */
  characters: Character[];
  /**
   * 唯一关系本体数组。
   */
  relationships: Relationship[];
  /**
   * 文档级变更轨迹。
   */
  change_log: ChangeLogEntry1[];
}
/**
 * 供 NPC Agent 与后续叙事使用的人物画像。
 */
export interface Character {
  /**
   * 稳定角色 ID，改名不改变。
   */
  character_id: string;
  /**
   * 用户明确扮演的角色由用户控制，否则为 NPC。
   */
  controlled_by: "npc" | "user";
  /**
   * 用于识别同一人物，歧义须确认。
   */
  aliases: string[];
  name: FactString;
  identity: FactString1;
  role: FactString2;
  appearance: FactString3;
  personality: FactStringArray;
  desire: FactString4;
  fear: FactString5;
  secret: FactString6;
  background: FactString7;
  speech_style: FactString8;
  behavior_tendencies: FactStringArray1;
  /**
   * 角色成长计划，不是历史。
   */
  growth_arc: {
    starting_state: FactString9;
    pressure_point: FactString10;
    possible_direction: FactString11;
    /**
     * 从组成事实的确认状态派生，模型不得自定。
     */
    user_confirmed: boolean;
  };
  entrance_condition: FactString12;
  current_state: FactString13;
  known_information: FactStringArray2;
  unknown_information: FactStringArray3;
  /**
   * 只引用关系，不重复保存本体。
   */
  relationship_ids: string[];
  /**
   * 人物前史涉及的事件。
   */
  timeline_event_ids: string[];
  /**
   * 需保留的角色要求。
   */
  hard_constraints: Constraint[];
  /**
   * 需澄清的身份或关系。
   */
  open_questions: OpenQuestion[];
  /**
   * 角色的重要修改轨迹。
   */
  change_log: ChangeLogEntry[];
}
/**
 * 姓名或未命名称呼。
 */
export interface FactString {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 身份、职业和社会位置。
 */
export interface FactString1 {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 核心、配角或待定叙事定位。
 */
export interface FactString2 {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 可识别外貌或动作特征。
 */
export interface FactString3 {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 可观察的性格特征。
 */
export interface FactStringArray {
  /**
   * 同一来源和确认状态的一组文本；允许空数组。
   */
  value: string[];
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 核心欲望或当前目标。
 */
export interface FactString4 {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 恐惧或不愿面对的事。
 */
export interface FactString5 {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 隐藏信息，未确定时留草稿。
 */
export interface FactString6 {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 与世界历史一致的经历。
 */
export interface FactString7 {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 词汇、语气和说话习惯。
 */
export interface FactString8 {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 在压力和选择中的行为倾向。
 */
export interface FactStringArray1 {
  /**
   * 同一来源和确认状态的一组文本；允许空数组。
   */
  value: string[];
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 开局状态。
 */
export interface FactString9 {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 可能迫使人物改变的压力。
 */
export interface FactString10 {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 未发生的成长方向。
 */
export interface FactString11 {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 何时、为何出场。
 */
export interface FactString12 {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 开局处境、心理与资源。
 */
export interface FactString13 {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 人物已知的信息。
 */
export interface FactStringArray2 {
  /**
   * 同一来源和确认状态的一组文本；允许空数组。
   */
  value: string[];
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 人物尚不知但与剧情相关的信息。
 */
export interface FactStringArray3 {
  /**
   * 同一来源和确认状态的一组文本；允许空数组。
   */
  value: string[];
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 人物约束。
 */
export interface Constraint {
  /**
   * 约束 ID。
   */
  constraint_id: string;
  text: FactString14;
  /**
   * 约束类别。
   */
  category: "must_keep" | "avoid" | "style" | "content_safety";
}
/**
 * 要遵守或避免的具体内容。
 */
export interface FactString14 {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 人物未决问题。
 */
export interface OpenQuestion {
  /**
   * 问题 ID。
   */
  question_id: string;
  /**
   * 需要用户澄清的内容。
   */
  question: string;
  /**
   * 影响程度。
   */
  importance: "high" | "medium" | "low";
  /**
   * 是否影响继续生成或正式确认。
   */
  blocking: boolean;
  /**
   * 问题解决状态。
   */
  status: "open" | "resolved" | "dismissed";
  /**
   * 用户回答；未回答为 null。
   */
  answer: FactString15 | null;
}
/**
 * 带来源、确认与锁定信息的文字事实。
 */
export interface FactString15 {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 人物变更。
 */
export interface ChangeLogEntry {
  /**
   * 变更 ID。
   */
  change_id: string;
  /**
   * 系统记录时间。
   */
  changed_at: string;
  /**
   * 执行变更的主体。
   */
  actor: "user" | "ai" | "system";
  /**
   * 变更原因与结果。
   */
  summary: string;
  /**
   * 受影响字段。
   */
  changed_paths: string[];
  /**
   * 本次操作 ID；用于重复操作识别。
   */
  operation_id: string;
  /**
   * 变更前修订号。
   */
  previous_revision: number;
  /**
   * 变更后修订号。
   */
  new_revision: number;
}
/**
 * 方向明确的角色关系。
 */
export interface Relationship {
  /**
   * 关系 ID。
   */
  relationship_id: string;
  /**
   * 关系起点角色。
   */
  from_character_id: string;
  /**
   * 关系终点角色。
   */
  to_character_id: string;
  /**
   * 关系类别。
   */
  type:
    | "family"
    | "friend"
    | "ally"
    | "rival"
    | "enemy"
    | "mentor"
    | "romantic"
    | "professional"
    | "dependent"
    | "unknown"
    | "custom";
  description: FactString16;
  current_state: FactString17;
  possible_direction: FactString18;
}
/**
 * 带来源、确认与锁定信息的文字事实。
 */
export interface FactString16 {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 带来源、确认与锁定信息的文字事实。
 */
export interface FactString17 {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 带来源、确认与锁定信息的文字事实。
 */
export interface FactString18 {
  /**
   * 业务文本；草稿允许空字符串，确认前由业务规则检查。
   */
  value: string;
  /**
   * 当前值形成方式。用户接受 AI 建议不改变来源；用户改写后为 user_edited。
   */
  source: "user_explicit" | "user_edited" | "ai_inferred" | "ai_suggestion";
  /**
   * 共同创作确认状态；未经用户操作不能成为 confirmed。
   */
  status: "draft" | "pending_confirmation" | "confirmed" | "rejected";
  /**
   * 用户锁定标记；模型不得自行改动。
   */
  locked: boolean;
  /**
   * 内容依据；空数组表示没有直接引用。
   */
  evidence: string[];
  /**
   * 该事实最后更新的系统时间，不是虚构世界时间。
   */
  updated_at: string;
}
/**
 * 人物文档变更。
 */
export interface ChangeLogEntry1 {
  /**
   * 变更 ID。
   */
  change_id: string;
  /**
   * 系统记录时间。
   */
  changed_at: string;
  /**
   * 执行变更的主体。
   */
  actor: "user" | "ai" | "system";
  /**
   * 变更原因与结果。
   */
  summary: string;
  /**
   * 受影响字段。
   */
  changed_paths: string[];
  /**
   * 本次操作 ID；用于重复操作识别。
   */
  operation_id: string;
  /**
   * 变更前修订号。
   */
  previous_revision: number;
  /**
   * 变更后修订号。
   */
  new_revision: number;
}
