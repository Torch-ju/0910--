# 书中人第一层功能规格

文档 ID：`SPEC-L1`。需求版本：`1.1.0`。整理日期：`2026-09-12`。

## 已批准的执行基线

用户已明确授权实施：故事框架 Agent 先理解输入并生成世界框架与初始时间线，NPC Agent 再依据两者及人物线索生成画像，用户共同修改并确认。预设入口仅西方魔幻、东方武侠，不预设阵容。时间线只包含世界历史、人物前史与开局，未来方向保留在初始大纲。角色数量不固定；用户未写人物时主动提出待确认建议。真实兼容模型接入提前，首次联调最多 10 次请求，包括失败和修复。跨文档 ID、关系与事件引用及锁定、修订由应用校验。具体机器字段以已生成的三个 Schema 为准；现有空对象片段仅作结构示意。

开发工作采用主 Agent 与两个不重叠 Worker；界面、Agent 和状态层在共同契约后并行。模型地址和密钥只存服务端本地环境，开发记忆不保存凭据。完整叙事、章节、账号与对外部署仍不在本层范围。

本文件由已讨论并获得用户认可的开发提示词迁移而来，是第一层的唯一功能与数据契约需求来源。本文描述应实现的行为，不代表功能已经实现。实际进度只记录在 `memory/CURRENT.md`。

> 产品本意：用户和 AI 一起完成故事。用户负责创意、选择、修改和最终判断，AI 负责理解、追问、整理、扩展、记忆和推进。

本轮确定的首期范围是：前端交互、自然语言输入、语义识别、故事世界和角色画像的 JSON Schema、草案编辑与用户确认。完整叙事能力作为未来方向保留。

项目协作入口为根目录 `AGENTS.md`；导航为 `README.md`；开发记忆只维护在项目内 `memory/`。需求修改更新本文件；变更原因记录在 `memory/DECISIONS.md`；不要再创建另一份生效提示词、功能规格或进度表。

参考材料：`ARCHITECTURE (1).md` 保存早期完整架构构想，`AI产品Vibe Coding通用前端技术栈手册.md` 提供通用工程原则。前者提及的其他工程路径不构成当前代码已经存在的证据。第一层范围和已定语义以本文件及用户当前明确指令为准。

## 功能索引

下列编号稳定保留，供任务、实现文件和验收证据引用；表内不维护完成状态。

| 功能 ID | 功能 | 本文位置 |
| --- | --- | --- |
| F-01 | 自然语言输入与多轮共同创作 | 四、五 |
| F-02 | 理解反馈、实体/意图/约束识别、必要澄清 | 四、七 |
| F-03 | 故事世界草案与可编辑呈现 | 五、八 |
| F-04 | 角色画像、关系与局部重生成 | 五、九 |
| F-05 | 来源、确认、拒绝、锁定、冲突处理 | 三、五、八、九 |
| F-06 | JSON Schema、校验、引用完整性 | 八、九 |
| F-07 | 局部更新、版本、幂等与恢复 | 十、十一、十二 |
| F-08 | 保存、刷新恢复、JSON 查看和导出 | 十二 |
| F-09 | 简约美学、响应式与可访问交互 | 六 |
| F-10 | Provider 边界、真实状态反馈与可恢复错误 | 十、十一 |

非产品实现的文档维护任务使用 `L1-00`，开发任务使用 `L1-01` 至 `L1-06`，任务状态只在 `memory/CURRENT.md` 中维护。

## 一、产品定位

“书中人”是一个持续性的故事共同创作空间。

用户可以用自然语言表达一个还不完整、甚至很模糊的故事想法。AI 不应该立即替用户决定所有内容，而应该先反馈自己对用户想法的理解，识别其中已经明确的设定，指出需要进一步决定的部分，并提出有价值的创作建议。

用户可以接受、修改、拒绝或继续补充 AI 的建议。AI 需要根据用户反馈持续更新故事状态，直到双方形成一套用户认可的基础设定。

产品未来会继续支持：

- AI 与用户共同推进剧情
- 角色状态持续变化
- 章节生成与归档
- 时间线和伏笔维护
- 长期故事记忆
- 剧本导出

但是当前任务只实现第一层，不要越界实现完整小说平台。

## 二、当前开发范围：第一层

当前第一层称为“故事共同创作启动层”。

它不是一次性 JSON 生成器，而是帮助用户和 AI 建立第一个共同认可的故事基础。

第一层的目标闭环是：

```text
用户自然语言表达故事想法
    ↓
AI 反馈对故事想法的理解
    ↓
AI 识别故事元素、偏好和硬性约束
    ↓
AI 发现重要信息缺口并提出必要问题
    ↓
AI 提供世界观和角色的初步方案
    ↓
用户选择、修改、否定或补充
    ↓
AI 根据用户反馈更新结构化故事状态
    ↓
用户确认基础设定
    ↓
保存故事世界.json和角色画像.json
    ↓
进入后续剧情共同创作
```

当前必须实现的能力：

- 前端故事创建工作台
- 自然语言输入
- AI 对输入的理解反馈
- 故事元素识别和结构化展示
- 故事世界草案生成
- 根据用户输入与故事需要动态生成 NPC 草案，不固定人数
- 用户编辑、选择、拒绝和补充
- 用户锁定不可改变的设定
- AI 根据局部反馈重新生成或更新
- 区分用户设定、AI 推断、AI 建议和待确认内容
- 生成并保存结构化 `story_world.json`
- 生成并保存结构化 `character_profiles.json`
- 允许用户查看或导出 JSON
- 为后续主叙事 Agent 读取这些状态预留稳定接口

当前不需要完整实现：

- 连续剧情生成
- 完整主叙事 Agent
- 章节自动归档
- 上下文压缩
- 长期记忆检索
- 多用户账号系统
- 云端同步
- 复杂后台任务队列
- DOCX/PDF 导出
- 完整数据库和生产级权限系统

可以为这些能力预留接口，但不要因为未来规划而让当前第一层失去可运行性和聚焦性。

## 三、核心产品原则

### 1. AI 是共同创作者，不是替代作者

AI 可以提出建议，但不能把未经用户确认的内容伪装成既定事实。

AI 可以主动补全，但必须明确标记为推断或建议。

遇到会显著改变故事方向的歧义时，AI 应该提问，而不是擅自决定。

如果信息不足但不影响继续创作，AI 可以先生成一个暂定方案，并标记为“待确认”，不要不必要地阻塞用户。

### 2. 用户拥有创作控制权

用户可以：

- 修改任何未锁定字段
- 删除 AI 建议
- 拒绝某个角色或世界观设定
- 添加自己的设定
- 要求 AI 提供多个方案
- 选择一个方案作为基础
- 把设定标记为不可改变
- 回退到之前的版本

用户确认并锁定的内容，后续 AI 不得无提示地覆盖。

