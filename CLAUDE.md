# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

AI 聊天室 v2:多个 AI agent CLI(Claude Code / Codex / Gemini / 自定义)同处一个 Web 聊天室,聊天、探讨、辩论。原生 Windows 运行(无 WSL/tmux)。npm workspaces 单仓:`server/`(Node ESM + TS,tsx 直跑)+ `web/`(Vue 3 + Vite + TS,Composition API)。

v1(旧项目 `../7_AIDebator`)的架构重写:God class 拆解、显式编排状态机、房间持久化复活。所有 v1 实测 bug 的修复方式见下文「v1 血泪教训(勿回退)」。

## 常用命令

```bash
npm run dev        # concurrently 起 server(tsx watch, :3220)+ web(vite, :5173,代理 /api+ws)
npm run typecheck  # 两包 tsc/vue-tsc --noEmit
npm test           # server vitest(编排器状态机/baton/prompt/持久化)
npm run build      # web 生产构建 → web/dist(后端 3220 直接服务 dist)
cd server && npx tsx src/server/index.ts   # 只跑后端
```

改后端代码 tsx watch 自动重启(对外部工具的编辑偶有失灵——测试新行为前确认 3220 进程启动时间晚于代码修改时间)。前端 dev 模式热更新;生产模式需 `npm run build`。

## 架构

```
server/src/
├── paths.ts              REPO_ROOT 路径锚定(零依赖叶子,store/config 共用)
├── core/                 领域层
│   ├── types.ts          领域类型(Character/MemberConfig/ChatMessage/RoomConfig/RoomState)
│   ├── orchestrator.ts   ★ 编排状态机:idle/baton/roundrobin/subscribe + 单长驻串行队列 + 世代计数器
│   ├── room.ts           ChatRoom 薄门面(成员管理/依赖装配;持久化经 RoomPersistence 接口注入;
│   │                     ★ 摘要串行链 summaryChain:生成并发、写回排队、链内槽位化合并)
│   ├── direct.ts         1v1 角色私聊服务(独立历史/会话/摘要,与房间物理隔离)
│   ├── admin.ts          管理员(项目侦察 + 公聊摘要;熔断闩;oneShotSpeak 经 exec.ts)
│   ├── exec.ts           oneShotSpeak(超时必 clearTimeout+cancel——轻量一次性调用基建)
│   ├── palette.ts        成员头像色板
│   ├── naming.ts         matchMemberByName 叶子(名字匹配唯一真源,@点名/接棒/私聊受众共用)
│   ├── render.ts         historyText/lengthBrief/permissionBrief 渲染叶子(消息→prompt 文本)
│   ├── prompt.ts         buildPrompt/buildDeltaPrompt(全量/增量组装器;叶子已抽至 naming/render)
│   ├── summaryOps.ts     ★ 上下文压缩层(链式公聊摘要/私聊自纪要/原生compact/锚点视窗组装)
│   ├── historyOps.ts     截断/重roll/编辑的纯历史操作
│   ├── projectContext.ts 目录树采集(5min 缓存)
│   ├── bus.ts            WS 广播(消息落库经 emitMessage 钩子)
│   └── modes/            讨论模式域
│       ├── baton/        接棒:baton.ts(尾行解析)/prompt.ts(接棒指令段落)
│       └── subscribe/    订阅(心跳自决群聊):engine.ts(心跳引擎)/audience.ts(私聊拆解与受众过滤)
│                        /protocol.ts(私聊握手协议+3条硬闸)/prompt.ts(心跳自决 prompt)
├── adapters/
│   ├── base.ts           AgentAdapter 契约 + SpeakOutcome{ok|error|cancelled}
│   ├── proc.ts           spawn harness(stdin 纪律/killTree/cwd 隔离/统一计时/cancel 兜底/stdin EPIPE 吞)
│   ├── claude.ts         权限参数映射 + session resume(实测过)
│   ├── generic.ts        通用模板适配器(kind: generic 即接入任意 CLI)
│   └── codex/gemini.ts   ⚠️ experimental,零实测
├── server/               HTTP+WS:index(启动含房间复活)、routes(REST)、config(agents.yaml)、ws
└── store/                持久化(rooms.json 原子写+串行互斥、rooms/*.jsonl、characters.json、
                         direct_chats/*.jsonl、summaries/(快照)、traces/(完整调用日志))
```

