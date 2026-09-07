# 摘要功能重构方案 —— 上下文压缩层设计文档

> 日期:2026-09-07
> 状态:方案已敲定,待实施
> 范围:server + web;涉及 admin.ts / room.ts / orchestrator.ts / prompt.ts / engine.ts / direct.ts / types.ts / config.ts

---

## 一、对话总结:问题如何被发现,决策如何达成

### 1.1 起点:用户实测发现的三个问题

用户在实测中发现(全部经代码验证属实):

1. **摘要只进入了一个角色的 prompt,没有进入其他角色的 prompt**
   - 根因:摘要注入只发生在 `runOne → buildPrompt` 路径;但订阅模式下的发言主力是心跳驱动,走 `buildHeartbeatPrompt`(engine.ts:318),该函数签名根本没有 summary 参数 → 心跳发言的成员全部"失忆"
   - 心跳 prompt 还只带最近 10 条增量(`recent=10`),长程记忆完全为零

2. **摘要进入 prompt 之后,之前的聊天记录依旧在,prompt 重复**
   - `buildPrompt` 无条件注入最近 40 条原文,而摘要覆盖最近 60 条 → 最多 40 条消息以"原文+摘要"双份进 prompt,纯浪费 token

3. **没有区分接棒模式和订阅模式的摘要差别(订阅模式有 agent 私聊)**
   - `Admin.generateSummary` 拿原始全量消息(含 audience 私聊),摘要复述私聊内容后无差别注入**所有**成员 → 完全绕过了 `filterHistoryForViewer` 的受众隔离,非当事人从此"听见"私聊密信——隐私 bug

### 1.2 关键转折:重新定框

讨论中用户提出:**"这个摘要问题同时也是 agent 上下文压缩的问题"**——摘要不是"展示品顺便进 prompt",而是 **agent 上下文压缩层本身**。设计空间随之重组为决策树:

```
上下文压缩策略
├── D1 压缩算法: 定窗重摘 vs 链式滚动合并
├── D2 触发时机: 纯手动 vs 阈值自动 vs 混合
├── D3 内容边界: 私聊如何处理(公聊 only vs 分角色压缩)
├── D4 注入窗口: 锚点后原文超窗怎么办
├── D5 与 contextMode 分工: stateful 模式的压缩谁来做
├── D6 失效重生成: 截断/清空后摘要怎么办
└── D7 配置面: agents.yaml 加什么
```

### 1.3 逐决策过程

**D1 压缩算法 → 链式滚动合并**
- 现状(定窗重摘)永远只记得最近 60 条,长程压缩不存在——正是"早期讨论对 agent 不可见"的根因
- 选定:**新摘要 = f(旧摘要, 锚点后未覆盖公聊),锚点前移**;三段式结构约束输出形状;漂移风险靠"手动全量重摘"重置阀兜底

**D3 私聊处理(讨论最充分的一条)**

中间方案逐一淘汰:
- "私聊完全不进摘要、活跃线程原文常驻"(A1+线程活性规则)——被否,因为用户指出:**私聊协议 3 轮熔断实际效果不佳,需要修改策略**,私聊不再是"设计上短命"的通道,A1 前提塌了
- "admin 单次调用产 JSON 分段分角色摘要"(B1)——被否,魔法文本路由(从模型自由文本解析归属关系)违反项目 v1 教训,解析失败=静默丢数据/归属错位
- 我推荐的"成员账本+逐对触发+共享纪要"——**用户明确不接受**,提出自己的方案
- 期间用户追问"魔法文本老问题是什么",我误将 B1 的推演说成"老问题",用户指出根本没讨论过——我更正道歉:那是我在决策 3 引入的备选项,非历史包袱

**最终采纳用户的方案(用户拍板):**
- **按成员聚合触发**:A 的私聊总量(A-B + A-C + A-D 所有往来加起来)超过阈值 → 单独调用 **A 自己的 adapter**(带 A 的 persona)总结"它收到的私聊情况"
- 产物 = **一人一份第一人称私聊纪要**("我和 B 商定了 X,但我对 C 隐瞒了这部分")——跨对的策略性信息(结盟/隐瞒/信息差)只有当事人全景视角能保留,逐对切片会丢
- 纪要只注入本人;链式合并(旧纪要作为下次输入)
- 执行形态:**单独调用**(用户确认),不搭车注入下次发言——搭车有滞后(潜水成员纪要无限期不生成)和静默缺失(agent 忘写标签)两个致命失败模式