### 3. 故事状态必须结构化

故事世界和角色画像不能只保存为一大段文学化文本。它们必须具备稳定字段、明确状态、来源信息和版本信息，以便后续 Agent 读取和更新。

### 4. 过程必须透明

界面应让用户知道：

- AI 正在理解什么
- 哪些内容来自用户
- 哪些内容是 AI 推断
- 哪些内容是 AI 主动建议
- 哪些内容等待用户确认
- 当前故事状态是否已保存

### 5. 交互必须可逆

生成、修改、拒绝和重新生成都不应该让用户失去原内容。至少在 MVP 中应保留当前版本和最近一次变更记录。

## 四、目标用户流程

### 阶段 1：进入故事创建

用户进入产品后看到一个具有文学感、但足够清晰的创作入口。

页面应鼓励用户直接描述想法，而不是强迫用户先填写复杂表单。

可以显示少量弱引导问题：

- 你想写一个什么故事？
- 故事发生在什么时代或地点？
- 你希望它是什么样的氛围？
- 有没有必须保留的角色、事件或设定？
- 有没有不希望出现的内容？

这些问题只能作为提示，不能限制用户自由输入。

### 阶段 2：AI 反馈理解

用户提交后，AI 先不要立即展示最终世界观，而要先给出一段简洁的理解反馈。

示例：

```text
我目前理解的是：这是一个发生在近未来海上城市的冷峻悬疑故事。主角是一名失去部分记忆的气象工程师，核心冲突可能围绕人工智能失控和身份认同展开。

目前有两个地方可以继续确定：
1. 主角的失忆是人为造成的，还是事故造成的？
2. 你希望故事更偏向心理悬疑，还是社会科幻？
```

这一步的目的是让用户确认 AI 是否真正理解了自己的想法。

### 阶段 3：识别和结构化

AI 将输入中的信息提取为结构化条目，并在界面中显示。

需要识别的内容包括：

- 故事方向
- 类型
- 时代
- 地点
- 世界规则
- 技术体系或力量体系
- 人物
- 人物关系
- 组织
- 事件
- 核心冲突
- 主题
- 叙事风格
- 情绪和氛围
- 用户硬性要求
- 禁止或不希望出现的内容
- 尚未确定的问题

识别结果必须可以被用户查看、修改和确认。

### 阶段 4：提出建议并共同生成

当用户输入的信息足够时，AI 可以提出：

- 一个基础世界观方案
- 两至三个不同方向的故事方案
- 两至五个核心角色
- 角色之间的关系建议
- 初始冲突建议
- 需要用户决定的关键分歧

如果提供多个方案，必须说明它们的差异，不要只生成几段相似文本。

### 阶段 5：编辑和确认

用户可以在对话中修改，也可以直接编辑结构化卡片。

例如用户说：

```text
把男主角从气象工程师改成城市维护员，但保留他的失忆设定。
```

系统应该只更新相关字段，保留其他已经确认的内容。

用户点击“确认设定”后，当前版本才成为正式的故事基础。

## 五、前端交互要求

请将页面设计为“对话区 + 故事状态区 + 确认操作区”组成的故事共创工作台。

### 1. 故事输入区

需要提供：

- 大尺寸自然语言输入框
- 清晰但不强迫用户填写的提示语
- 提交按钮
- 示例想法或灵感标签
- 输入字符提示，但不要设置过低的限制
- 支持多轮输入
- 支持清空和重新开始

输入框的 placeholder 可以类似：

```text
告诉我你想写的故事。可以是一句话，也可以是一段还没有成形的想法……
```

### 2. AI 状态区

AI 工作时要展示有意义的阶段状态，而不是只有一个旋转图标。

状态可以包括：

```text
正在理解故事方向
正在提取世界观要素
正在识别人物和关系
正在检查设定冲突
正在整理故事世界
正在生成角色画像
正在等待你的确认
```

这些状态可以先使用本地模拟流程实现，但代码结构必须为真实模型调用和流式响应预留接口。

### 3. 理解反馈区

显示 AI 对用户输入的概括，并允许用户：

- 确认 AI 的理解
- 指出 AI 理解错误的地方
- 继续补充
- 要求 AI 换一种方向理解

不要把这部分隐藏在后台。它是人机共同创作的重要环节。

### 4. 识别结果区

使用标签、卡片或列表展示识别出的内容。

每个识别条目至少显示：

- 类型
- 内容
- 来源
- 当前状态
- 是否锁定

建议使用以下来源标签：

- 用户设定
- 用户修改
- AI 推断
- AI 建议

建议使用以下状态标签：

- 草稿
- 待确认
- 已确认
- 已锁定
- 已拒绝

### 5. 故事世界区

不要把原始 JSON 直接作为主要用户界面。

应将 `story_world.json` 转化为易读的结构化卡片或编辑表单，至少展示：

- 故事标题
- 一句话梗概
- 故事简介
- 类型
- 时代背景
- 地理空间
- 重要地点
- 社会结构
- 技术体系或力量体系
- 世界运行规则
- 重要组织
- 核心冲突
- 故事主题
- 叙事基调
- 初始故事大纲
- 时间线
- 用户硬性设定
- 待确认问题

每个字段都应该支持查看来源，并支持编辑、确认、拒绝或锁定。

### 6. 角色画像区

使用角色卡片展示 `character_profiles.json`。

每张角色卡至少展示：

- 姓名
- 身份
- 角色定位
- 性格关键词
- 核心欲望
- 核心恐惧
- 个人秘密
- 背景经历
- 人物关系
- 说话风格
- 行为倾向
- 成长弧线
- 出场条件
- 当前状态

角色卡应支持：

- 编辑
- 删除
- 添加角色
- 单独重新生成
- 锁定角色核心设定
- 查看来源和变更记录

### 7. 确认操作区

需要有明确的“确认设定”操作，但不要让用户误以为点击后永远不能修改。

建议文案：

```text
确认并保存基础设定
```

确认前需要显示：

- 还有多少条内容待确认
- 是否存在关键冲突
- 是否存在空白但不影响开始的问题
- 哪些字段已经锁定

确认后仍应允许用户在后续创作中提出修改，但修改需要记录为新的版本或变更。第一层结束页展示“基础设定已保存”；剧情续写入口在对应能力实现前明确标记为后续阶段，不能以可点击的空入口暗示已经实现。

## 六、简约美学 UI 要求

视觉方向是“文学编辑台 + 现代 AI 工作台”，简洁、安静、有叙事感，不要做成普通后台管理系统。

### 视觉气质

- 留白充足
- 层级清晰
- 信息密度可控
- 具有纸张、书页、编辑台或档案的隐喻
- 既有文学感，也有现代产品的可用性
- 不要使用廉价的科幻霓虹效果
- 不要使用默认紫色渐变 AI 模板
- 不要把所有内容塞进卡片网格

