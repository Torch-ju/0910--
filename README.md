# 书中人

与 AI 共同建立故事的世界框架、NPC 和初始世界时间线，再把用户确认的设定交给未来主叙事 Agent。

当前交付是第一层初始化工作台，不是连续写作系统。唯一当前进度见 [memory/CURRENT.md](memory/CURRENT.md)；本文负责入口、运行和结构说明，不另建进度台账。

## 运行

在本目录使用现有 Node.js 环境：

```powershell
npm install
npm run dev
```

已有依赖时直接运行第二条即可。开发和生产服务均应只在本机使用，不涉及对外发布。默认地址为 http://127.0.0.1:3000。

打开方式：在项目根目录执行 npm run dev，然后用浏览器访问 http://127.0.0.1:3000。不要双击某个 HTML 文件；这是 Next.js 应用，页面入口是 src/app/page.tsx，它会加载完整工作台。修改页面布局时主要查看 src/features/story/ui/StoryWorkbenchShell.tsx，交互和本地保存逻辑在 src/features/story/use-workbench.ts。

生产预览：

```powershell
npm run build
npm run start
```

构建前停止占用同一目录的开发服务，避免同时写入 .next。

## 模型配置

服务端从项目本地 .env.local 读取配置。密钥不得放入前端、NEXT_PUBLIC_ 变量、文档、截图或版本库。

| 变量 | 含义 |
| --- | --- |
| LLM_BASE_URL | OpenAI 兼容服务根地址；本轮使用 https://api.openai-next.com |
| LLM_MODEL | 本轮用户确认 doubao-seed-2-0-pro-260215 |
| LLM_API_KEY | 仅在本地环境文件中配置，不在对话和文档中重复 |
| LLM_REQUEST_LIMIT | 已移除应用层额度上限；服务商自身配额仍可能限制请求 |
| LLM_TIMEOUT_MS | 可配置请求超时，默认 180000 毫秒 |

运行时累计计数和请求回执保存在 runtime/model-requests.json；重启不会清零。该文件和本地密钥均不应提交。接口状态可从 /api/story/status 查看，不返回密钥。

结构错误最多修复一次。网络失败、超时和结果不明不自动重试；界面的“重新发起”会确认是否使用新操作 ID。应用不再因本地累计次数阻止请求，实际可用额度以模型服务商和密钥配额为准。

真实模型、离线测试和浏览器检查分别记录，不能把合成样例或连通性探针视为完整真实链路成功。具体回执和当前结果只以 CURRENT 与运行账本为准；运行账本继续记录累计请求次数，不作为应用层硬上限。

AI 自动推断：提交作者想法后，框架 Agent 会结合主题、故事风格和已有世界状态补全世界规则、冲突、地点、组织、历史与开局；采用世界候选后，NPC Agent 会结合完整世界状态自动推断角色阵容、动机、关系、秘密、说话方式、当前状态和成长方向。所有自动补全均以 AI 推断/AI 建议标记，仍需作者编辑、接受或拒绝。

## 使用流程

1. 选择西方魔幻或东方武侠，输入自己的故事方向与限制。
2. 生成世界框架，查看理解反馈、澄清问题及世界历史和开局时间线。
3. 接受世界候选后默认自动生成 NPC 候选；可关闭“采用世界后自动生成 NPC”并改为手动生成。人物数量来自输入和故事需要，不固定为三人，也不限制为 2 至 5 人。关键问题未回答时保留世界并暂停接续。
4. 在世界、NPC、时间线三个工作区修改内容。字段中的“AI建议”可展开局部要求，点击“请求建议”生成该字段候选；比较前后内容后接受或拒绝，不会重写全部世界或人物。
5. 必要时增加、删除或合并人物；用户控制的角色与 NPC 分开标识。
6. 确认当前设定后保存或导出。可锁定个别事实；锁定与确认不是同一个状态。

用户原话、用户编辑、AI 推断和 AI 建议分别保留来源。没有确认的建议不会伪装成正式事实。未来剧情方向仅在初始大纲中表达，不作为已发生的历史事件写入时间线。

共同故事想法始终保存在同一个输入区。局部要求不会取代它；服务端分别接收 context.story_idea、用户补充和本次指令，使用字段专属任务提示及从公共 Schema 派生的输出约束。系统 ID、修订与锁定权限不交给模型。

候选生成后仍可编辑原稿。未冲突的后续修改会安全保留；同字段修改、生成后锁定、已删除实体或共同故事想法变化会显示具体冲突路径。旧候选如果过期且没有完整比对基线，不会冒险覆盖，需保留原稿后重新生成。这个保护不能通过关闭校验来绕过。