**D2 触发时机 → 混合**
- 纯手动会在挂机场景退化为"agent 永远看不全早期讨论";纯自动丢掉手动按钮的两个不可替代用途(重置阀/即时快照)
- 选定:公聊消息**落库时**计数检查(锚点后未覆盖公聊 > 30)自动生成 + 手动保留;触发检查放落库点而非 prompt 组装时——admin 故障绝不阻塞发言链路

**D4 注入窗口 → 用户拍板简化**
- 我先提"锚点后全文注入+80 条声明式截断+抢救压缩"的三层方案,用户表示没听懂;拆解重讲后用户抓住问题根源:**"根源是 admin 没把公聊压缩掉,然后怎么办"**——准确
- 用户最终拍板:**不重要,超窗维持现状硬截 last 40**。正常情况压缩活着时锚点后 ≤30 条根本不会触窗,这个问题只在压缩故障时存在,不值得为它建第二套机制

**D5 stateful 模式 → 用户的 compact 洞察(方案最大转折点)**
- 我最初推荐 stateful 维持现状(摘要只在重锚定时注入);用户反问:**"stateful 模式能否触发 compact,这样就不用注入摘要了"**
- 我做了真机实验验证可行性:
  - `printf '/compact' | claude -p --resume <sid>` → **压缩真实发生**(stream-json 里出现完整压缩摘要),一次 $0.12(opus 档)
  - compact **尊重 `--model haiku`** → $0.05/次,成本可控
  - `/compact` 必须走 stdin——走命令行参数会被 Git Bash 路径转换吃掉(再次验证项目"prompt 一律走 stdin"教训)
- 选定 B':stateful 成员压缩交给 CLI 自身,摘要仅重锚定兜底
- **触发时机**:我先提 token 累计阈值,用户追问 token 数怎么换算消息数;推算过程我有算术错误(漏算其他成员消息对 session 体积的喂养),用户抓出后我修正——最终用户拍板:**不搞 token 估算,直接按条数:某 agent 可见的公聊消息+自己的消息超过 40 条就 compact**
- **私聊顺带压缩**:用户发现 compact 会同时压缩公聊和私聊 session 内容,主动提出:**stateful 模式就不单独压缩私聊了**——砍掉 stateful 的私聊纪要机制,一个 compact 动作覆盖全部,实现面减一整块

**D6 失效 / D7 配置 / direct / 前端** —— 无重大分歧,直接敲定(见决策表)

### 1.4 敲定的完整压缩矩阵

| | stateless 成员(默认) | stateful 成员 |
|---|---|---|
| 公聊长程 | 公聊摘要(链式,admin 生成,注入 prompt) | CLI session 自压缩(/compact @ 40 条) |
| 私聊长程 | 私聊纪要(成员聚合>20 条,当事人自总结,只注入本人) | 同一次 /compact 顺带压缩(不单独处理) |
| 注入 prompt | 摘要+纪要+锚点后原文(超窗硬截 40) | 仅重锚定兜底时注入摘要 |
| compact 触发 | — | 可见公聊+自己发言 > 40 条,发言 done 后异步 |

---

## 二、实施方案

### 2.1 决策定案表(实施时勿改)