### 推荐色彩方向

可以采用暖白或纸张色作为主背景，墨黑作为主要文字色，使用低饱和砖红、橄榄绿或铜色作为强调色。

示例变量：

```css
:root {
  --paper: #f5f2ea;
  --paper-deep: #ebe5d8;
  --ink: #202522;
  --ink-muted: #70766f;
  --line: #d9d2c5;
  --accent: #b5654a;
  --accent-soft: #ead4c9;
  --success: #71836b;
  --warning: #ad8750;
}
```

颜色不是强制值，但整体应保持克制、温和、可阅读。

### 字体方向

标题和故事内容可以使用具有书籍感的衬线字体，界面操作文字使用清晰的无衬线字体。

优先使用项目已有字体；如果项目没有字体方案，可以使用适合中文阅读的字体组合，例如思源宋体类字体和思源黑体类字体。不要依赖无法稳定加载的外部字体作为唯一方案。

### 动效方向

只使用有意义的动效：

- 页面初次进入时的轻微内容显现
- AI 工作阶段的顺序展示
- 新识别条目的渐进出现
- 故事卡片更新时的轻微反馈
- 确认设定时的状态转换

不要使用大量弹跳、闪烁或无意义的微动效。

### 响应式要求

桌面端可以采用对话区和故事状态区并列的布局。

移动端需要改为纵向流程：

```text
故事输入
    ↓
AI 理解反馈
    ↓
识别结果
    ↓
故事世界
    ↓
角色画像
    ↓
确认设定
```

输入区在移动端应保持易操作，主要操作按钮不能被复杂布局遮挡。

## 七、自然语言识别协议

“识别”在本产品中指语义理解、意图识别、实体提取、约束识别和冲突识别，不是 OCR 或人脸识别。

### 识别意图

至少支持以下意图：

- `create_story`：创建故事
- `add_setting`：补充故事设定
- `add_character`：补充角色
- `modify_setting`：修改已有设定
- `modify_character`：修改角色
- `reject_suggestion`：拒绝 AI 建议
- `request_options`：要求 AI 提供多个方案
- `confirm_setting`：确认设定
- `ask_question`：向 AI 提问
- `restart_story`：重新开始
- `continue_collaboration`：继续共同创作

### 识别实体

至少识别以下实体：

- 故事
- 角色
- 地点
- 组织
- 事件
- 关系
- 时间
- 技术
- 力量
- 世界规则
- 冲突
- 主题
- 风格
- 情绪
- 硬性约束
- 禁止内容

### 识别输出

识别层内部可以使用如下结构：

```json
{
  "intent": "create_story",
  "summary": "用户想创作一个发生在近未来海上城市的冷峻悬疑故事。",
  "extracted_items": [
    {
      "id": "item_001",
      "type": "setting",
      "field": "time_period",
      "value": "近未来",
      "evidence": "发生在近未来海上城市",
      "source": "user_explicit",
      "status": "pending_confirmation",
      "confidence": 0.98
    }
  ],
  "hard_constraints": [],
  "ambiguities": [],
  "conflicts": [],
  "follow_up_questions": [],
  "suggested_actions": ["generate_world_draft", "generate_character_draft"]
}
```

要求：

- 不要把低置信度推断当作用户明确设定
- 尽可能保存来自用户原话的 evidence
- 能确定字段时直接提取
- 不能确定但适合补全时标记为 `ai_suggestion`
- 会改变故事方向的歧义要进入 `follow_up_questions`
- 发现设定冲突时要进入 `conflicts`
- 用户明确否定的内容不能再次当作建议自动加入

## 八、JSON Schema 数据契约：故事世界

Schema、数据实例和 TypeScript 类型分别承担约束、实际内容和开发期类型检查的职责。独立的 `schemas/common.schema.json`、`schemas/story-world.schema.json`、`schemas/character-profiles.schema.json` 是需要交付的机器可读契约；`story_world.json` 与 `character_profiles.json` 是必须通过契约校验的故事数据实例。文档中的代码块不代表这些文件已经创建。

正式 Schema 统一采用 Draft 2020-12。主 Schema 声明 `$schema`、唯一 `$id`、`title`、`description`、`type`、`properties`、`required`；对象使用 `additionalProperties: false`，数组明确 `items`，枚举明确 `enum`。共享定义通过 `$defs` 和本地注册的 `$ref` 复用，`$id` 是标识符，不要求部署网站或在运行时联网下载 Schema。

