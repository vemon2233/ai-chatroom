# 05: 超时保护

**What to build:** 房间设置了超时(如 10 分钟)后,挂死/失控的单次发言到点被停止,落系统消息"(超时已停止,可重发继续)",CLI session 保留——用户重发消息即 resume 续跑。**未设置超时(默认)时行为与现状逐字节一致。**

依据 ADR-0002 实现约束:agents.yaml 全局配置项(默认 0=无限)+ 房间可调;harness 层可配置计时,超时触发 cancel(killTree);SpeakOutcome 加 timedOut 标记;**走 cancelled 轨道严禁 error 轨道**(error 自愈会清 sessionIds+自动重试,语义相反);占位消息按 timedOut 区分文案;cancelled 既有保证(不清 session/不重试/保留半截正文)全继承。

**Blocked by:** 03(SpeakOutcome 变更面与任务房配置束同期;kind 落地后房间可调配置才有挂靠)

**Status:** ready-for-agent

- [ ] agents.yaml 全局配置项存在,默认 0=无超时;未配置时全量既有测试不变绿(行为零变化证明)
- [ ] 超时触发:fake adapter 永不 resolve → 到点被 cancel → outcome 为 cancelled+timedOut,占位消息文案"(超时已停止,可重发继续)"(非"(已停止思考)")
- [ ] 超时后 sessionIds 不清、绝不自动重试(编排器状态回 idle,无新进程)
- [ ] 超时前已流出的正文保留在占位消息中
- [ ] 用户手动 stop 与超时停可区分(timedOut 标记;文案不同)
- [ ] 房间级覆盖全局默认(设置路径)
- [ ] typecheck + 全量测试绿