| # | 决策 |
|---|---|
| D1 | 公聊摘要 = **链式滚动合并**(新摘要 = f(旧摘要, 锚点后未覆盖公聊)),三段式 Markdown 结构,锚点前移 |
| D2 | 触发 = **混合**:公聊消息落库时计数超阈值自动生成(默认 30,`>` 严格大于)+ 手动刷新按钮保留 |
| D3 | 私聊绝不进公聊摘要(只喂 audience 为空的消息);stateless 成员私聊压缩 = **成员聚合阈值(默认 20)+ 当事人 adapter 自总结第一人称纪要**,一人一份,只注入本人,链式合并 |
| D4 | 注入窗口 = 锚点后原文;超窗维持现状硬截 last 40;不做声明式截断/抢救压缩 |
| D5 | stateful 成员不注入摘要(维持现状:仅重锚定时注入);改用 **CLI `/compact`**(条件:可见公聊+自己发言 > 40 条,prompt=`/compact` 走 stdin + `--resume` + `--model haiku`,发言 done 后 fire-and-forget);非 claude kind 跳过;stateful 成员不生成私聊纪要 |
| D6 | 失效 = 锚点消息不在当前历史 → **不注入 + 下次重摘丢弃旧文**(截断/清空是有意删除,旧摘要含已删信息,不得链式继承);旧存量摘要无锚点字段 → 降级照旧注入 |
| D7 | 配置 `summary:` 段(model/autoThreshold/privateThreshold/compactThreshold,0=关);超时熔断复用 admin 段 |
| D8 | 1v1 direct:接入链式+锚点+prompt 注入;保持纯手动刷新;不加 compact/私聊纪要 |
| D9 | 前端:仅修错误形状处理(status=error 不进空态判断);涵盖 N 条绑定不变 |
| D10 | 不做 generating 状态广播;`afterRounds:'finalSummary'` 命名不动 |

实测依据(本机已验证):
- `printf '/compact' | claude -p --resume <sid> --model haiku --output-format json` 可行,压缩真实发生,尊重 --model(haiku 档 $0.05/次)
- `/compact` 必须走 stdin,命令行参数会被 Git Bash 路径转换吃掉

### 2.2 改动清单(按阶段,每阶段 typecheck+test 可过)

#### 阶段 1:类型 + 配置

**`server/src/core/types.ts`**
```ts
/** 成员私聊纪要(第一人称,只注入该成员本人) */
export interface PrivateDigest {
  text: string;
  coveredMessageId: string;   // 锚点:最后一条被纪要覆盖的私聊消息 id
  updatedAt: number;
}

export interface DiscussionSummary {
  // 现有字段不动: text/updatedAt/messageCount/status?/error?
  /** 公聊锚点:最后一条被摘要覆盖的公聊消息 id(旧存量无此字段 = 降级照旧注入) */
  coveredMessageId?: string;
  /** stateless 成员的私聊纪要(memberId → digest;随 summary 文件持久化) */
  privateDigests?: Record<string, PrivateDigest>;
}

/** agents.yaml summary 段;0=关 */
export interface SummaryConfig {
  model: string;             // 摘要/compact 用模型,默认 'haiku'
  autoThreshold: number;     // 公聊自动触发,默认 30
  privateThreshold: number;  // 私聊纪要阈值,默认 20
  compactThreshold: number;  // stateful compact 阈值,默认 40
}
```
MemberConfig **不加**字段(compact 计数/私聊计数是运行时态,放 room.ts 内存 Map)。

**`server/src/server/config.ts`**:AppConfig 加 `summary: SummaryConfig`;loadConfig 照 admin 段 fallback 模式解析(L35-41 旁)。

**`config/agents.yaml`**:追加带注释的 `summary:` 段示例(纯文档,代码有默认值)。

#### 阶段 2:summaryOps.ts 纯函数(新文件)

**`server/src/core/summaryOps.ts`**(锚点/窗口/计数的唯一真源,注入与触发共用):
```ts
/** 有效公聊:非 system、非空文本、无受众 */
export function filterValidPublic(history: ChatMessage[]): ChatMessage[]
/** 按锚点切分;锚点缺失/不在历史 → anchorValid=false, after=全部 */
export function splitHistoryByAnchor(history, anchorId?): { anchorValid: boolean; after: ChatMessage[] }
/** 公聊摘要可注入:有文本;无锚点字段(旧存量)→true;有锚点但不在历史→false(过期) */
export function isPublicSummaryUsable(summary, history): boolean
/** 纪要可注入:同上,用 digest 自己的锚点 */
export function isDigestUsable(digest, history): boolean
/** 锚点后未覆盖公聊条数(自动触发用;锚点无效=全部) */
export function countUncoveredPublic(history, summary): number
/** 该成员未覆盖私聊条数(from=本人或 audience 含本人,纪要锚点后;锚点无效=全部该成员私聊) */
export function countUncoveredPrivateFor(history, memberId, digest?): number
/** 活跃私聊线程判定:threadId 最后一条消息 handshake 非 agree/reject 即活跃 */
export function isPrivateThreadActive(history, threadId): boolean
/** 注入窗口组装(stateless 全量/心跳共用):
 *  锚点后公聊 ∪ 锚点后本人可见私聊 ∪ 锚点前活跃线程私聊(豁免截断),保持原顺序 */
export function buildInjectionWindow(history, viewerId, summary): ChatMessage[]
```

