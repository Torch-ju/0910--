# DeepSeek 接入

将 `./.env.deepseek.example` 复制为 `./.env`（若已有配置请合并，避免覆盖），在本地填写 `DEEPSEEK_API_KEY`，然后重启 `bash ./scripts/start-local.sh`。密钥只由后端读取，不放入前端、请求参数或版本库。

默认 provider=deepseek，官方 HTTPS 地址，模型名 deepseek-flash，可修改 MODEL_NAME 为账户可用模型。沿用 Chat Completions JSON 输出，显式禁用 thinking，问答、摘要、小说生成共用现有任务/预算/取消机制。MODEL_CALL_BUDGET 是该数据库累计真实请求次数上限，包含重试；示例为 100，可自行调整。不会自动退回模拟结果。

## 接口

- GET `/api/v1/model/status`：本地配置状态，不暴露密钥，也不代表上游可连接。
- POST `/api/v1/model/check`：调用 DeepSeek `/models` 验证认证和所选模型；不发送故事、不生成文本。返回 `generation_tested=false`，小说生成能力须实际验收。
- POST `/api/v1/projects/{pid}/turns`：现有问答接口自动走 DeepSeek。
- POST `/api/v1/projects/{pid}/stories/compose`：现有小说接口自动走 DeepSeek。

本地检查：`curl -X POST http://127.0.0.1:8001/api/v1/model/check`。

## 模型主导提问

九个世界观/时间线主题作为覆盖索引。真实模型根据已有摘要、回答和 Skill 决定实际问句及 `next_question_id`，可以原主题追问、跳跃或回访。后端保存模型生成的问题，下一次摘要引用实际问题语境。初始问题提供入门入口；mock 仍使用固定问题，仅作流程验证。模型主导追问的语义质量待真实模型验收。

依据：[官方首次调用说明](https://api-docs.deepseek.com/)、[JSON 输出](https://api-docs.deepseek.com/guides/json_mode/)、[模型列表](https://api-docs.deepseek.com/api/list-models/)。模型名称以官方当前说明和账户列表为准。

## 页面接入

点击顶部“接入模型 API”，填写 API Key、模型名、累计请求次数上限，点击“检查连接并启用”。POST `/api/v1/model/connect` 验证模型列表后以原子写入保存本地 `.env`（权限 0600），同时更新运行配置，无需重启。失败保留原配置，运行任务期间禁止切换。密钥不会写入对话/浏览器本地存储或在接口中回显；关闭弹窗清空输入。
