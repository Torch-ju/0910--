/* Generated from JSON Schema. Do not edit. */

/**
 * 世界框架和初始时间线的唯一实例契约。
 */
export interface StoryWorld {
  /**
   * 数据契约版本。
   */
  schema_version: "1.0.0";
  /**
   * 世界文档类型。
   */
  document_type: "story_world";
  /**
   * 同一故事在世界和 NPC 文档中的共同 ID。
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
  title: FactString;
  logline: FactString1;
  summary: FactString2;
  genre: FactStringArray;
  themes: FactStringArray1;
  tone: FactStringArray2;
  /**
   * 世界环境。
   */
  setting: {
    era: FactString3;
    geography: FactString4;
    /**
     * 重要地点。
     */
    locations: Location[];
    society: FactString8;
    technology_or_power_system: FactString9;
    /**
     * 世界运行规则，供后续叙事遵守。
     */
    world_rules: WorldRule[];
  };
  /**
   * 重要组织、门派、势力或群体。
   */
  organizations: Organization[];
  /**
   * 推动故事的冲突框架。
   */
  core_conflict: {
    description: FactString16;
    forces: FactStringArray3;
    stakes: FactString17;
    open_issues: FactStringArray4;
  };
  /**
   * 未来方向建议，不能当作已经发生的历史。
   */
  initial_outline: OutlineBeat[];
  /**
   * 唯一的世界历史与开局时间线。
   */
  timeline: TimelineEvent[];
  /**
   * 用户与共创过程确定的约束。
   */
  hard_constraints: Constraint[];
  /**
   * 内容边界。
   */
  prohibited_content: Constraint1[];
  /**
   * 待用户澄清事项。
   */
  open_questions: OpenQuestion[];
  /**
   * 应用维护的修订轨迹。
   */
  change_log: ChangeLogEntry[];
}
/**
 * 故事名称。
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
 * 一句话核心方向。
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
 * 目前共同形成的世界和故事方向摘要。
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
 * 故事类型，由场景引导但服从用户设定。
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
 * 故事主题。
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
 * 叙事气质与情绪。
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
 * 时代或虚构纪年背景。
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
 * 整体空间与地理。
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
 * 地点对象，供框架与 NPC Agent 共同引用。
 */
export interface Location {
  /**
   * 地点稳定 ID。
   */
  location_id: string;
  name: FactString5;
  description: FactString6;
  importance: FactString7;
}
/**
 * 地点名称，可由用户或 AI 提议。
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
 * 地点的背景与叙事作用。
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
 * 地点对当前故事的影响。
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
 * 社会结构、制度和生活方式。
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
 * 魔法、武学、技术或明确不存在的特殊力量。
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
 * 世界规则对象，供框架与 NPC Agent 共同引用。
 */
export interface WorldRule {
  /**
   * 世界规则稳定 ID。
   */
  rule_id: string;
  name: FactString10;
  description: FactString11;
  importance: FactString12;
}
/**
 * 世界规则名称，可由用户或 AI 提议。
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
 * 世界规则的背景与叙事作用。
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
 * 世界规则对当前故事的影响。
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
 * 组织对象，供框架与 NPC Agent 共同引用。
 */
export interface Organization {
  /**
   * 组织稳定 ID。
   */
  organization_id: string;
  name: FactString13;
  description: FactString14;
  importance: FactString15;
}
/**
 * 组织名称，可由用户或 AI 提议。
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
 * 组织的背景与叙事作用。
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
 * 组织对当前故事的影响。
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
 * 核心矛盾。
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
 * 冲突参与力量。
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
 * 成败后果。
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
 * 尚未决定的问题。
 */
export interface FactStringArray4 {
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
 * 未来创作方向节点。
 */
export interface OutlineBeat {
  /**
   * 大纲节点 ID。
   */
  beat_id: string;
  /**
   * 大纲顺序。
   */
  order: number;
  title: FactString18;
  description: FactString19;
  purpose: FactString20;
}
/**
 * 节点名称。
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
 * 拟议的发展方向。
 */
export interface FactString19 {
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
 * 节点的叙事作用。
 */
export interface FactString20 {
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
 * 初始世界时间线事件；只描述历史与开局。
 */
export interface TimelineEvent {
  /**
   * 历史事件 ID，供 NPC 前史引用。
   */
  event_id: string;
  name: FactString21;
  time_label: FactString22;
  /**
   * 已知排序序号；不能判断时为 null。
   */
  order: number | null;
  /**
   * 事件处于历史或故事开局；未来事件不得写入。
   */
  period: "history" | "opening";
  description: FactString23;
  /**
   * 须引用已有角色；未确定前不猜 ID。
   */
  related_character_ids: string[];
  /**
   * 须引用世界中的地点。
   */
  related_location_ids: string[];
  /**
   * 明确的先后依赖；不允许环。
   */
  after_event_ids: string[];
}
/**
 * 事件标题。
 */
export interface FactString21 {
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
 * 虚构纪年、相对时间或待定时间，不转换为现实日期。
 */
export interface FactString22 {
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
 * 世界历史、人物前史或开局事件的具体内容。
 */
export interface FactString23 {
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
 * 不可忽略的要求。
 */
export interface Constraint {
  /**
   * 约束 ID。
   */
  constraint_id: string;
  text: FactString24;
  /**
   * 约束类别。
   */
  category: "must_keep" | "avoid" | "style" | "content_safety";
}
/**
 * 要遵守或避免的具体内容。
 */
export interface FactString24 {
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
 * 不希望出现的内容。
 */
export interface Constraint1 {
  /**
   * 约束 ID。
   */
  constraint_id: string;
  text: FactString24;
  /**
   * 约束类别。
   */
  category: "must_keep" | "avoid" | "style" | "content_safety";
}
/**
 * 世界的未决问题。
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
  answer: FactString25 | null;
}
/**
 * 带来源、确认与锁定信息的文字事实。
 */
export interface FactString25 {
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
 * 世界变更。
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