#### 阶段 3:prompt.ts 注入改造

**`server/src/core/prompt.ts` — buildPrompt(L75-157)**
- opts.summary 类型 `string` → `DiscussionSummary`(调用方 orchestrator/direct 同步)
- 注入段(L126-137)重写:
  - `isPublicSummaryUsable` 不过 → 不注入摘要;text 为空的空壳对象(只有 privateDigests)公聊段跳过
  - 原文窗口改用 `buildInjectionWindow(...)` 再 `historyText(window, 40, ...)`(硬截 40 保留现状)
  - 私聊纪要段:`summary.privateDigests?.[member.id]` 且 `isDigestUsable` → 注入 `【你的私聊往来纪要(仅你可见)】` 段
- `buildDeltaPrompt` 不动(stateful 增量照旧)

**`server/src/core/modes/subscribe/prompt.ts` — buildHeartbeatPrompt**
- 尾部加可选参 `summary?: DiscussionSummary`
- 内部:摘要可用时在 `# 讨论主题` 后插【前期讨论摘要】段 + 本成员纪要段;delta 中已被锚点覆盖的消息剔除
- `historyText`/`isSilentDecision`/`buildSubscribePromptSection` 不动

#### 阶段 4:admin.ts 三方法(类名/AdminConfig 不动)

**`server/src/core/admin.ts`**

1. **generateSummary 链式化**:
```ts
async generateSummary(input: {
  messages: ChatMessage[];        // 全量(方法内部 filterValidPublic,私聊绝不进)
  topic?: string;
  prevSummary?: DiscussionSummary | null;
}): Promise<DiscussionSummary | null>
```
- `filterValidPublic` → `splitHistoryByAnchor(valid, prev?.coveredMessageId)`;anchorValid=false(首摘**或锚点失效**)→ **prevSummary 视为 null,全量重摘,丢弃旧文**(D6)
- prompt:三段式结构约束保留;有旧摘要时加`【既有讨论摘要(在其基础上滚动合并更新)】`+ 旧文 + 新未覆盖消息;加长度上限指令(800 字以内,防链式膨胀)
- 成功返回:`coveredMessageId = 本次覆盖最后一条公聊 id`,`messageCount = 本次真实覆盖条数`,`privateDigests = prevSummary?.privateDigests 逐项过 isDigestUsable 后透传`(纪要与公聊锚点独立演化)
- 不再 `slice(-60)`;summaryRunning 互斥/熔断闩照旧(手动与自动并发共享同一次执行,双写幂等无害)

2. **私聊纪要(新)**:
```ts
async generatePrivateDigest(input: {
  member: MemberConfig;
  privateMessages: ChatMessage[];      // 调用方过滤好的该成员可见私聊
  prevDigest?: PrivateDigest | null;   // 链式;锚点失效→视为 null
  adapterEntry: { command: string; args: string[] };  // 成员自己的 adapter entry
}): Promise<PrivateDigest | null>
```
- prompt:`你是【name】\n persona\n 第一人称总结你在本房间的私聊往来:与谁、谈了什么、当前状态/未决事项(500 字以内)`;链式并入旧纪要
- 走 oneShotSpeak + admin 超时;失败计入 summaryFailureCount(与公聊摘要共用熔断)

3. **compactSession(新)**:
```ts
async compactSession(input: {
  member: MemberConfig; sessionId: string; model: string; kind: string;
  adapterEntry: { command: string; args: string[] };
}): Promise<boolean>
```
- `kind !== 'claude'` 直接 return false(codex/gemini 不支持)
- in-flight 互斥:`compactingMembers: Set<string>`;失败熔断:`compactFailureCount: Record<string, number>` ≥ maxRetries 跳过
- SpeakRequest:`{ member, prompt: '/compact', command, args: [...entry.args, '--model', model], resumeSessionId: sessionId, permission: 'readonly' }`——claude adapter 自动翻译 `--resume`;prompt 走 stdin
- 成功后 sessionId 不变,无需回写