**依赖方向实况**(与旧文档不同,以此为准):core 目前直接 import store 的
trace/summary/directChats/transcript 落库函数(saveTrace/getSummary/saveSummarySnapshot 等),
store 的 transcript 反向引用 core 的握手推算——**层间存在双向渗透,尚未收口**。
计划中的 StoragePorts 接缝重构(批次 4)将恢复单向;在那之前,改动这些文件时
务必同时核对两个方向的调用点。

web/src/
├── main.ts / App.vue / style.css
├── services/                 通信层(api.ts REST 请求 / ws.ts WebSocket 客户端)
├── store/                    状态层(index.ts reactive 单例, 消息列表权威源)
├── utils/                    工具算法层(mentions.ts @token 解析 / avatar.ts 头像色板计算)
├── composables/useDialog.ts  Promise 化 confirm/prompt/alert
└── components/
    ├── ui/                   覆盖层原语:Modal(唯一覆盖形态:居中窗口)+ DialogHost(z:90 压一切)+ SidebarCard
    ├── layout/               布局导航:Sidebar / RoomTabBar
    ├── chat/                 聊天舞台:RoomView / MemberBar / ChatFlow / MessageBubble / TraceDetail / Composer / ChatInspector
    └── modals/               业务弹窗与表单:AddMemberPanel / CharacterModal / NewRoomModal / RoomForm / CharacterForm
