# manxiang · 漫想江湖写作陪伴

用户是作者：先确认世界观和主角，与主角讨论重大事件，确认节点后，由固定版本的金庸 skill 扩写小说。服务端保存故事、章节、人物、事实、未解伏笔及历史版本。

- `/`：江湖写作工作台。
- `/comic`：原有漫画工作台，继续支持剧本、分镜和漫画生成。
- [产品需求](docs/PRD-写作陪伴助手.md) · [开发与验证说明](docs/开发交付.md)

## 本地启动

需要 Node.js 22.13+。安装后先构建一次以生成本地数据库配置：

```bash
npm run install:ci
npm run build
```

**仅在首次建立本地数据库时**，应用初始迁移；已有数据库不要重复执行这份 SQL：

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_wooden_nehzno.sql
```

启动：

```bash
npm run dev
```

打开终端打印的地址（默认 `http://localhost:5173`）。当前开发机已应用初始迁移，可直接启动。存档位于项目本地的 `.wrangler/state`，此目录不会上传 GitHub。

## 创作流程

1. 创建故事，输入不少于 8 字的江湖方向。
2. 在“连接 AI”中选择 DeepSeek 并填写自己的 API Key；默认模型为 `deepseek-flash`，也可切换 OpenAI（`gpt-4.1-mini`）。
3. 生成、编辑并确认世界观，再生成和确认主角与必要配角。
4. 与主角讨论当前事件，修改并确认事件卡。
5. 点击“把这个节点写成小说”。节点计划在正文提交前不会改变故事事实。
6. 继续下一个节点；也可以润色某个已写事件，比较候选后接受。
7. 手动整理章节，或在上下文达到阈值时自动整理。故事与原始讨论持续保存。
8. 随时导出 Markdown 或 JSON；在“章节与记忆”中导出历史快照。

API Key 只在页面内存中保留，经本站转发到所选服务的固定官方接口；不进入数据库或日志。刷新后需要重新填写。API 调用按使用者账户计费。作品使用当前浏览器的 HttpOnly 随机凭证访问，清除浏览器数据可能失去匿名存档入口。

## 金庸 skill

来源：[Wunicheng233/jin-yong-perspective](https://github.com/Wunicheng233/jin-yong-perspective)。固定 commit：`bfc14e72d73fe8ebe5b3e73a548b29d238027468`。

原文与来源记录位于 `vendor/jin-yong-perspective/`；服务端加载同一内容的构建模块，并在正文任务开始时核验 SHA-256。适配规则要求输出原创江湖小说，不让主角对话切换成技能顾问身份。模型与技能不负责直接提交正式状态，宿主工作流执行确认、校验和保存。

## 检查

```bash
npm test
npm run typecheck
npm run build
```

启动本地服务和数据库后，可以运行无付费调用的 API 验证：

```bash
npm run test:api
```

测试会创建独立临时存档，并输出清理 SQL 到 `/private/tmp/manxiang-smoke-cleanup.sql`。执行下列命令仅清理该次测试生成的记录：

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file /private/tmp/manxiang-smoke-cleanup.sql
```

## 部署说明

GitHub 托管源码。应用依赖 Worker 服务端和 D1 数据库，不能仅发布静态页面得到完整功能。构建产物兼容现有 Sites / Cloudflare Worker 流程；发布环境必须绑定 `DB` 并应用 `drizzle/` 中尚未执行的迁移。

尚未部署新的在线写作版本；真实模型生成尚未使用有效用户 Key 做付费联调。DeepSeek 接口参考 [官方接入指南](https://api-docs.deepseek.com/) 与 [JSON 输出说明](https://api-docs.deepseek.com/guides/json_mode/)。

## DeepSeek 配置

在 [DeepSeek 平台](https://platform.deepseek.com/api_keys) 创建 API Key，在写作工作台右上角“连接 AI”选择 DeepSeek 并保存，然后点击“生成世界观”开始使用。刷新页面后需重新填写；切换服务会清除旧 Key。无需修改代码或提交密钥到 GitHub。

所有写作 Agent 共用所选服务，使用 JSON 输出、结构校验和失败重试。DeepSeek 请求关闭思考模式，使用 `max_tokens`；OpenAI 保留原参数。漫画工作台仍使用原有接口配置。