#### 阶段 5:room.ts + orchestrator.ts + engine.ts 装配

**`server/src/core/room.ts`**
- 构造函数加 `summaryCfg: SummaryConfig` 参数(**同步两处调用点**:server/index.ts L45、routes.ts L285);adapterConfigs 存为私有字段
- deps.getSummary 改:`getSummary: () => this.currentSummary`(返回对象)
- **pushMessage(L174-177)挂自动触发**(fire-and-forget,绝不阻塞落库):
```ts
private async pushMessage(msg: ChatMessage) {
  this.messages.push(msg);
  await this.bus.emitMessage(msg);
  void this.maybeAutoSummarize(msg);
}
```
- `maybeAutoSummarize(msg)`:
  - 公聊消息且 autoThreshold>0:`countUncoveredPublic > threshold` → generateSummary → 落盘+广播(与 refreshSummary 共用私有 `applySummary(res)`)
  - 私聊消息且 privateThreshold>0 且房间 stateless:对 from+audience 中每个成员查 `countUncoveredPrivateFor > threshold` → `generatePrivateDigestFor(member)`(生成→merge 进 privateDigests→落盘+广播)
- **compact 计数(内存 Map)**:stateful 房间,公聊消息给全体 stateful 成员 +1,私聊给 from+audience 成员 +1
- **maybeCompact(member) 供 orchestrator 发言 done 后调用**:计数 > 40 且有 sessionId 且非 currentSpeaker → 清零 + `void admin.compactSession(...)`
- refreshSummary 改链式传参

**`server/src/core/orchestrator.ts`**
- OrchestratorDeps:getSummary 类型改 `() => DiscussionSummary | null`;新增 `maybeCompact?: (member: MemberConfig) => void`
- runOne ok 分支两处 hook:订阅分支 `markMemberSpoken` 后、接棒分支 `persistRoom` 后调 `maybeCompact`
- 构造 SubscribeEngine 的 speak 回调:ok 后也调 maybeCompact
- 订阅引擎透传:`SubscribeEngineDeps` 加 `getSummaryContext?: () => { summary?: DiscussionSummary | null }`

**`server/src/core/modes/subscribe/engine.ts`**
- runHeartbeatTick:
```ts
const ctx = this.deps.getSummaryContext?.();
const isStatefulResumed = (room.contextMode ?? 'stateless') === 'stateful'
  && !!member.sessionIds?.[member.adapter];
const prompt = buildHeartbeatPrompt(room, member, delta, activeThread, otherMemberName,
  isStatefulResumed ? undefined : ctx?.summary);
```

#### 阶段 6:direct.ts

**`server/src/core/direct.ts`**
- refreshSummary 链式:传 prevSummary(内存 cache ?? 盘上摘要);1v1 无 audience,公聊过滤是 no-op
- generateReply 全量 prompt 路径(stateless 分支与重锚定分支)注入摘要:抽私有 `buildDirectFullPrompt(character, history, summary)`——usable 时加【前期对话摘要】段 + history 换锚点后;增量分支不动
- 保持纯手动刷新,不加自动触发/compact/纪要

#### 阶段 7:前端最小改动

**`web/src/components/chat/ChatInspector.vue`**
- handleRefreshSummary:`res.status === 'error'` 时设 summaryError,**不写** store.currentSummary
- 「涵盖 N 条」绑定不变(messageCount 已是真实覆盖数)
- store/index.ts、WS 事件、api.ts 均不动

#### 阶段 8:测试 + 文档

**改造既有测试**
- `summary-trace.test.ts`:buildPrompt summary 参数改对象形状;generateSummary 调用改对象参数
- `orchestrator.test.ts`:makeHarness deps 不需改(新 deps 均可选)
- `direct-chat.test.ts`/`context-mode.test.ts`:默认无摘要 → 无影响,跑一遍确认

