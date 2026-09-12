# 剧本生成器

由大模型通过对话引导世界观、主角与时间线构建，将问答整理为可追溯摘要，再结合 Jin Yong Perspective Skill 生成完整小说草稿。

## 功能

- 模型根据回答决定追问与下一主题，用户可自由回答和切换闲聊。
- 主线负责世界观、人物与因果；辅助闲聊可影响剧情，保留用户控制权。
- 摘要节点支持编辑、确认、撤回、来源追溯及版本记录。
- “连接节点生成故事”直接在完整故事模块构思、逐章写作、检查结局与线索并修订。
- 不设总字数/总章节数上限，支持暂停、检查点续写和 Markdown 导出。
- 页面提供“接入模型 API”，验证 DeepSeek 密钥后在本地保存并立即启用。

## 本地启动

需要 Python 3.11、uv、Node.js 24 和 npm。在本目录执行：

```bash
uv sync --project backend --python 3.11 --locked
cd frontend
npm ci
npm run build
cd ..
bash scripts/start-local.sh
```

打开 http://127.0.0.1:3001，后端端口 8001。数据库自动创建于本目录 `data/story.db`。

## 模型接入

默认是模拟模式，只验证流程，不代表真实创作效果。进入页面点击“接入模型 API”，填写 DeepSeek API Key、模型名及累计请求上限，点击“检查连接并启用”。配置保存在本机 `.env`，不回显、不上传仓库。

也可以复制 `.env.deepseek.example` 为 `.env`，本地填写后重启。模型调用次数、单次上下文与输出仍有预算限制；长故事超时或预算耗尽会保留进度，不将未完成稿件计为完整故事。

完整性检查基于结构覆盖、核心线索记录及模型对摘要和正文结尾的审校，文学质量仍需用户实际阅读验收。

## 验证

```bash
cd backend
uv run pytest
uv run ruff check .
cd ../frontend
npm run lint
npm run typecheck
npx playwright install chromium
# 启动应用后执行浏览器测试；请使用隔离数据库与 mock 模式
npm run test:e2e
```

本轮已通过后端回归、截断重试、13 章分段写作、失败续写和审校修订测试，以及桌面/手机 14 项浏览器验收、前端生产构建。

## 文档

- [DeepSeek 接入](docs/DeepSeek接入.md)
- [Agent 开发说明](docs/故事Agent开发说明.md)
- [产品需求](PRD.md)

创作方法来自 [Jin Yong Perspective Skill](https://github.com/Wunicheng233/jin-yong-perspective)，保留本地原文及文件指纹；不冒充作者本人。技术文档含早期记录，当前功能以本文及最新增补为准。
