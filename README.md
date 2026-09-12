# 书中人

与 AI 共同建立故事世界、人物与初始时间线，并由服务端主 Agent 串联角色演绎、旁白、小说转写、人物记忆、摘要和章节归档。

界面包含故事设定、连续写作、人物记忆、章节与作品列表。主 Agent 在本机服务端执行任务，页面查询实际步骤并支持刷新恢复。唯一当前进度见 [memory/CURRENT.md](memory/CURRENT.md)；本文负责入口、运行和结构说明，不另建进度台账。

## 运行

在本目录使用现有 Node.js 环境：

```powershell
npm ci
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
| LLM_MODEL | 使用 .env.local 中配置的文本模型名称 |
| LLM_API_KEY | 仅在本地环境文件中配置，不在对话和文档中重复 |
| LLM_REQUEST_LIMIT | 已移除应用层额度上限；服务商自身配额仍可能限制请求 |
| LLM_TIMEOUT_MS | 可配置请求超时，默认 180000 毫秒 |

运行时累计计数和请求回执保存在 runtime/model-requests.json；重启不会清零。该文件和本地密钥均不应提交。接口状态可从 /api/story/status 查看，不返回密钥。

结构错误最多修复一次。网络失败、超时和结果不明最多自动追加两次有独立回执的请求；已完成步骤复用，无需逐次确认。应用不再因本地累计次数阻止请求，实际可用额度以模型服务商和密钥配额为准。

真实模型、离线测试和浏览器检查分别记录，不能把合成样例或连通性探针视为完整真实链路成功。具体回执和当前结果只以 CURRENT 与运行账本为准；运行账本继续记录累计请求次数，不作为应用层硬上限。

AI 自动推断：提交作者想法后，框架 Agent 会结合主题、故事风格和已有世界状态补全世界规则、冲突、地点、组织、历史与开局；世界候选通过校验后，NPC Agent 会结合完整世界状态自动推断角色阵容、动机、关系、秘密、说话方式、当前状态和成长方向。所有自动补全均以 AI 推断/AI 建议标记，仍需作者编辑、接受或拒绝。

## 使用流程

1. 选择西方魔幻或东方武侠，输入自己的故事方向与限制。
2. 生成世界框架，查看理解反馈、澄清问题及世界历史和开局时间线。
3. 点击“生成世界、画像与时间线”后，默认接续生成 NPC，并将世界、历史/开局时间线和人物合成一份待采用候选。可关闭自动接续。缺失细节以待确认建议补全，不阻塞候选生成；NPC失败保留世界供继续生成，不重复世界调用。人物数量来自输入和故事需要。
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

浏览器验收使用 `npm run test:e2e`，详见下方“验证与交付”。旧 `scripts/browser-*.playwright` 为历史第一层验收资料，不是当前写作流程入口。

## 文档与接续开发

- AGENTS.md：唯一项目 Agent 约定，补充全局规则，不另建 agent.md 或平行规则文件。
- ARCHITECTURE.md：完整产品原始架构；不因第一层实现而改变完整产品本意。
- docs/PRODUCT_SPEC.md：第一层功能规格与执行边界。
- memory/INDEX.md：开发记忆导航与权威路径。
- memory/CURRENT.md：唯一当前进度、证据、预算与下一项工作。
- memory/DECISIONS.md：重要决定及理由。
- memory/HISTORY.md：实际操作与检查历史，追加而不抹去失败。
- 第一层产品开发完整提示词.md：历史入口重定向，不再独立维护另一份规格。

接续开发先读 AGENTS、CURRENT 和 INDEX，再按任务定位规格、Schema 与代码。不能因旧任务写着进行中就推断进程仍在运行，也不能把测试通过等同于真实模型流程通过。

## 独立人物记忆模块

`memory-agent/` 是独立 Node.js 包，保留自己的依赖、TypeScript 配置和测试。主 Agent 已通过 src/lib/orchestration/memory.ts 复用其抽取、记忆和画像逻辑；正式写作界面可读取人物、证据、通知并提交人工修正。根应用只编译实际引用的模块；开发该模块时执行：

```bash
cd memory-agent
npm ci
npm run typecheck
npm test
npm run build
```

接口和数据库说明见 [memory-agent/README.md](memory-agent/README.md)。


## 完整 PRD 与主 Agent

- [完整 PRD](PRD.md) 与 [调用规则](MAIN_AGENT_RULES.md) 随本 Git 仓库交付，上级工作区保留同步副本。
- 服务端入口：`src/lib/orchestration/main-agent.ts`；子职责与契约：同目录 `agents.ts`、`contracts.ts`、`prompts.ts`。
- API：`GET /api/story/main?story_id=...` 查询；POST `initialize` 接收已确认完整快照；POST `turn` 接收 `story_id/operation_id/base_revision/input`，可设 `close_chapter` 与显式 `retry_failed`。
- 旧 framework/npcs/revise/field API 返回兼容，内部统一交给主 Agent 路由。不会把生成候选直接确认或写入叙事。
- 写作会话存于 `runtime/stories`；同故事目录锁、逐步检查点、原子提交。人物记忆从检查点继续，完整日志可用于重建，不重复模型调用；默认不接 PostgreSQL。
- `runs[].status=blocked` 表示轮次未提交；HTTP 200 不等于生成成功。显式重试可复用 done 步骤，失败模型步骤的新尝试可能重复费用。
- 兼容同步 API 保留；写作 UI 使用本地响应后任务，没有账户鉴权。生产发布需要补齐权限、存储和独立任务执行方案。
- `npm run dev`、`npm run build` 明确使用 webpack，通过 extensionAlias 解析独立 memory-agent 包的 NodeNext `.js` 源码引用。根应用直接声明 Zod 运行依赖；独立记忆包仍按自己的命令单独开发。

针对主编排检查：`npm test -- src/lib/orchestration`。此命令使用模拟模型，真实模型质量与费用不在自动化测试结论中。


## 写作与恢复

1. 填写故事想法，生成并采用世界和人物候选；也可手动填写。
2. 点击“开始写作”，直接以现有有效设定或当前候选初始化并生成开篇；无需逐项确认、补全人物或回答问题。
3. 输入行动或对白，点击“推进故事”。正文只在整轮提交成功后进入作品。
4. 刷新只查询状态；失败时可以恢复已完成步骤，或放弃该轮后继续。恢复按钮会提示可能的模型费用。
5. “停止等待”只暂停浏览器查询；“取消后续生成”在当前模型步骤保存后停止；“放弃此轮”保留审计但不发布中间正文。
6. 章节可以随轮次结束，也可在没有新剧情时独立归档。作品页可导出 Markdown 和完整 JSON 备份。

完整备份包含正文、摘要、记忆日志、修正和回执；恢复会校验并重建派生缓存，不覆盖同 ID 已有作品。备份含创作内容，请自行妥善保管。写作中改设定需载入、编辑、确认、核对差异并同步；不能通过初始化覆盖剧情。

## 验证与交付

```sh
npm test
npm run lint
npm run typecheck
npm run schemas:check
npm run build
npm run test:e2e
npm run test:real
```

- `test:e2e` 使用已安装 Tabbit 的稳定 CLI，自动启动隔离的本机应用和合成模型，数据写入临时目录，不使用真实模型。可用 `TABBIT_CLI` 指定启动器路径；需要浏览器运行权限。默认端口 3112 / 4013。导出校验覆盖生成的 Markdown 内容，浏览器原生下载事件不作为该脚本的断言。
- `test:real` 明确调用真实模型：读取 `.env.local`，执行武侠与魔幻的世界/NPC及各三轮叙事；会产生费用。没有配置时在调用前失败。报告、每步账本和作品保存在 `runtime/evaluation/`，语义评审仍按 [真实验收标准](docs/REAL_MODEL_ACCEPTANCE.md) 检查实际正文。
- `PRD.md`、`MAIN_AGENT_RULES.md` 在仓库内提供完整交付版本；工作区上级同名文件为同步交付副本。修改后运行 `npm run docs:sync` 更新存在的上级副本。
- 默认是可信的本机单用户应用，启动脚本绑定 127.0.0.1。公网发布所需的账户、访问权限、数据库和部署目标未由这套本机文件存储替代。

## 可选运行配置

| 变量 | 默认 / 含义 |
| --- | --- |
| STORY_DATA_DIR | runtime/stories，故事和任务持久目录 |
| MODEL_LEDGER_PATH | runtime/model-requests.json，请求账本，不能随意清空 |
| NARRATIVE_CONTEXT_CHARS | 60000，用于选择附加历史与检索记忆的软字符预算；核心设定始终保留，不因超过该值阻止开篇，也不是供应商 token 上限 |
| LLM_MAX_REQUESTS | 不配置即无应用次数上限；配置正整数为该账本的累计调用上限，包含修复 |
| LLM_INPUT_PRICE_PER_MILLION / LLM_OUTPUT_PRICE_PER_MILLION | 可选，用于已报告 token 的费用估算；使用相同货币单位，不配置时费用未知 |

任务由本地 Next.js 进程在响应后执行；断开网页不会停止任务。进程重启后需要用户明确恢复，系统不会自动重发结果不明的付费请求。只自动回收同一主机上确认已死亡进程的锁；没有归属信息的旧锁需停服、备份并检查。当前不是分布式任务队列。

### 自动创作与指定 skill

已接入 [jin-yong-perspective](https://github.com/Wunicheng233/jin-yong-perspective)：项目副本在 vendor/skills/jin-yong-perspective，原始创作方法存档在 src/lib/orchestration/jin-yong-skill.json，运行时采用 prompts.ts 中的精简版本，保留原文SHA-256。采用六种创作模型与表达方法，省略真人身份扮演，避免固定剧情模板。来源仓库README声明MIT，使用保留来源；其历史引文与研究断言不视为本项目已核实史实。

首次开始自动生成开篇，重复打开/刷新不自动续写；续写要求可留空。已移除正文16000字符校验和叙事请求固定max_tokens参数，正文按场景完整性展开；单次输出仍受供应商容量、上下文预算和存储传输边界限制，不承诺无限单次响应。

### API 自动恢复（OP-20260912-013）

已授权自动恢复：刷新后自动继续保存的设定请求，保持原请求内容和ID；优先复用成功回执，并对旧Schema失败结果用修正规则重新校验。网络/超时失败最多追加两次调用，每次独立记账。同一进程内相同操作合并等待，不并发生成。持续失败显示实际错误，点击继续无需再次授权；不重置历史账本。


### 生成提速与流式正文

新轮次正常3次模型调用：直接创作正文、记忆抽取、摘要。人物与故事线在正文请求中合并完成，不再等待独立规划；正文保持完整场景展开。NPC关系索引自动补齐、遗漏的已有角色保留，减少无必要的模型修复。每个写作步骤显示已完成耗时。

正文默认请求SSE流式响应，通过任务轮询提前显示预览，后续记忆与摘要完成后才正式保存整轮。刷新不会将预览误当成正式章节。供应商返回完整JSON也可接收；若供应商不接受stream参数，在.env.local设置LLM_STREAM=false并重启，改为正文全部生成后提前展示。无需改动密钥。

`npm test` 包含分块中文流、预览隔离与恢复、关系索引修复和并发去重测试；`npm run test:e2e` 使用隔离合成模型验证提前阅读、刷新、失败续试及导出，不消耗真实模型额度。

写作上下文排除历史请求去重指纹、编辑日志与时间戳；世界、人物、时间线及事实来源保留，原始快照仍完整落盘。生成先展示正文预览，正式轮次需待后续步骤完成。


2026-09-12 当前API短场景基准：首段可读文本2531ms，210字正文总耗时7564ms；模型deepseek-v4-flash，单次合成短输入。结果在被忽略的runtime/performance/latest-latency.json；不代表完整设定、长篇正文或全链路耗时。tests/model-latency.test.ts默认跳过，显式RUN_MODEL_LATENCY=1且加载服务端环境后才执行一次真实付费测试，不自动重试。


### 扮演主角参与对话

新剧情遇到NPC向主角提问、邀约或要求选择时会暂停。正文旁显示“正文待生成 · 等待你的回应”；输入主角想说的话，或用括号描述行动，点击“回应并继续剧情”。系统将回应带入下一段故事，直到下一次对话。主角由唯一用户控制人物确定，无明确人物时显示主角（你）。

刷新保留停点和草稿；不能留空自动替主角回答。生成及记忆整理期间可先写下一条草稿，完成后提交。旧已生成正文不重新拆分；下一轮开始采用互动模式，旧未完成任务保持原流程恢复。最近对话、正文及完整备份均保留回应来源。

回归用例：tests/dialogue-flow.test.ts；浏览器test:e2e包含对话暂停、角色显示、回应影响下一段、刷新零调用与草稿保留。离线通过不代表真实模型永远准确识别所有对话语义。


### 独立NPC对话窗口

新轮次进入dialogue_v2：NPC发起对话后立即弹窗，正文暂停。使用“发送给NPC”连续交流，正文不会随每句话推进；自然结束或点击“结束对话并继续正文”后，系统自动整理对话并续写至下一停点。收起后可点“打开NPC对话窗口”，刷新保留草稿。完整流程图与Agent契约见[设计文档](docs/NPC_DIALOGUE_AGENT.md)。

暂停前仅需一次正文模型调用，每条用户回复只调用NPC模型；对话结束再执行记忆和摘要。语义失败、存储中断及自动接续中断有独立恢复路径。旧已生成正文保持原样，旧未完成轮次按原协议恢复。

### 默认接受生成改动

世界、NPC、局部修改及字段建议校验后直接应用，不再显示“待确认改动”面板。世界先保存再接续NPC，NPC失败不会丢失世界。生成期间的手动编辑优先保留，可用“撤销”恢复上一份设定。刷新会自动处理已保存且无请求在途的候选，不重新调用模型；无效结果保存在本地备份并显示原因。
