# 04: 任务 prompt 契约

**What to build:** 给任务房派活,agent 收到的教学是"完成工作→实际用工具改码→汇报做了什么/改了哪些文件/如何验证→遇阻先问",而非聊天房的"围绕项目发表观点+300字+接棒"。用户从 agent 的第一条回复就能看出它进入了干活模式。

依据 spec 任务 prompt 契约:kind='task' 时 buildPrompt/buildDeltaPrompt 换任务段族(promptTexts zh/en 双写)——工作区段(项目路径+真实权限说明+"工作仅限此项目目录"+自主探索引导,**不注入目录树**)+行为契约(工具干活/汇报/遇阻问/不限长度);砍掉:参与者列表(单成员)、接棒教学、长度约束、讨论式指令。persona 照常注入。chat 房 prompt 逐字节不变。

**Blocked by:** 03(任务房 schema——kind 字段是段族分支的判据)

**Status:** ready-for-agent

- [ ] 任务房全量 prompt 含工作区段与行为契约,不含目录树/接棒教学/长度约束/参与者列表(prompt 断言测试,zh/en 两语言)
- [ ] 任务房增量 prompt(stateful delta)行动指引同为任务契约
- [ ] chat 房 prompt 与改造前逐字节一致(既有 prompt-i18n 断言全绿即证)
- [ ] 权限说明段按档位注入真实语义文案(full:"可读写文件、执行命令;工作仅限此项目目录")
- [ ] zh/en 键集一致
- [ ] typecheck + 全量测试绿
