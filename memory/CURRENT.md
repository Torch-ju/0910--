# CURRENT：唯一当前开发进度

## 当前工作单元

- operation_id：OP-20260912-004。
- 目标：简化首屏、补充清空数据入口、记录本地打开方式并发布个人 Git 分支。
- 操作状态：CHECKED；界面与本地清空已验证，真实 NPC 链路仍未通过，不标记整体 DONE。
- 用户授权：当前对话明确要求实施上述修正与扩展，沿用原 L1 计划的检查要求。
- 权威规格：docs/PRODUCT_SPEC.md；新增功能 ID：FR-L1-COCREATE-01/02/03。
- 本轮影响：共享接口、字段 Schema 投影、候选三方合并、状态控制、UI 字段建议、首屏布局、清空数据与自动保存竞态、启动说明、Git 分支发布。
- 主 Agent 与两个 Worker 编辑区互斥；只有主 Agent 修改此记忆库。

## 核心语义

- 同一故事的总想法仅使用 snapshot.input；局部要求在 request.input，二者不能混同。
- 每次新请求携带 context.story_idea 与 context.user_notes，并读取现有世界、人物和时间线。
- 字段提示根据目标字段职责区分；输出 Schema 从现有三个公开 JSON Schema 投影，不另建公开 Schema 副本。
- 只有创作 Fact 可请求 AI 建议；ID、版本、锁定和确认权限不能由模型生成。
- 候选保留生成基线；按稳定实体 ID 合并不冲突的后续编辑。同字段冲突、锁定或共同故事想法变化必须明确展示。
- 无实际改变的编辑不增加修订号。不能仅因修订号变化就把所有候选一概拒绝。
- 用户采用世界后默认自动请求 NPC 候选；NPC 候选仍需用户采用，不自动确认。关键澄清、预算不足或生成失败保留已采用的世界。
- 人物数量不固定；动态线索、无名人物、用户控制属性及移除/合并决定继续适用。
- timeline 仍只在世界实例中维护；NPC 引用事件 ID，新增历史仍是待确认建议。

## 高层任务

| 任务 | 状态 | 当前范围 |
| --- | --- | --- |
| L1-01 共同基础 | DONE | 字段契约、共同上下文和共享类型已落盘；相关测试、类型与构建通过 |
| L1-02 共创工作台 | IN_PROGRESS | 字段建议、冲突路径、直接回答和关系编辑已接通；首屏已简化、清空数据已接通；批量浏览器脚本环境问题待修 |
| L1-03 初始化 Agent | IN_PROGRESS | 严格识别 Schema、精确修复提示与动态人物覆盖已实现；真实 NPC 响应尚未通过业务校验 |
| L1-04 状态与一致性 | IN_PROGRESS | 三方合并和自动 NPC 已实现并离线通过；真实字段保留后续编辑与恢复 PASS；世界阻塞问题检查缺口待修 |
| L1-05 模型适配 | IN_PROGRESS | 字段 endpoint 已真实通过；应用层请求次数不再硬限制，原始 Schema 错误保留问题仍待修 |
| L1-06 集成验收 | BLOCKED | 完整世界/NPC真实闭环未通过；本轮未发起新的真实请求 |

## 已有证据与预算

