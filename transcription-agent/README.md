# 小说转写 Agent

将用户输入、角色演绎、世界旁白和故事状态融合为原创中文小说片段。设计材料现已由主应用的 `src/lib/orchestration/agents.ts` 与 `prompts.ts` 接入执行。

- 输入契约：input.schema.json；v2 的 narrator_output 是结构化对象，含 current_time/current_location/background/visible_events。
- 输出契约：output.schema.json；示例：example.json。
- 总调用规则：[MAIN_AGENT_RULES](../../MAIN_AGENT_RULES.md)。
- 本目录提示词为职责参考；运行提示词权威在 `src/lib/orchestration/prompts.ts`。
- 主应用根据东方武侠或西方魔幻预设调整文风，不把所有故事强制改成武侠。
- 原设计提及的 jin-yong-perspective 是可选方法来源，本项目不依赖原贡献者本机安装路径。运行时不加载外部 Skill，不复制既有作品或冒充作家。
- 单独使用本目录只有契约与材料；可执行入口是主应用 `/api/story/main`。