```

### 核心数据流

1. **发言链路**:用户消息 → `/say` → `ChatRoom.userSpeak`(入库)→ `Orchestrator.onUserMessage`(解析 @/<接棒>)→ 串行队列出队 → `runOne`(可选 Scout 预检)→ `buildPrompt` → `invoke`(适配器 speak,stdin 喂 prompt)→ 事件流(trace/thinking/sessionId 捕获)→ 落库 JSONL + WS 广播 + rooms.json 写穿 → 接棒条目则尾部解析 `<接棒>@名字` 决定下一位。

2. **@语法**(每条消息驱动;讨论模式/上下文模式**建房时确定、运行期锁定**——`/mode` 运行期切换命令已删除;user 与 agent 共用 `<接棒>@名字` 语法,兼容旧【接棒】):
   - `接棒@成员` / `<接棒>@成员` = 指定起手:该成员直接起头进接棒链
   - `@成员名` = 点名:被点名者回应用户(订阅模式下多 @ 依次排队唤醒);接棒模式尾行 `<接棒>@xx` 指定下一位 → **暂停待命**(xx 不自动发言;用户下一条纯文本消息后 xx 起头)
   - `@allN` = 轮流 N 轮(预入队全部条目:成员×N + 终局总结;**负向前瞻词边界**——`@allan` 是点名 "allan" 不触发轮流,名为 `all3` 的成员无法被 @all3 点中,保留字优先)
   - 无 @ = 接棒续聊:有待命接棒者(pendingNextId)→ TA 起头;无 → **随机**起头(v2.1 起冷启动随机,修"永远第一个 agent 开场");订阅模式下纯文本随机唤醒一名成员起头
   - 接棒失败语义:发言者没写有效接棒行 → 停止,控制权回用户(无轮询兜底)
   - 停止语义:cancelled → 落"(已停止思考)"占位消息(有部分正文则保留正文);**cancelled 绝不触发 resume 重试**(否则停止会复活新进程——实测"按两次停止"bug 根因);stop 不清除待命接棒者;**stop/用户消息不清私聊协议**(线程与 3 条硬闸跨消息存活,仅 clearMessages 全清、成员移除关闭其线程)

3. **状态机**:`idle | baton | roundrobin | subscribe`。队列唯一消费者是单个长驻 async 循环;世代计数器(generation)让 stop/@allN/@name/error 天然作废一切过期条目;接棒解析只在 invoke 尾部且校验世代未变。**error → 一律 idle + bump 世代终止本轮编排**,绝不解析错误文本;error 状态不粘滞(全员复位)。接棒语义由条目自带(chain=链上/callout=点名回应),callout 在 idle 态合法执行——尾部门闩只看条目语义+世代,不看全局 state。

4. **三概念分离**:适配器(CLI 类型,agents.yaml)≠ 角色(全局资产,characters.json)≠ 成员(角色快照拉入房间,同名精确去重+最小空闲后缀)。

5. **session 复用**:AgentEvent.sessionId → member.sessionIds → 下次 `--resume`;仅 `status === 'error'` 且曾有 sessionId 时清掉重试一次。sessionIds 随 rooms.json 持久化。

6. **持久化复活**:启动读 rooms.json → 逐房 new ChatRoom(注入持久化接缝)→ **await restore() 全部完成后才 listen**。编排运行态不持久化——复活后 idle。store/rooms 的写入经模块级 promise 链串行化(防读改写交错丢更新)。

7. **前端**:WS 连 `/ws`(vite 代理按路径前缀匹配,根路径连不中——曾致全推送静默失效);消息列表为权威,roomState 整快照替换且顺带清理流式缓冲;@提及在输入框弹微信式候选(mentions.ts 单一解析真源,气泡高亮同源)。

## v1 血泪教训(勿回退,改动前必读)

- **prompt 一律走 stdin**,绝不进命令行参数——`shell:true` 下多行 prompt 被换行符截断
- **进程终止必须用 killTree**(taskkill /T /F)——child.kill() 只杀 cmd 壳;且 cancel 后 close 事件可能永不到达,done 需 2s 兜底 resolve
- **spawn cwd**:绑定项目→项目根;否则隔离临时目录(必须 mkdirSync 否则 ENOENT)
- **durationMs 只能由 harness 计时**——适配器硬编码 0 + `??` 不对 0 生效 = 恒显 0.0s
- **队列必须是单消费者循环**,不能用链式 `.then(run, run)`——微任务级联并发穿透双进程
- **cancel 必须可区分且不可重试**——cancelled 不是失败;半截消息落占位(“(已停止思考)”)而非静默消失
- **成员名匹配最长命中**——@工程师3 不能命中"工程师"(v1 实测抢答事故)
- **不要用魔法文本当内部指令**——v1「开始」按钮发 '@free' 文本,parseUserCommand 删掉 @free 分支后按钮静默变坏(点名失败+取消编排)。UI 动作 = 显式方法调用
- curl 在 cmd 下发中文 JSON 会编码损坏,测试用 python urllib + UTF-8 文件体
- **spawn 后 stdin 必须挂 error 监听**(纯吞即可)——CLI 秒退时大 prompt 的异步 flush 落在已关闭管道上触发 EPIPE,无监听器的流 error = uncaughtException = 整个 server 崩溃;失败判定由 close(code) 权威负责,EPIPE 只是冗余回声

## 测试

- `server/tests/orchestrator.test.ts`:29 场景(fake adapter 按 member 脚本化 + Math.random mock 确定性)——接棒链/冷启动随机/点名待命/待命者起头/`<接棒>`用户指令/@allN轮流/轮流中 stop/世代隔离/error→idle/cancel 占位与不重试/resume 自愈/幽灵成员/预算重置+待命承接/旧语法兼容
- `baton.test.ts`:`<接棒>`/旧【接棒】双语法解析断言 + 成员名匹配;`rooms-store.test.ts`:持久化往返
- `summary-compact.test.ts`:上下文压缩层——链式摘要输入断言/私聊绝不进公聊摘要/纪要增量喂入+锚点失效丢弃/注入视窗活跃线程豁免/心跳 prompt 锚点校验/compact 计数收口(41 触发 40 不触发/stateless 跳过/私聊仅当事人)
- 改 orchestrator 必须同步改测试(该文件是并发 bug 的唯一防线)

## 已知边界(v2 接受)

- codex/gemini 适配器零实测(标 experimental);gemini 无 trace/session 上报
- 房间删除后 JSONL 历史文件保留(不 GC)
- 编排运行态不持久化(重启后接棒链/轮次/待命接棒者不自动恢复,发消息重新驱动)
