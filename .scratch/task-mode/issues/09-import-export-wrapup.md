# 09: 导入导出兼容与收尾

**What to build:** 任务房配置可备份迁移(导出/导入往返含 kind 字段保真);跨机导入路径失效的 task 房降级为 chat 房并警示(不产生僵尸任务房);任务房设置面板只显示相关设置;项目文档与已知边界同步更新——整个任务模式 feature 收口,全量回归绿。

内容:导出含 kind;导入降级逻辑(task 房 projectPath 本机不存在 → 导入为 chat + 系统消息警示);设置面板按 kind 条件渲染(task 隐藏 chainBudget/subscribeConfig/mode 等,RoomSettings PATCH 同步过滤);CLAUDE.md 更新(已知边界"claude readonly 不硬拦"被 01 取代改写;架构图/测试章节补任务模式);CONTEXT.md/ADR 如有偏差校正。

**Blocked by:** 03, 04(段族定型后收口才有完整对象)

**Status:** ready-for-agent

- [ ] 任务房导出 → 导入往返:kind/mode/projectPath/权限/上下文档保真,sessionIds 剥除(既有语义)
- [ ] 导入 task 房 + projectPath 本机不存在 → 导入为 chat 房 + 系统消息警示;导入不失败
- [ ] 任务房设置面板无 chainBudget/subscribeConfig/mode 项;PATCH 发送这些字段对 task 房被忽略/过滤
- [ ] chat 房设置面板与导入导出行为与改造前一致
- [ ] CLAUDE.md:已知边界 readonly 缺口条目改写为已修复;架构/测试章节补任务模式
- [ ] 全量回归:typecheck + server 259+ 测试 + 新增测试全绿
- [ ] 手动冒烟:建任务→派活→agent 干活→汇报→超时(设 1 分钟)→重发续跑,一条龙通