**新增测试(新文件 `server/tests/summary-compact.test.ts`,沿用 fake adapter 模式)**
1. 链式:两次 refreshSummary,断言第二次 admin prompt 含第一次摘要文本;coveredMessageId = 最后一条公聊 id
2. 私聊不进公聊摘要:带 audience 消息 → admin prompt 不含私聊文本
3. 私聊纪要:21 条私聊(threshold=20)→ 成员 adapter 被调(非 admin adapter);A 的 buildPrompt 含纪要、B 的不含
4. 纯函数:splitHistoryByAnchor 三态 / isPublicSummaryUsable 旧存量降级 / countUncovered / buildInjectionWindow 活跃线程豁免
5. 锚点失效:截断掉 coveredMessageId → buildPrompt 不含摘要;generateSummary 视 prev 为 null
6. 自动触发:pushMessage 30+ 条公聊 → generateSummary 调用一次(31 触发/30 不触发边界)
7. compact:stateful+sessionId+计数>40 → oneShotSpeak 收到 prompt='/compact' 且 resumeSessionId 传入;kind='codex' 跳过;in-flight 互斥;发言中不触发
8. 心跳注入:订阅+stateless → heartbeat prompt 含摘要段;stateful+session 存在 → 不含

**`CLAUDE.md`**:架构段补充压缩层一句话(锚点/链式/纪要/compact 四机制 + summaryOps.ts 位置),测试段补 summary-compact.test.ts。

### 2.3 验证

1. 每阶段:`npm run typecheck` + `npm test`
2. 端到端(dev):`npm run dev` → 订阅模式房 3 成员 → 灌 30+ 条公聊 → Inspector 摘要自动出现;trace 里 agent prompt 不再含锚点前原文
3. 私聊验证:促成一对私聊 → 纪要触发后检查 trace:A 的 prompt 含纪要、B 不含、admin 摘要不含私聊文本
4. compact 验证:stateful 成员发言超 40 条可见消息 → 确认 /compact 调用;session 压缩后 input_tokens 显著变小
5. 截断验证:生成摘要后截断历史 → 摘要不注入(trace 确认)、再灌 31 条自动重摘

### 2.4 关键风险与守恒约束

- **改 orchestrator 必须同步 orchestrator.test.ts**(项目铁律,并发 bug 唯一防线)
- maybeAutoSummarize 必须 fire-and-forget(`void`),绝不 await 在 pushMessage 里——admin 故障不得阻塞消息落库
- 熔断闩语义:admin 连续失败 N 次(复用 maxRetries=2)后房间生命周期内不再重试
- 旧存量 data/summaries/*.json 无 coveredMessageId:降级照旧注入,下次刷新自然获得锚点——**不需要数据迁移**
- prompt 一律 stdin(含 /compact)、killTree、单消费者循环等 v1 教训全部维持

---

## 三、实施修正记录(2026-09-07 验收修复)

初版实现经验收发现 4 项与本文档决策的偏差,已全部修复(`summary-compact.test.ts` 有对应用例):

| # | 偏差 | 修复 |
|---|---|---|
| F1 | compact 计数只挂在订阅心跳 publishMessage 单点——用户消息、接棒链发言不计数,导致 stateful 接棒房间 compact 永不触发 | 计数收口移到 `room.pushMessage` → `orch.noteMessageForCompact`(唯一消息收口,全覆盖);顺带:scout 消息排除出计数;`compactingMembers: Set` 升级为 `compactingPromises: Map`,invokeWithRetry 由"轮询 2s 假上限"改为 await compact promise 本身(被 oneShotSpeak 超时上界自然约束) |
| F2 | 私聊纪要生成喂全量该成员私聊,prompt 线性膨胀且"新增"标签名不符实 | 新增 `uncoveredPrivateMessages` 纯函数,只喂纪要锚点后的增量 |
| F3 | 纪要链不校验锚点失效——截断/清空后旧纪要(含已删除私聊内容)继续污染新纪要(公聊侧 admin.ts 有 anchorValid 检查,纪要侧漏了) | 增量切分返回 `anchorValid`;失效时 prevDigest 置 null 丢弃旧链,与 D6 公聊侧语义对齐 |
| F4 | 心跳 prompt 只判 `summary.text` 非空,不校验锚点是否仍在历史——截断后旧摘要继续注入 | `buildHeartbeatPrompt` 加 `fullHistory` 参数:摘要锚点失效→整份不注入;摘要有效但本人纪要锚点失效→仅剔除纪要段;engine 传 allHistory |