每个业务字段的 `description` 解释用途、草稿空值含义、来源/确认语义和后续叙事用途，并提供适当 `examples`。`description`、`default`、`examples` 本身不能代替校验条件，也不能自动补齐必填内容，参见 [JSON Schema 注解说明](https://json-schema.org/understanding-json-schema/reference/annotations)。

使用支持该方言的运行时校验器。如果选用 Ajv，使用 Draft 2020-12 对应实例并配置日期格式校验，不能假定默认实例与 `format` 字段已完成这两件事，参见 [Ajv 方言支持](https://ajv.js.org/json-schema.html) 与 [格式校验](https://ajv.js.org/guide/formats.html)。类型从 Schema 派生或进行有针对性的契约一致性检查；不长期手工维护两套相互漂移的定义。

请实现稳定的 TypeScript 类型、运行时校验和 JSON 序列化逻辑。

### 8.1 共享字段语义

故事世界和角色画像中，大多数具有创作意义的字段都需要记录内容来源和确认状态。建议定义统一的事实包装结构：

```ts
type FactSource =
  | "user_explicit"
  | "user_edited"
  | "ai_inferred"
  | "ai_suggestion";

type FactStatus =
  | "draft"
  | "pending_confirmation"
  | "confirmed"
  | "rejected";

type Fact<T> = {
  value: T;
  source: FactSource;
  status: FactStatus;
  locked: boolean;
  evidence?: string[];
  updated_at: string;
};
```

`story_world.json` 的字段结构示意如下。`{}` 和空时间戳仅为说明占位，不能作为可校验实例交付。开发任务必须生成填全事实元数据和有效时间戳的演示实例。

```json
{
  "schema_version": "1.0.0",
  "document_type": "story_world",
  "story_id": "story_demo",
  "revision": 1,
  "created_at": "",
  "updated_at": "",
  "title": {
    "value": "",
    "source": "ai_suggestion",
    "status": "draft",
    "locked": false,
    "updated_at": ""
  },
  "logline": {},
  "summary": {},
  "genre": {},
  "themes": {},
  "tone": {},
  "setting": {
    "era": {},
    "geography": {},
    "locations": [],
    "society": {},
    "technology_or_power_system": {},
    "world_rules": []
  },
  "organizations": [],
  "core_conflict": {},
  "initial_outline": [],
  "timeline": [],
  "hard_constraints": [],
  "prohibited_content": [],
  "open_questions": [],
  "change_log": []
}
```

字段要求：

- `schema_version` 用于未来升级数据结构
- `story_id` 用于关联角色、消息和后续章节
- `revision` 用于表示故事状态版本
- `title`、`logline`、`summary` 用于描述故事基本方向
- `genre`、`themes`、`tone` 用于表示创作偏好
- `setting` 用于描述故事世界
- `organizations` 用于描述关键组织或阵营
- `core_conflict` 用于描述故事核心矛盾
- `initial_outline` 只保存初步方向，不要假装是完整剧情
- `timeline` 是本层必须交付的世界历史、人物前史与开局时间线
- `hard_constraints` 保存用户明确要求必须遵守的规则
- `prohibited_content` 保存用户不希望出现的内容
- `open_questions` 保存尚未决定但可能影响创作的问题
- `change_log` 保存重要修改来源和时间

数组中的地点、组织、规则和事件也应包含稳定 ID，避免后续更新时只能依赖名称匹配。

### 8.2 JSON Schema 的正式实现要求

请创建 schemas/common.schema.json、schemas/story-world.schema.json 和 schemas/character-profiles.schema.json。

请让 schemas/story-world.schema.json 描述一个完整的故事世界文档。它的顶层必须是 object，additionalProperties 必须为 false，并且 required 至少包含：

- schema_version：数据契约版本，不因普通故事编辑而改变。
- document_type：固定为 story_world，用于区分文档类型。
- story_id：稳定故事 ID，不能因为标题修改而改变。
- revision：从 1 开始递增的正整数，表示故事状态修订版本。
- created_at 和 updated_at：ISO 8601 date-time。
- title：故事名称，使用带来源和状态的文本事实。
- logline：一句话概括故事核心设定和冲突。
- summary：当前共同创作形成的故事方向摘要。
- genre、themes、tone：类型、主题和叙事气质。
- setting：时代、地理、社会、技术或力量体系以及世界规则。
- organizations：重要组织、阵营或群体。
- core_conflict：核心矛盾、对立力量、冲突后果和未解决问题。
- initial_outline：初步故事方向，不代表完整章节大纲。
- timeline：已知或拟定的关键时间线事件。
- hard_constraints：用户要求必须遵守的设定。
- prohibited_content：用户明确不希望出现的内容。
- open_questions：尚未决定但可能影响创作的问题。
- change_log：重要变更、变更主体和受影响 JSON 路径。

请为每一个属性填写 description。描述不能只写“标题”或“字符串”，而要解释该字段在共同创作流程中的业务含义、是否允许为空、来源和状态如何使用，以及它会被后续哪个 Agent 读取。

故事世界字段的语义必须保持如下边界：

| 字段 | 说明 |
| --- | --- |
| schema_version | JSON Schema 数据契约版本；内容修改不改变它，破坏性结构修改才升级主版本。 |
| document_type | 固定值 story_world，表示当前实例是故事世界文档。 |
| story_id | 连接故事世界、角色、对话、章节和导出的稳定标识。 |
| revision | 当前实例的修订号；用户修改后递增，不能用时间戳替代。 |
| title | 故事当前名称，可以处于 draft 或 pending_confirmation。 |
| logline | 故事核心设定和冲突的一句话表达。 |
| summary | 已共同形成的方向摘要，不得伪装成完整故事。 |
| genre、themes、tone | 用户偏好或 AI 建议的类型、主题、风格和氛围。 |
| setting | 故事发生和运行的世界环境。 |
| core_conflict | 推动故事的主要矛盾及其 stakes。 |
| initial_outline | 早期共同创作的故事节点，后续可以修改。 |
| hard_constraints | 用户明确要求必须保留的内容。 |
| prohibited_content | 用户明确要求避免的内容。 |
| open_questions | 仍需要用户决定的问题；高重要性问题不应被默默猜定。 |
| change_log | 保证故事状态可追溯和可解释。 |

setting 至少包含 era、geography、locations、society、technology_or_power_system 和 world_rules。地点、组织和世界规则不能只使用裸字符串，必须具有稳定 ID、字段描述以及来源和状态。initial_outline 中的每个节点至少具有稳定 beat_id、顺序、标题、描述、故事作用、来源、状态和锁定信息。

## 九、JSON Schema 数据契约：角色画像

角色画像同样必须使用正式 JSON Schema，不能只定义一个 JSON 示例。

请创建 schemas/character-profiles.schema.json，并保存具体故事的角色数据实例为 character_profiles.json。两个文件的关系是：

~~~text
character-profiles.schema.json
    校验
character_profiles.json
~~~

角色画像是后续主叙事 Agent 使用的行为依据，不是只用于前端展示的人物小传。每个字段都应该尽量回答一个问题：后续剧情中，Agent 如何根据这个字段判断角色会怎么做、怎么说、和别人如何互动。

`character_profiles.json` 的字段结构示意如下。同样，空对象是说明占位；实际实例必须填全 Schema 要求的字段。

```json
{
  "schema_version": "1.0.0",
  "document_type": "character_profiles",
  "story_id": "story_demo",
  "revision": 1,
  "updated_at": "",
  "characters": [
    {
      "character_id": "character_001",
      "name": {},
      "identity": {},
      "role": {},
      "appearance": {},
      "personality": {},
      "desire": {},
      "fear": {},
      "secret": {},
      "background": {},
      "speech_style": {},
      "behavior_tendencies": {},
      "growth_arc": {},
      "entrance_condition": {},
      "current_state": {},
      "known_information": {},
      "unknown_information": {},
      "relationship_ids": [],
      "hard_constraints": [],
      "open_questions": [],
      "change_log": []
    }
  ],
  "relationships": [],
  "change_log": []
}
```

每个角色至少需要支持：

- 稳定的 `character_id`
- 姓名
- 身份
- 角色定位
- 外貌或可识别特征
- 性格
- 核心欲望
- 核心恐惧
- 个人秘密
- 背景经历
- 说话风格
- 行为倾向
- 成长弧线
- 出场条件
- 当前状态
- 与其他角色的关系
- 用户硬性要求
- 待确认问题
- 变更记录

关系对象的识别示意如下。关系本体仅保存于文档顶层 `relationships`，角色内的 `relationship_ids` 只引用关系 ID；详细字段以 9.2 为准。

```json
{
  "relationship_id": "relationship_001",
  "from_character_id": "character_001",
  "to_character_id": "character_002",
  "type": "ally",
  "description": "两人目前互不完全信任，但拥有共同目标",
  "source": "ai_suggestion",
  "status": "pending_confirmation",
  "locked": false
}
```

不要只把角色写成一段人物小传。角色画像必须能够被后续主叙事 Agent 读取，并用于判断角色在具体场景中的行为是否符合设定。

### 9.1 character-profiles.schema.json 的顶层要求

顶层必须是 object，additionalProperties 必须为 false，并且 required 至少包含：

- schema_version：角色画像数据契约版本。
- document_type：固定为 character_profiles。
- story_id：必须与 story_world.json 中的 story_id 相同。
- revision：角色画像文档的正整数修订号。
- updated_at：最后一次更新的 ISO 8601 date-time。
- characters：角色对象数组。
- relationships：角色关系对象数组。
- change_log：角色画像文档级变更记录。

每个角色对象至少包含以下字段，并且每个具有创作意义的文本字段都要能记录来源、状态、是否锁定和更新时间：

| 字段 | 语义描述 |
| --- | --- |
| character_id | 角色稳定 ID；改名不能改变它。 |
| name | 角色当前使用的姓名或称呼。 |
| identity | 身份、职业、社会位置或自我认同。 |
| role | 角色在故事中的叙事功能、阵营位置或参与方式。 |
| appearance | 外貌、动作习惯或其他可识别特征。 |
| personality | 性格特征；应尽量描述可观察的行为倾向，避免只有空泛形容词。 |
| desire | 角色当前最想得到或实现的目标。 |
| fear | 角色害怕失去、面对或承认的事物。 |
| secret | 角色隐藏的信息，可以处于待确认状态。 |
| background | 与当前行为有关的经历和背景。 |
| speech_style | 词汇、句式、语气和交流习惯。 |
| behavior_tendencies | 角色在压力、冲突和选择中的行为倾向。 |
| growth_arc | 角色可能的成长方向，不得把未来计划写成已经发生的事实。 |
| entrance_condition | 角色何时、为何进入故事。 |
| current_state | 故事起点时角色的心理、关系、资源和处境。 |
| known_information | 角色已经知道的关键信息。 |
| unknown_information | 角色不知道但对剧情有意义的信息。 |
| relationship_ids | 该角色参与的顶层关系 ID。 |
| hard_constraints | 用户要求该角色必须遵守的内容。 |
| open_questions | 该角色尚未决定的问题。 |
| change_log | 该角色的重要修改记录。 |

growth_arc 至少包含 starting_state、pressure_point、possible_direction 和 user_confirmed。user_confirmed 必须是 Boolean，用于区分 AI 推测的成长方向和用户已经认可的成长方向。

### 9.2 角色关系的 schema 和引用完整性

关系对象应放在 character_profiles.json 顶层的 relationships 数组中，避免把同一关系重复保存在两个角色内部后产生不一致。

每个关系至少包含：

- relationship_id：稳定的关系 ID。
- from_character_id：关系起点角色 ID。
- to_character_id：关系终点角色 ID。
- type：关系类型。
- description：关系当前状态的结构化事实。
- current_state：双方当前如何看待或对待彼此。
- possible_direction：关系未来可能如何变化。
- source、status、locked 和 updated_at：关系的来源、确认状态、锁定状态和更新时间。

关系类型建议使用 family、friend、ally、rival、enemy、mentor、romantic、professional、dependent、unknown 和 custom。from_character_id 与 to_character_id 必须引用同一份角色文档中存在的 character_id。

JSON Schema 可以校验字符串格式，但通常不能单独完成跨数组的引用完整性检查。因此还必须在应用层增加关系引用校验：如果关系指向不存在的角色，保存前阻止提交，并在界面中指出具体关系和角色 ID。

### 9.3 共享定义和事实字段的正式要求

Fact<T> 只是 TypeScript 中的概念。JSON Schema 中不能直接使用泛型，必须为文本、文本数组和具体对象分别定义可校验的 schema，例如 factString、factStringArray 和 coreConflictFact。

请在 schemas/common.schema.json 中定义共享的 $defs。至少应包含以下定义：

~~~json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://book-person.local/schemas/common.schema.json",
  "title": "书中人共享数据定义",
  "description": "故事世界和角色画像共同使用的来源、状态、事实和变更记录定义。",
  "$defs": {
    "factSource": {
      "type": "string",
      "enum": [
        "user_explicit",
        "user_edited",
        "ai_inferred",
        "ai_suggestion"
      ],
      "description": "记录当前内容最初由用户明确提出、用户修改、AI 推断还是 AI 主动建议。"
    },
    "factStatus": {
      "type": "string",
      "enum": [
        "draft",
        "pending_confirmation",
        "confirmed",
        "rejected"
      ],
      "description": "记录当前内容在共同创作流程中的确认状态。"
    },
    "stableId": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9_-]{2,63}$",
      "description": "稳定的机器可读 ID。ID 不应因用户修改名称而改变。"
    },
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 格式的时间戳。"
    },
    "factString": {
      "type": "object",
      "additionalProperties": false,
      "required": ["value", "source", "status", "locked", "updated_at"],
      "properties": {
        "value": {
          "type": "string",
          "maxLength": 10000,
          "description": "具体的自然语言内容。草稿阶段可以为空，但正式确认前应由用户检查。"
        },
        "source": {
          "$ref": "#/$defs/factSource"
        },
        "status": {
          "$ref": "#/$defs/factStatus"
        },
        "locked": {
          "type": "boolean",
          "description": "为 true 时，后续 AI 不得在没有用户明确操作的情况下修改该字段。"
        },
        "evidence": {
          "type": "array",
          "uniqueItems": true,
          "items": {
            "type": "string",
            "maxLength": 2000
          },
          "description": "支持该内容的用户原话、对话摘要或变更依据。"
        },
        "updated_at": {
          "$ref": "#/$defs/timestamp"
        }
      },
      "description": "带有来源、确认状态和锁定信息的文本事实。"
    },
    "factStringArray": {
      "type": "object",
      "additionalProperties": false,
      "required": ["value", "source", "status", "locked", "updated_at"],
      "properties": {
        "value": {
          "type": "array",
          "uniqueItems": true,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 500
          },
          "description": "一组具有相同语义类型的文本条目。"
        },
        "source": {
          "$ref": "#/$defs/factSource"
        },
        "status": {
          "$ref": "#/$defs/factStatus"
        },
        "locked": {
          "type": "boolean"
        },
        "evidence": {
          "type": "array",
          "uniqueItems": true,
          "items": {
            "type": "string",
            "maxLength": 2000
          }
        },
        "updated_at": {
          "$ref": "#/$defs/timestamp"
        }
      },
      "description": "带有来源、确认状态和锁定信息的文本数组事实。"
    }
  }
}
~~~

