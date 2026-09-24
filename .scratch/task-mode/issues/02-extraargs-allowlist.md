# 02: extraArgs 白名单

**What to build:** 导入/创建任何带 extraArgs 的角色或成员,夹带的危险 CLI 参数(如 `--dangerously-bypass-approvals-and-sandbox`)被拒绝并给出明确警告;白名单仅放行 `--model`(带值)与 `--thinking-budget`(数字格式)。

依据 ADR-0002 实施义务:**单一校验函数**收口全部入口(角色创建/角色卡导入/建房成员/房间导入成员/角色导入),勿逐处内联。拒绝是警告+剥离还是整体拒绝:剥离子项并警告(导入永不失败原则在房间导入侧的延续,角色创建侧可整体 400)。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 单一校验函数存在,全部 5 个入口都经它(grep 可证无旁路)
- [ ] 危险参数被剥/拒:路由级测试(导入角色卡含 --dangerously-bypass → 不出现在落库 extraArgs)
- [ ] `--model sonnet` / `--thinking-budget 8000` 白名单通过
- [ ] 恶意格式变体(--model=xxx 单 token 形)被正确处理或拒绝,不静默放行
- [ ] typecheck + 全量测试绿
