# 08: 斜杠命令层

**What to build:** 输入框敲 `/` 弹出命令候选层(与 @ 提及同款微信式交互):内置命令(/compact 压缩当前 agent session、/model <name> 切模型)+ 动态 skill 命令(扫描用户级与项目级 skills 目录生成候选)。选中 skill 命令后补两句话回车,agent 按该 skill 干活;未知 `/xxx` 不拦截,当普通文本发出。

技术要点:解析进 mentions 同层管线(单一真源加 `/` 分支,纯函数可单测);skills 候选需 server 端点(扫 `~/.claude/skills/` + 当前房 projectPath 的 `.claude/skills/`);/compact 复用既有 compact 基建(对当前房当前成员 session 执行);/model 需新增成员变更路由(修改成员 extraArgs/--model,下次发言生效);skill 触发 = 组装"使用 X skill 执行:<补充说明>"作为消息发出。

**Blocked by:** 03(作用域是"当前房",skills 扫描依赖 projectPath 挂靠;kind 落地后端点有上下文)

**Status:** ready-for-agent

- [ ] 敲 `/` 弹候选层,列出 /compact、/model 与本机/本项目 skills(与 @ 弹层交互一致)
- [ ] 斜杠候选解析纯函数单测(前缀/过滤/选中替换)
- [ ] /compact:对 stateful 房当前成员执行压缩,消息流落系统消息反馈(无 session 时提示不可用)
- [ ] /model <name>:更新成员模型参数,下次发言生效(经成员变更路由);/model 无参数 → 表单提示或候选模型列表
- [ ] 选 skill 命令 → 输入框组装为可编辑的 skill 触发文本,回车后 agent 实际执行该 skill(实测一条)
- [ ] server skills 扫描端点:用户级 + 项目级合并,无重复;无 projectPath 房仅用户级
- [ ] 未知 /xxx 不拦截照常发送
- [ ] zh/en 文案齐
- [ ] typecheck + 相关测试绿