- 上一工作单元：51 项测试、Lint、TypeScript、Schema 类型检查、生产构建及合成浏览器四宽度流程通过。这是历史基线，不替代本轮检查。
- 本轮主 Agent 新增的候选/字段 Schema/controller 12 项测试已 PASS。
- 本轮集中检查：npm test 为 6 文件 / 75 项 PASS；新增首屏/清空数据回归覆盖 2 项。
- 本轮生产代码 Lint、TypeScript 和 npm run build 均 PASS；构建包含 /api/story/field；Git 分支 cachmeiss7 已推送。
- 新生产 UI 的 390/768/1280/1440px 均无横向溢出。
- 第 9 次真实字段请求：主题候选通过校验；生成后修改另一个标题，候选仍可采用且保留标题；保存刷新恢复 PASS，公共故事想法保持不变，主题来源仍为 ai_suggestion / pending_confirmation。
- 新合成批量浏览器脚本 browser-cocreation.playwright：FAIL，Playwright CLI 执行环境缺少全局 URL，尚未完成整条批量流程。不是应用已失败的证明，也不能写成浏览器流程 PASS。
- 真实回放 NPC：用户采用既有成功世界候选后自动触发请求，已验证自动触发；结果校验未过，不代表 NPC 产出可用。
- 模型：doubao-seed-2-0-pro-260215；兼容服务 https://api.openai-next.com；密钥仅本地 .env.local。
- 历史账本曾记录 used=10 / limit=10；本轮已取消应用层次数硬限制，账本继续保留历史计数，不重置历史数据。
- 第 8 次：修正后的独立西方魔幻世界请求出现网络不明错误，未自动重试。
- 第 9 次：独立真实主题字段请求成功并通过采用、无关编辑保留与刷新恢复。
- 第 10 次：基于先前成功世界结果的独立回放，采用世界后自动请求一名“无名引路人” NPC；识别线索是明确测试夹具，不是新识别成功证据。
- 第 10 次操作 op_7f471848e6ac4890891929bae8075c12，上游 HTTP 200，67763ms，promptTokens=4333，completionTokens=2985；内容校验未通过，拟进行的修复被预算上限拒绝，未产生第 11 次模型调用。
- 最终 receipt.failure 只有 request_budget_exhausted，原始校验错误未保留完整，不能推测具体缺字段或以 HTTP 200 当成 NPC 生成成功。
- 回执第 6 次已包含世界和 recognition 结果，第 7 次已包含世界局部修改结果。因此不能继续说后台从未成功生成世界。
- 前五次包含两次网络不明、小文本探针，以及一次世界生成加一次修复失败，历史失败仍保留。
- 原 10 次上限不变，修复与失败都计数；主 Agent 独占本轮真实联调，Worker 不调用模型。

## 服务与恢复

- 当前本地开发预览为 http://127.0.0.1:3000，启动 exec 会话 93837，已用 HTTP 200 验证；运行状态仍以实际进程为准。
- 新构建已启动；用户已有浏览器页需要先保存再刷新，不自动刷新或清空其会话。AI 建议入口不再因本地累计次数禁用，手动编辑与已有数据仍保留。
- 浏览器保存当前及上一份配套快照。没有比对基线且过期的历史候选不能冒险自动合并，提示保留原稿后重新生成。
- 不创建新对话、不对外部署、不清理用户数据、不重置调用预算。

## 下一项具体动作

1. 本轮界面和本地清空已完成；启动本地预览时在项目根目录执行 npm run dev，浏览器访问 http://127.0.0.1:3000。
2. 真实联调仍需遵守服务商自身配额与计费边界；应用层不再设置本地请求次数上限。
3. 若继续 L1-06，先离线修复 Schema 错误原始诊断保留和 NPC 自动接续的 world.open_questions 阻塞检查，再重新安排真实调用。
4. 合成批量浏览器脚本的 URL 环境适配问题仍待修；本轮 75 项单测、Lint、TypeScript 和构建通过不替代该脚本验收。

## 证据入口

- src/lib/story/co-creation.test.ts、src/features/story/use-workbench.test.ts：候选三方合并、字段 Schema、共同上下文和自动 NPC 离线测试。
- src/features/story/ui/FieldAssistant.test.tsx：实际按钮、局部输入及锁定/忙碌/候选/额度禁用的 5 项测试。
- src/lib/ai/agents.test.ts：严格 recognition、单字段输出、共同上下文人数和控制属性，29 项 PASS。
- scripts/browser-real-field.playwright、scripts/browser-adopt-real-field.playwright：本轮真实字段发起与安全采用步骤。
- output/playwright/recorded-npc-replay.playwright：独立记录回放，仅复用先前模型世界与显式测试人物线索，不触碰用户创作会话。
- output/playwright/real-field-adopted.png、viewport-390/768/1280/1440.png：本轮截图。
- runtime/model-requests.json：真实请求回执与总调用上限，禁止清空。