实现时还必须补齐实际被引用的 `constraint`、`openQuestion`、`changeLogEntry`、`location`、`organization`、`relationship` 和 `outlineBeat` 等定义，不能留下未解析的引用或以无限制对象代替。每个业务属性在使用处补充具体 `description`，不能只引用共享的“文本事实”说明。

### 9.4 Schema 校验和实例生成要求

请根据共享定义完成两个主 schema，而不是只把结构复制成普通 JSON：

- story-world.schema.json 使用 common.schema.json 的可解析外部引用，并为故事世界专属对象定义自己的 $defs。
- character-profiles.schema.json 使用同一份共享定义，并为角色、关系和成长弧线定义自己的 $defs。
- 主 schema 的每个属性都必须有字段描述，说明它代表什么、什么时候使用、是否允许为空以及会被哪个后续 Agent 读取。
- 对允许的字段使用 additionalProperties: false，防止模型随意制造无法被前端处理的字段。
- 对未来扩展，如果确实需要保留开放字段，请显式增加 extensions 对象，而不是直接打开整个文档的额外字段。
- 创建至少一份 demo-story-world.json 和一份 demo-character-profiles.json，并在开发阶段通过校验器验证它们。
- 模型生成和用户编辑都必须以 schema 为准，不能只依赖提示词约束。
- 保存前重新校验，导出前再次校验。
- 用户编辑字段后更新对应的 updated_at、revision 和 change_log。
- 普通内容修改不改变 schema_version；只有数据契约发生破坏性变化时才升级主版本。

