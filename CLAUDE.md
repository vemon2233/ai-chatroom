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

改后端代码 tsx watch 自动重启。前端 dev 模式热更新;生产模式需 `npm run build`。

## 架构

```
server/src/
├── core/
│   ├── types.ts          领域类型(Character/MemberConfig/ChatMessage/RoomConfig/RoomState)
│   ├── orchestrator.ts   ★ 编排状态机:idle/baton/roundrobin + 单长驻串行队列 + 世代计数器
│   ├── room.ts           ChatRoom 薄门面(成员管理/消息出口/依赖装配;一切调度委托 orchestrator)
│   ├── scout.ts          oneShotSpeak(超时必 clearTimeout+cancel)+ Scout 熔断闩
│   ├── prompt.ts         buildPrompt/parseBaton/matchMemberByName(最长命中)
│   ├── projectContext.ts 目录树采集(5min 缓存)
│   └── bus.ts            WS 广播 + JSONL 落库钩子
├── adapters/
│   ├── base.ts           AgentAdapter 契约 + SpeakOutcome{ok|error|cancelled}
│   ├── proc.ts           spawn 六件套 harness(stdin 纪律/killTree/cwd 隔离/统一计时)
│   ├── claude.ts         权限参数映射 + session resume(实测过)
│   └── codex/gemini.ts   ⚠️ experimental,零实测
├── server/               HTTP+WS:routes(REST)、config(agents.yaml)、index(启动含房间复活)
└── store/
    ├── rooms.ts          data/rooms.json(原子写 temp+rename,EPERM 重试)→ 重启复活
    ├── transcript.ts     data/rooms/*.jsonl 聊天记录
    └── characters.ts     data/characters.json 角色库(首启种子 6 个)

web/src/  Vue3:api.ts(fetch)/ws.ts(重连)/store.ts(reactive,消息列表权威)
          components/:Sidebar/RoomView/MemberBar/ChatFlow/MessageBubble/TraceDetail/Composer/SettingsPanel/三个 Modal
```

### 核心数据流

1. **发言链路**:用户消息 → `/say` → `ChatRoom.userSpeak`(入库)→ `Orchestrator.onUserMessage`(解析 @)→ 串行队列出队 → `runOne`(可选 Scout 预检)→ `buildPrompt`(人设+房间+项目上下文/侦察报告+40条历史+触发语+接棒规则)→ `invoke`(适配器 speak,stdin 喂 prompt)→ 事件流(trace/thinking/sessionId 捕获)→ 落库 JSONL + WS 广播 + rooms.json 写穿 → 接棒条目则尾部解析 `【接棒】@名字` 决定下一位。

2. **@语法**(每条消息驱动,模式不锁死):
   - `@成员名` = 一问一答(bump 世代取消未开始条目,答完回 idle)
   - `@allN` = 轮流 N 轮(预入队全部条目:辩手×N + 主持人轮末小结 + 终局总结)
   - 无 @ = 接棒模式(默认常态;冷启动首成员起头)
   - 接棒失败语义:发言者没写有效接棒行 → **停止,控制权回用户**(无轮询兜底)

3. **状态机**:`idle | baton | roundrobin`。队列唯一消费者是单个长驻 async 循环;世代计数器(generation)让 stop/@allN/@name 天然作废一切过期条目;接棒解析只在 invoke 尾部且校验世代未变。**任何 error → idle,绝不解析错误文本**。

4. **三概念分离**:适配器(CLI 类型,agents.yaml)≠ 角色(全局资产,characters.json)≠ 成员(角色快照拉入房间,同名精确去重+最小空闲后缀)。

5. **session 复用**:AgentEvent.sessionId → member.sessionIds → 下次 `--resume`;resume 失败自愈:清 sessionId 无 resume 重试一次。sessionIds 随 rooms.json 持久化,重启后接得上。

6. **持久化复活**:启动读 rooms.json → 逐房 new ChatRoom → **await restore()(JSONL 进内存)全部完成后才 listen**。编排运行态不持久化——复活后 idle,用户消息重新驱动。

## v1 血泪教训(勿回退,改动前必读)

- **prompt 一律走 stdin**,绝不进命令行参数——`shell:true` 下多行 prompt 被换行符截断(v1 曾致长发言全部"(无输出)")
- **进程终止必须用 killTree**(taskkill /T /F)——child.kill() 只杀 cmd 壳,CLI 真身成孤儿(v1 曾致误杀用户会话)
- **spawn cwd**:绑定项目→项目根;否则隔离临时目录(必须 mkdirSync 否则 ENOENT)
- **durationMs 只能由 harness 计时**(Date.now()-started)——v1 适配器硬编码 0,`??` 不对 0 生效,恒显 0.0s
- **队列必须是单消费者循环**,不能用链式 `.then(run, run)`——v1 曾在微任务级联中并发穿透,双进程
- **cancel 必须可区分**(SpeakOutcome.cancelled)——v1 stop 后半截垃圾消息照常落库
- **成员名匹配最长命中**——@工程师3 不能命中"工程师"(v1 实测抢答事故)
- curl 在 cmd 下发中文 JSON 会编码损坏,测试用 python urllib + UTF-8 文件体

## 测试

- `server/tests/orchestrator.test.ts`:15 场景(fake adapter 按 member 脚本化)——接棒链/没写接棒行停止/@allN+主持人/轮流中 stop/世代隔离/error→idle/cancel 不落库/resume 自愈/幽灵成员/预算重置
- `baton.test.ts`:v1 移植的解析断言;`rooms-store.test.ts`:持久化往返
- 改 orchestrator 必须同步改测试(该文件是并发 bug 的唯一防线)

## 已知边界(v2 接受)

- codex/gemini 适配器零实测(标 experimental);gemini 无 trace/session 上报
- 房间删除后 JSONL 历史文件保留(不 GC)
- 编排运行态不持久化(重启后接棒链/轮次不自动续跑,发消息重新驱动)
