# 03: 任务房 schema 与建房间隔

**What to build:** 用户(经 API/临时请求)能创建 kind:'task' 的房间:必填且存在的 projectPath、mode 锁 baton、无 Scout 预检、默认 full 权限 + stateful 上下文。存量房间读时默认 chat,一切照旧。任务房即任务的本体落地(ADR-0001)。

内容:RoomConfig 加可选 kind 字段(缺省 'chat',存量零迁移);建房路由校验(task 无 projectPath → 400;projectPath 本机不存在 → 400;mode 强制 baton);任务房跳过 Scout;makeRoomConfig 任务默认值束(full/stateful);复活路径对 kind 透明透传。

**Blocked by:** 01(权限真实化——任务默认 full 的前提:full=真全开、readonly=真只读必须先成立)

**Status:** ready-for-agent

- [ ] POST /api/rooms 带 kind:'task' + 有效 projectPath → 成功,落库含 kind/mode='baton'/full/stateful
- [ ] task 缺 projectPath 或路径本机不存在 → 400,错误消息可读
- [ ] task 带 mode:'subscribe' → 被强制为 baton(或 400,实现择一,测试锁定)
- [ ] 任务房发言不触发 Scout(消息流无侦察报告);同配置 chat 房照旧触发
- [ ] 存量 rooms.json(无 kind)复活 → 默认 chat,现有测试全绿
- [ ] GET /api/rooms/:id 返回 kind;前端类型同步
- [ ] REST 路由测试覆盖以上全部(import-export-routes.test.ts 同范式)
- [ ] typecheck + 全量测试绿