如果模型返回不符合 schema 的 JSON，应用应优先尝试一次结构化修复；修复失败后保留原始用户输入和上一次有效状态，并在界面中显示具体字段错误。

### 9.5 确认与业务语义

- `source` 记录当前值的形成方式，`status` 记录是否被接受，`locked` 是独立布尔值。“已锁定”属于 UI 派生标签，不增加另一个事实状态。用户接受 AI 建议时保留原来源；用户改写内容时使用 `user_edited`，原来源由变更记录保留。
- 普通 AI 建议进入待确认草案；用户已确认内容不能被无提示替换，锁定内容需要用户明确解除锁定后才允许改写。保存、导出、重试均不能自动将建议提升为已确认。
- 世界、角色和关系的结构校验成功不等于故事逻辑正确。跨文档 `story_id` 一致、ID 唯一、关系引用有效、锁定字段不被覆盖、基础修订号未过期，须在应用层检查。
- 草稿允许尚未决定的字段为空，但不得用 `{}` 绕过元数据。`confirmed` 内容不能是无意义空值；确认时只提升用户本次选中的有效字段，未解决的非关键问题可保留，关键冲突必须展示并解决。
- `growth_arc.user_confirmed` 是整体成长方向的确认标记，必须由其组成事实的确认状态派生并检查一致性，不得让模型另行猜测。未来发展方向仍是计划，不是已发生的剧情。
- 同一数组事实内的条目共享来源和状态；若条目需要独立编辑或确认，将其拆为独立事实对象并明确 Schema，避免更改一项便重写其他条目的来源。
- `evidence` 中的用户原话需可追溯到消息；摘要明确标为摘要，不冒充原话。识别置信度仅是模型判断，不能单独授予确认状态。
- NPC 数量由输入和故事需要决定。用户未描述人物时主动提出建议，等待确认，不套用固定人数。

## 十、AI Agent 与前端之间的接口边界

当前可以先使用 mock provider，但必须抽象出真实模型可替换的接口。

建议至少定义：

```ts
type StoryInput = {
  storyId: string;
  message: string;
  currentWorld?: StoryWorld;
  currentCharacters?: CharacterProfiles;
};

type RecognitionResult = {
  intent: string;
  summary: string;
  extracted_items: ExtractedItem[];
  hard_constraints: string[];
  ambiguities: string[];
  conflicts: string[];
  follow_up_questions: string[];
};

type StoryDraftResult = {
  recognition: RecognitionResult;
  world: StoryWorld;
  characters: CharacterProfiles;
  assistant_message: string;
};

interface StoryCreationProvider {
  recognize(input: StoryInput): Promise<RecognitionResult>;
  generateDraft(input: StoryInput): Promise<StoryDraftResult>;
  updateDraft(input: StoryInput): Promise<StoryDraftResult>;
}
```

要求：

- UI 不应该直接依赖某一家模型供应商的 SDK
- API Key 不能出现在浏览器端
- 真实模型调用应通过服务端或安全的 API route
- mock 模式必须明确标注为演示模式
- mock 数据必须符合真实 JSON 数据契约
- 后续替换真实模型时，不应重写整个前端
- JSON 解析失败时要显示可恢复错误，不要让页面白屏

## 十一、状态管理要求

第一层至少需要维护以下状态：

- `idle`：尚未开始
- `inputting`：用户正在输入
- `recognizing`：正在识别自然语言
- `clarifying`：等待用户回答关键问题
- `generating`：正在生成草案
- `draft_ready`：草案已经生成
- `editing`：用户正在编辑
- `updating`：AI 正在根据用户反馈更新
- `conflict_detected`：存在设定冲突
- `confirmable`：可以确认当前设定
- `confirmed`：用户已经确认基础设定
- `error`：发生可恢复错误

状态变化要能够被用户理解，不能只存在于代码内部。

需要处理以下异常：

- 用户输入为空
- AI 返回空结果
- AI 返回非法 JSON
- 生成过程失败
- 用户在生成过程中继续输入
- 某个字段缺少但不影响继续
- 已锁定字段被 AI 尝试修改
- 两个设定互相冲突
- 本地保存失败

保留用户原始输入，即使 AI 处理失败，也不能丢失用户内容。

## 十二、持久化策略

项目 `memory/` 保存开发过程记忆；产品中的故事数据和用户对话属于运行时数据。二者分开存储，真实用户的故事、密钥与原始私密对话不写入开发记忆库。

如果当前项目还没有后端，第一层可以使用 localStorage 或项目已有的本地状态方案保存 MVP 数据。

至少保存：

- 当前故事世界
- 当前角色画像
- 用户原始输入
- 对话记录摘要
- 当前 revision
- 最近一次状态
- 最近一次更新时间

代码中要将持久化逻辑独立出来，未来可以替换为 SQLite、Postgres 或其他服务端存储。

不要在第一层为了使用数据库而引入复杂账号、权限和部署系统。

### 更新幂等与恢复

以下规则为 F-07 的实现要求，实现证据由开发进度记录，不能仅因写入本文就视为已完成：

- 每次用户提交或局部修改分配稳定 `operation_id`，重试沿用同一个 ID；新创作意图使用新 ID。记录对应 `base_revision` 和请求内容标识。
- 同一操作已经提交成功时返回原结果，不重复新增角色、关系、消息或修订；同 ID 携带不同内容应返回冲突。
- 更新结果先进入候选草案，经过 Schema 与业务检查后再提交。旧请求返回时如果基础版本已变化，不得覆盖用户的新修改。
- 世界和角色作为同一故事快照保存，使用共同快照 ID 或一个包裹对象保证对应版本一起恢复。保留上一份有效快照；变更摘要不能替代可恢复的数据。
- 本地存储失败时保留内存中的用户输入和候选内容，显示保存失败，允许重试或导出；不能显示“已保存”。刷新恢复后不根据一个旧的 `generating` 状态自动重复模型调用。
- 应用与日志一并保存操作完成记录，使恢复后仍能判断已提交操作。模型调用可能产生重复成本的边界需如实记录，不能声称本地操作幂等已经保证外部调用只执行一次。