浏览器保留当前和上一份有效快照，世界与角色共用故事 ID、修订号。刷新会恢复输入和草稿，不自动重发生成请求。保存失败会提示并保留内存中的编辑。不同浏览器或不同地址的本地存储彼此独立，尚无账号与云同步。

## 数据契约

| 文件 | 职责 |
| --- | --- |
| schemas/common.schema.json | Fact、来源、确认状态、ID、问题等共享定义 |
| schemas/story-world.schema.json | 世界框架和唯一 timeline，含事件子定义 |
| schemas/character-profiles.schema.json | 动态人物、关系和历史事件 ID 引用 |
| src/generated/story-world.ts | 由 Schema 生成的世界类型，不手工修改 |
| src/generated/character-profiles.ts | 由 Schema 生成的人物类型，不手工修改 |

公共 JSON Schema 使用 Draft 2020-12。应用层补充引用、版本、锁定、历史先后及关系完整性检查。

导出仍是 story_world.json 与 character_profiles.json 两份配套实例。NPC 仅引用世界中的事件 ID，不另存一份权威时间线。

模型内部 wire contract 由公共 Schema 投影，Fact 仅让模型生成 value、source、evidence；时间戳、修订号、锁定与确认权限由应用恢复和维护。内部投影不会缩减正式数据契约，也不是第二套手工维护的公开 Schema。

examples/ 下为明确标记的合成资料，用于开发与校验，不是模型真实产出，更不是默认人物阵容。

## 工程结构

| 路径 | 内容 |
| --- | --- |
| src/app | Next.js App Router 页面与 API 路由 |
| src/features/story/ui | 暖纸色、墨色、克制强调色的响应式共创工作台 |
| src/features/story/use-workbench.ts | 页面交互、候选接受、保存与恢复控制 |
| src/lib/story | 共享契约、工厂、状态、一致性校验与快照存储 |
| src/lib/ai | 故事框架 Agent、NPC Agent、内部投影和服务端模型客户端 |
| src/lib/api | 浏览器调用服务端的客户端 |
| src/data/presets.ts | 两个可修改的场景风格入口 |
| schemas | 三个公共 JSON Schema |
| scripts | 类型生成、实例校验和浏览器验收脚本 |
| memory | 唯一开发记忆库 |

技术栈为 Next.js App Router、React、TypeScript strict、Tailwind CSS、Context/reducer 和 Ajv 2020-12 校验。第一层不引入复杂多进程 Agent、数据库、账号、章节生成、长期记忆压缩或云部署。

## 检查命令

```powershell
npm run lint
npm run typecheck
npm test
npm run schemas:check
node scripts/validate-json.mjs
npm run build
```

Schema 修改后通过 npm run schemas:generate 更新生成类型，再执行相关检查。不要手改 src/generated 中的文件。

浏览器验收使用独立的 Playwright CLI 会话和合成数据，不消耗模型额度：

```powershell
npx --yes --package @playwright/cli playwright-cli -s=shuzhongren-check open http://127.0.0.1:3000 --browser chrome
npx --yes --package @playwright/cli playwright-cli -s=shuzhongren-check run-code --filename scripts/browser-check.playwright
npx --yes --package @playwright/cli playwright-cli -s=shuzhongren-check run-code --filename scripts/browser-finish.playwright
```

这些脚本会改写该独立会话的合成故事，不能在用户真实创作会话中执行。截图和下载证据位于 output/playwright。现有 npm run test:e2e 尚未接上这些 CLI 脚本，不应作为已通过的验收入口。

## 文档与接续开发

- AGENTS.md：唯一项目 Agent 约定，补充全局规则，不另建 agent.md 或平行规则文件。
- ARCHITECTURE (1).md：完整产品原始架构；不因第一层实现而改变完整产品本意。
- docs/PRODUCT_SPEC.md：第一层功能规格与执行边界。
- memory/INDEX.md：开发记忆导航与权威路径。
- memory/CURRENT.md：唯一当前进度、证据、预算与下一项工作。
- memory/DECISIONS.md：重要决定及理由。
- memory/HISTORY.md：实际操作与检查历史，追加而不抹去失败。
- 第一层产品开发完整提示词.md：历史入口重定向，不再独立维护另一份规格。

接续开发先读 AGENTS、CURRENT 和 INDEX，再按任务定位规格、Schema 与代码。不能因旧任务写着进行中就推断进程仍在运行，也不能把测试通过等同于真实模型流程通过。