## 十三、技术实现要求

优先遵循项目中的前端技术栈手册：

- Next.js App Router
- TypeScript strict
- React
- 使用项目已有的 UI、样式和状态依赖
- 组件职责清楚
- 服务端调用和客户端展示分离
- 类型和运行时校验同时存在
- 不在组件中堆积所有业务逻辑

如果项目当前使用其他明确技术栈，不要为了套用上述名称而强行重写项目。先识别现有技术栈，再采用等价实现。

推荐的职责划分：

```text
app/                 页面和路由
components/          输入区、对话区、状态卡片、角色卡片
features/story/      故事创建业务逻辑
lib/ai/              AI provider 接口和 mock provider
lib/story/           故事状态更新、版本和持久化
types/               TypeScript 类型
schemas/             正式 JSON Schema 与共享定义
data/                mock 故事和演示数据
```

这只是建议结构。已有项目结构优先，不要为了目录形式而大规模重构。

## 十四、开发实施顺序

以下是交付依赖顺序；任务状态和证据只在 `memory/CURRENT.md` 维护。实施先按项目入口恢复，再读取与本任务有关的源码和文档；没有对应文件时从实际空白工程出发，不假定已存在 `package.json`。

| 任务 ID | 交付内容 | 依赖与边界 |
| --- | --- | --- |
| L1-01 | 最小工程入口；共享/故事世界/角色画像 Schema；类型与校验器；有效示例 | 先明确结构再供 UI 与 Provider 共用；示意空对象不能充当样例 |
| L1-02 | 对话、世界、角色、识别、保存状态的工作台；纸张色与中文字体；响应式和基础键盘交互 | 使用 L1-01 的有效演示数据，首屏即体现简约方向 |
| L1-03 | 输入、理解反馈、澄清、方案选择、草案和局部更新的多轮交互 | 演示模式明确标记；单个角色和字段重生成保留其他确认内容 |
| L1-04 | 待确认统计、用户确认/拒绝/锁定、冲突、版本、幂等、持久化、恢复、JSON 查看/导出 | Schema 和语义检查通过才提交，保存世界与角色的配套快照 |
| L1-05 | 真实 Provider 接入、结构化返回、可恢复错误与状态事件 | 先明确供应商、模型和调用预算；真实能力与演示分开验证 |
| L1-06 | 关键流程与失败路径验收、视觉细节、实际启动和交付说明 | 有针对性地检查首期功能，不扩大为完整小说平台 |

L1-02 即落实 UI 的留白、信息层级和响应式方向，L1-06 只作体验收尾。后续层的未实现按钮不能充当本层交付。

## 十五、实现中的禁止事项

不要做以下事情：

- 不要把产品实现成只有一个聊天框
- 不要让 AI 直接生成一篇长故事作为第一步结果
- 不要把世界观和角色只保存为长文本
- 不要把未经确认的 AI 内容标记为用户设定
- 不要覆盖用户已经锁定的内容
- 不要在浏览器端暴露模型 API Key
- 不要强行接入未经项目确认的外部服务
- 不要为了视觉效果加入大量无意义动画
- 不要使用默认紫色渐变 AI 仪表盘风格
- 不要一次性实现章节归档、长期记忆和复杂数据库
- 不要生成无法被后续 Agent 使用的临时 JSON
- 不要在没有说明的情况下使用虚假的“AI 正在思考”状态
- 不要吞掉错误或让错误导致页面白屏

## 十六、验收标准

完成后，第一层至少应满足以下标准：

### 产品流程

- 用户可以直接输入一段自然语言故事想法
- 用户可以提交空白以外的输入
- 页面会展示 AI 理解反馈
- 页面会展示识别出的故事元素
- AI 能够提出必要的澄清问题
- 用户可以继续补充和修正
- 页面可以生成故事世界草案
- 页面可以生成与用户输入及故事需要相符的动态 NPC 草案
- 用户可以编辑故事世界和角色画像
- 用户可以删除、拒绝或重新生成内容
- 用户可以锁定重要设定
- 用户可以确认当前设定

### 数据结构

- `story_world.json` 字段稳定且可序列化
- `character_profiles.json` 字段稳定且可序列化
- 所有主要实体具有稳定 ID
- 用户设定和 AI 建议可以区分
- 草稿、待确认、已确认和已拒绝状态可以区分
- JSON 可以被后续 Agent 读取
- JSON 解析失败时有错误提示和恢复路径

### UI 和体验

- 页面不是普通后台管理风格
- UI 简洁、有文学感并且可读
- 桌面端和移动端都能使用
- AI 工作状态清楚
- 用户不会丢失原始输入
- 用户知道哪些内容需要确认
- 用户可以理解当前故事已经进行到哪一步
- 操作按钮文案明确
- 颜色和动效不会干扰阅读和创作

### 工程质量

- 类型定义清晰
- 业务逻辑没有全部堆在页面组件中
- mock provider 与真实 provider 有清晰边界
- API Key 不出现在客户端
- 持久化逻辑可以被未来后端替换
- 主要状态和错误路径已经覆盖
- 项目有启动说明

## 十七、开发交付与进度维护

实施前从 `AGENTS.md` 和 `memory/CURRENT.md` 恢复上下文。完成一个有意义的开发单元后，在 `memory/HISTORY.md` 记录本次操作和检查证据，再更新唯一进度文件 `memory/CURRENT.md`。只有需求或接口决定变化时才同步更新功能规格、决策和索引。

接续同一任务应沿用既有任务 ID 和操作 ID；读取或重复接续不产生新的完成记录。不要复制本节格式建立另一个 handoff、状态表或日志目录。

完成每个主要阶段后，请用以下结构汇报：

```text
本阶段目标：

已完成：

涉及文件：

当前可用流程：

仍使用 mock 的部分：

未完成但属于后续阶段的部分：

发现的问题或需要我决定的事项：
```

如果遇到真正会改变产品方向的决策，例如模型供应商、是否需要账号系统、是否支持图片输入，不要擅自扩大范围。先指出影响，再给出一到两个清晰选项。

## 十八、最终交付目标

请最终交付一个可以运行的第一层产品原型，而不是只提交设计说明或静态页面。

用户应该能够完成以下完整体验：

```text
打开“书中人”
    ↓
输入一个模糊的故事想法
    ↓
看到 AI 对想法的理解
    ↓
看到识别出的故事元素
    ↓
回答或跳过部分澄清问题
    ↓
看到故事世界草案和角色画像草案
    ↓
修改、选择、拒绝和锁定内容
    ↓
确认基础设定
    ↓
保存并查看 story_world.json 和 character_profiles.json
    ↓
准备进入下一阶段的剧情共同创作
```

请记住：第一层的价值不在于一次生成多少文字，而在于是否真正建立了一个让用户和 AI 能够继续共同创作的故事基础。

---

## 十九、验收场景索引

这些场景由原补充提示词整理而来。它们规定预期行为；实际执行结果、日期、模式和证据进入 HISTORY，再由 CURRENT 更新任务状态。

| 场景 ID | 操作或条件 | 应观察到的结果 | 关联功能 |
| --- | --- | --- | --- |
| A-01 | 用户输入一段模糊故事想法 | 先反馈理解与识别条目；保留原输入；不直接输出整部小说 | F-01/F-02 |
| A-02 | 用户补充或反驳 AI 理解 | 对话、识别与结构化状态同步；必要问题可继续回答，非关键问题可暂存 | F-01/F-02 |
| A-03 | 用户要两种故事方向 | 展示差异并接受自由选择；AI 建议来源和待确认状态可见 | F-03/F-05 |
| A-04 | “改为城市维护员，但保留失忆” | 只更新有关身份内容，其他确认事实和角色 ID 保持一致 | F-04/F-07 |
| A-05 | 拒绝建议、锁定关键设定后再次生成 | 被拒建议不自动复活，锁定内容不被覆盖；冲突可读且可处理 | F-05 |
| A-06 | 非法 JSON、缺少必填字段或关系引用不存在 | 指出具体路径/ID，原输入和上次有效快照保留；不显示保存成功 | F-06/F-10 |
| A-07 | 点击确认当前设定 | 只确认用户选定的有效内容；保留来源、待定问题和可追溯变更 | F-05/F-08 |
| A-08 | 同操作重试或旧模型请求晚返回 | 无重复角色/修订，旧结果不能覆盖新编辑 | F-07 |
| A-09 | 保存、刷新、查看及导出两个实例 | 恢复同一故事快照，世界/角色 ID 与版本对应，校验后导出 | F-06/F-08 |
| A-10 | 桌面与移动设备操作输入、编辑、确认 | 简约布局可读、按钮可达、键盘焦点清晰，状态不只用颜色表达 | F-09 |
| A-11 | 演示模式与真实模型模式 | 界面说明运行模式，真实阶段事件不伪装为固定倒计时；分别记录验收证据 | F-10 |
| A-12 | 第一层确认结束 | 明确提示基础设定已保存；连续章节等后续能力不被误报为可用 | F-01/F-08 |

验收检查按实际改动选择，不要求每轮全部重跑；涉及共享不变量时覆盖有关失败场景。未运行场景明确记录 NOT_RUN。


## 实施补充：第一层公共契约与模型传输边界（2026-09-12）

本节记录当前获批计划在工程中的落实口径。实际完成状态和剩余额度仅以 memory/CURRENT.md 为准，不在功能规格复制进度。

第一层的可见工作区为世界框架、NPC 画像、世界时间线。世界历史、相关人物前史和故事开局时点是首轮产出，不是未来预留。首轮西方魔幻与东方武侠是可修改的风格引导，任何样例的人物数都不是生产规则。用户明确的人物、身份、关系、控制属性和数量优先保留；没有人物时提出待确认候选，不能凑固定阵容。

正式数据实例继续为 story_world.json 和 character_profiles.json。timeline 仅存在世界实例中，NPC 使用事件 ID 引用。三个公共 JSON Schema 及其生成类型是实际字段契约；文档中的早期示意不覆盖运行时 Schema。结构、版本、引用、锁定和历史一致性必须在候选提交之前检查。

模型调用内部使用从公共 Schema 派生的精简传输结构。模型负责业务值和来源依据，不负责授予确认、锁定权限或写系统修订号。应用补齐系统元信息后仍执行完整公开 Schema 与应用语义检查。精简传输不得删掉用户人物、历史事件或画像业务字段来迎合模型输出。

世界生成先反馈理解结果、澄清问题与世界/时间线候选；NPC 模块读取用户人物线索及已经接受的世界。NPC 的新增历史只是时间线修改建议，必须经过用户可见的候选接受流程。局部修改依据目标只调用受影响的 Agent；候选不能覆盖更晚的用户编辑。

实现是本地单进程服务和浏览器配套快照，不扩张为完整写作平台。服务端请求账本跨重启保存累计真实尝试，最多 10 次，结构修复最多一次并计数。失败不自动换模型、不自动重发、不用合成故事顶替。真实业务失败不能因离线测试或最小探针通过而标为验收完成。

## FR-L1-COCREATE-01：同一故事上下文的字段级建议

每个可编辑的创作 Fact，包括主题、时代、力量体系、世界规则、NPC 欲望、背景、说话方式、人物关系描述、时间线事件名称/时间描述/内容，均提供独立的 AI 建议入口。用户可填写本次局部要求；它不覆盖共同故事想法。

统一请求保持 operation_id 和 base_revision，并新增 context={story_idea,user_notes} 与 field={document,path}。context.story_idea 始终来自当前唯一故事想法，request.input 表达本次任务或补充要求；world/characters 提供当前设定依据。模型可以共享同一服务与模型名，但字段任务提示根据职责区分。

字段输出严格为 {fact:{value,source,evidence},explanation,warnings}。value 类型和字段含义从公共三份 Schema 解析，不能把数组字段当文本，也不能写入额外系统权限。应用恢复 Fact 元数据后仍检查完整配套数据。模型输出只是候选，用户采用后加入草案；来源标识不因用户接受而伪装成用户原话。

## FR-L1-COCREATE-02：可解释的候选采用与安全合并

候选记录生成时的世界、人物、时间线建议、故事想法及场景基线。修订变化时按稳定实体 ID 三方比较，保留无关的用户修改，只合并未冲突的 AI 改动。相同字段出现不同修改、生成后锁定、用户删除实体、共同故事想法改变时提供具体路径和解释，不静默覆盖。无实际变化的编辑不推进版本。

历史候选缺少可靠基线时不猜测覆盖权，过期则明确提示保留原稿后重新生成；不能只显示笼统“版本不一致或校验问题”。采用前仍进行 Schema、引用、锁定和历史一致性检查。没有冲突时允许安全采用，不为了消除提示而关闭校验。

## FR-L1-COCREATE-03：世界采用后的 NPC 接续

默认开启“采用世界后自动生成 NPC”，用户可关闭。流程为世界和时间线候选生成、用户采用、NPC Agent 读取已采用世界并生成动态人物候选、用户再采用。两次调用不是两次自动确认。

识别中的关键问题提供直接回答入口；存在未回答关键问题时暂停 NPC 接续但保留世界。预算不足、请求失败和旧响应冲突均不回滚已采用的世界，也不自动反复扣费。用户仍可手动生成 NPC。整个过程共用同一故事想法和后续明确补充。
