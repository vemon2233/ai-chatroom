# 功能设计结论(青问汇总)

> 2026-09-03 经 /grill-me 逐项决策。已砍项不再列入。实施前如与代码冲突,以此文档为准回溯决策。

## 一、已砍功能(勿再提议)

| 功能 | 理由 |
|---|---|
| 决议/待办尾行标签 | 不需要(经解释后砍) |
| 房间模板/场景预设 | 用户手动建房已够 |
| 角色开场白 firstMessage | 角色扮演向,与工作台定位不符 |
| 围观链接(只读分享) | 无分享需求,导出 markdown 即可 |
| MCP 门面(跨机器 agent 加入) | 现在不做;MIT ≠ 功能可用,真要做时借鉴 Agent Room 协议自建 |

## 二、定案功能

### 1. 角色/房间导入导出

- **格式**:原生 JSON(直接导 characters.json / rooms.json 条目,无信封)
- **角色导出**:Character 条目原样
- **房间导出**:只导 RoomConfig(含成员快照),**不含聊天记录**(历史从零开始)
- **导入冲突**:自动加后缀(复用 `dedupeName`),导入永不失败
- **导入房间成员**:快照原样导入,**不回写角色库**(保持现有快照语义)
- **用户绑定剥除**(见 §3):导出含 `userMemberId`/`isUser`,导入时剥标记、置空指针

### 2. 用户人设(Persona)与角色绑定

- **形态**:用户人设 = 普通 Character(存在角色库,无 isUser 标记——**标记只在房间侧**)
- **绑定机制**:
  - 用户可不绑定(维持现状 `fromName:'用户'`),也可绑定角色
  - 绑定 = 把该角色卡拉进房间成为**普通成员**(复用 addMembers 快照),`MemberConfig.isUser = true`
  - `RoomConfig.userMemberId` 指向该成员
- **隔离规则**(所有递成员列表处过滤):
  - 编排器永不选 TA 发言:随机起头 / @allN 预入队 / parseBaton 匹配(见下例外)/ pendingNext 校验
  - 前端 @ 提及候选(mentions.ts)+ 后端 parseUserCommand 都排除 isUser 成员
  - **例外**:agent 接棒写 `<接棒>@用户角色名` = **接棒给用户 = 编排停止回 idle**,提示「xx 把话题交还给了你」(接棒给用户是合法终止方式)
- **发言归属**:`from` 恒为 `'user'`,fromName 显示角色名(绑定后);prompt 参与者列表里用户成员**混在其他 agent 参与者中,不单独标注**
- **作用范围**:persona 只给 agent 看(注入参与者描述),不改写用户发言
- **换绑**:成员随绑随换(移除旧用户成员+拉新卡+更新指针);历史消息 fromName 不回改
- **用户成员无 sessionIds**(永不调 CLI)

### 3. 管理员(Scout 改名扩职)

- `scout.ts` → `admin.ts`,「🔍 侦察员」→「管理员」
- **架构不变**:内置角色、不占成员席、不被编排选中、agents.yaml 的 scout 段改名 admin 段(便宜模型+超时+熔断闩)
- **职责**:① 项目预分析(原侦察,原样) ② 讨论摘要(新)
- **后续可能有更多任务**:但**先不预设能力清单架构**,简单改名加摘要,任务来了再加

### 4. 讨论摘要(管理员职责二)

- **触发**:自动 + 手动双入口
  - 自动:agent 发言前检查,窗口外(40 条)有未摘要旧消息 → 管理员生成摘要
  - 手动:用户发 `@管理员 摘要`(与 @成员名 同源语法,特判不进编排队列)
- **存储**:摘要作为 admin 消息**落聊天流**(from='admin',系统式),持久化 JSONL、重启还在、buildPrompt 自动注入(复用侦察报告注入逻辑)
- **语义**:prompt 层替代——每次新摘要覆盖旧摘要在 prompt 中的地位(prompt 注入「最新摘要+近窗口」),旧消息**不删**(UI/导出仍见完整历史)
- **失败**:退化为现状(只看 40 条),不阻塞发言;熔断闩复用

### 5. markdown 导出(聊天记录→文档)

- **形态**:纯机械 markdown(无 AI 摘要版),前端拉 messages 后 Blob 生成 .md 下载
- **后端零改动**,不落 data/exports/
- 与「房间导出(JSON,只导配置)」是**两个独立功能**:前者导聊天记录文档,后者导房间配置

### 6. 简易重roll与回溯编辑(原 B4 分支树暂缓,采用轻量截断方案)

> **决策变更(2026-09-04)**: 原定基于 Vue Flow 的完整 Git 式分支树(多分支并行、树编辑器、拖拽 graft 嫁接)暂缓搁置，优先落地**简易重roll与回溯编辑**，满足最核心的“悔棋修话、截断重跑”诉求。

**交互与 UI**:
- 每个对话气泡(MessageBubble)增加编辑/重roll icon 按钮。
- 点击按钮后，该条消息进入编辑状态(或填入输入区域进行修改)。
- 触发动作时，**舍弃该条消息之后的所有对话**(单线性截断，彻底回溯)。

**编辑与发送语义**:
- **用户消息编辑重发**: 舍弃后续消息后，以新内容重新作为用户发言发送，正常驱动编排状态机。
- **AI Agent 消息编辑重发**: 
  - **允许用户直接编辑 Agent 发送的内容**。
  - 用户确认修改并发送后，该消息**依旧显示由原 Agent 发送**(保留原 `from` 和 `fromName`)，文本替换为编辑后的内容。
  - 舍弃后续所有消息后，更新该条记录，按该发言的接棒尾行(若有)重算或等待后续指令。
- **编排互斥**: 仅编排处于 `idle` 状态时允许操作(编排中按钮置灰，防止并发写穿与竞态冲突)。

**后端与持久化存储**:
- 单线性截断与更新: 内存 `messages` 截断至目标位置(或替换目标位置消息并截断其后)，持久化 JSONL 同步重写该房间的历史记录。
- WebSocket 广播: 广播消息列表更新/重置事件，前端权威列表同步更新。

---

### 6b. [暂缓] 完整分支树(Git 式分支树与树编辑器)

> 暂缓实施，待简易重roll满足不了复杂平行推演诉求时再行重启。原设计保留备查：
- `ChatMessage` 加 `parentMessageId`，通过 parent 链重建视图。
- 独立 Vue Flow 树状图拖拽面板，支持重指与 graft 嫁接。

### 7. 成本仪表盘(轻量版)

- 纯前端聚合已落库的 `detail.usage.costUsd/durationMs`
- 侧栏或设置面板加成本区块:按房间总花费/各成员花费
- 后端零改动

## 五、国际化 i18n(第二轮青问定案)

- **范围**:**前后端都做**(UI 文案 + 后端系统消息 + prompt 模板;代码注释不翻)
- **系统消息机制**:消息码+参数——`ChatMessage` 加 `code` + `params` 字段(如 `member.joined` + `{name}`),JSONL 落库只存码+参数,前端按当前语言渲染;**无 code 的旧消息回退显示 text 字段**(存量兼容)
- **prompt 语言**:**随 UI 语言**(zh 用户→中文 prompt→agent 中文辩论;en 用户→英文 prompt)。切换**下次发言生效**(进行中的编排不打断,接受同场混说)
- **接棒语法双语**:`<接棒>` 中文模式 / `<pass>` 英文模式,parseBaton 双语法并列识别(与现有【接棒】兼容层同构);用户输入语法 `<pass>@name` 同理
- **语言包**:前后端**共享一套** `server/locales/{zh-CN,en}.json`(单一真源;前端 vite import,后端 node read——沿用 @server/types 跨包 import 惯例);vue-i18n 做前端
- **不翻译**:角色 persona / 历史消息 / 用户输入原样进 prompt(模板框架文字才走语言包)
- **测试义务**:parseBaton `<pass>` 双语法断言(进 baton.test.ts);系统消息码往返(rooms-store/transcript 测试);语言包键完整性(缺键检测)

## 六、聊天软件桥接(第二轮青问定案)

- **平台**:**Telegram + 飞书**(各一份桥实现,共享基建;钉钉/企微不做)
- **形态**:**独立 workspace 包 `bridges/`**(单独进程,WS 客户端 + REST 调用者,对 server 零侵入;pm2/任务计划常驻,不进 npm run dev)
- **能力**:**直接双向**——群消息 → `/say` 进房间;房间消息 → WS 监听转发进群(过滤外部用户自己那条防回环)
- **绑定**:bridges/config.yaml **静态绑定**(平台会话 chatId → roomId + allowlist),改配置重启桥
- **群友身份**:**用户名透传**——群里「张三」发言进房后显示 `[张三(飞书)]`,agent 可区分不同群友(依赖 userSpeak fromName 改造,比 B1 人设绑定轻:只是名字标签不拉成员)
- **群内命令**:`/stop` `/members` `/rooms` 三个(防刷屏命令不做;群内失控回网页操作)
- **长消息**:超出平台上限**自动切分**连发,标 `(2/3)`
- **安全**:双门槛——**allowlist**(配置列出的平台用户名才可发言)+ **限流**(单房间每分钟条数上限,超出提示稍后)
- **代理**:用户已有代理环境;TG 走 env 代理变量(HTTPS_PROXY,bridges/.env 不进 git),飞书直连
- **agentEvent 不转发**:只转发最终消息(type:'message'),thinking/trace 流不进群

## 七、并行发言(第三轮青问定案,后并入订阅模式——见 §7b)

> **架构演进**:第四轮青问推翻了「并行独立成功能」的设计——并行、私聊、意愿自评统一收编进**订阅模式**(§7b)。本节保留原始决策中仍然成立的部分(波次执行基建、容错、规模上限),触发入口改为「订阅模式专属」。

**仍然成立的部分**:
- 波次执行:单消费者循环学会波次 dispatch(`Promise.allSettled`),驱动权仍在循环
- cancelCurrent 单数 → cancel 函数集合(stop 全杀)
- 波内容错:各自容错(一个挂不废整波)
- 规模上限:房间成员数即上限
- @allN 不变:临时轮流,两模式通用

**被订阅模式取代的部分**:
- ~~多 @ 即并行~~ → 多 @ 并行仅在订阅模式下可用(串行/并行由用户在订阅模式设置中选择)
- ~~波内禁接棒、答完回 idle~~ → 订阅模式下无接棒链概念,发言循环由意愿评估驱动

## 7b. 订阅模式(第四轮青问定案,推翻私聊原设计)

**核心重构:房间只有两种基础讨论模式**

| | 接棒模式(默认,现状) | 订阅模式(新) |
|---|---|---|
| 谁决定发言 | 发言者尾行 `<接棒>@xx` 指定下一位 | 每个 agent 自评发言意愿 |
| 并行发言 | ❌ 不引入 | ✅(多@即并行 + 意愿过阈多agent) |
| 私聊 | ❌ 不允许 | ✅(`<私聊>@A @B` 受众尾行) |
| @allN 临时轮流 | ✅(用完回原模式) | ✅(用完回原模式) |

**订阅模式运作循环**:
1. 每条消息(用户或 agent 发言;系统/管理员消息除外)后触发一轮全员意愿评估
2. 每个 agent 用**自己的 CLI**(同 adapter、带 persona、轻量 one-shot、**不 resume 主 session** 防污染记忆)自问:「你是 X,看到最新讨论,你想发言吗?0-100」——只输出数字
3. 意愿 ≥ 阈值(默认 60,可配)的 agent 发言;不过阈者沉默
4. 发言者可带 `<私聊>@A @B` 尾行指定受众(该条发言仅受众可见);不写 = 公聊全员可见
5. 发言后又触发下一轮评估……循环
6. **双闸门终止**:某轮全员意愿都低于阈值(自然冷场)→ 停,回用户;**或**自动轮数硬顶(chainBudget 复用)兜底——任一先到即停

**同一轮过阈者并发**:串行(按意愿强度降序,后者能看到同轮前者发言,交锋强)**或**并行(互不可见,各自表态)——**用户在订阅模式设置中选择**,默认串行

**私聊 = 受众标记的发言**(不再是独立机制):
- agent 侧:发言尾行 `<私聊>@A @B` → 仅 A、B 的 prompt 可见该消息
- 用户侧:输入框同语法;UI 面板(勾选受众)后续迭代
- 数据模型:`ChatMessage` 加 `audience?: string[]`(memberId 数组;空 = 公聊)——**尽先进 types.ts,JSONL 前向兼容**
- buildPrompt 组装每个成员历史时按 audience 过滤(用户消息+系统+公聊+TA 在受众内的私聊)
- UI:私聊消息渲染「仅 X、Y 可见」样式(折叠或标记)

**意愿评估实现细节**:
- 每次评估 = 每 agent 一次独立 CLI 调用(oneShotSpeak 同款:超时必杀+熔断闩)
- 评估失败/超时/熔断 = 视为不过阈(保守不发言)
- 成本提示:每条消息后 N 次评估调用,长会话累计不便宜——UI 应显示评估调用计数

**模式切换**:
- UI 显式选择器:房间设置「讨论模式」两档(接棒|订阅)——UI 动作 = 显式方法调用(v1 教训)
- `/mode subscribe` / `/mode baton` 命令语法同步提供(桥/手机可用)
- 切换时若编排进行中:先 stop(bump 世代)再切

**状态机重构**:
- 现有 `idle | baton | roundrobin` 之上加房间级 `mode: 'baton' | 'subscribe'` 持久化字段(RoomConfig)
- roundrobin 结束后回到**当前 mode 的语义**(不再写死 idle→接棒)
- 订阅模式下 `<接棒>` 尾行剥掉(无链概念);接棒模式下 `<私聊>` 尾行剥掉(不允许私聊)

## 八、实施顺序建议(更新)

| 批次 | 内容 | 依赖 |
|---|---|---|
| B1 | 导入导出(角色/房间)+ 用户人设绑定(isUser 全链路过滤)+ userSpeak fromName 参数化(桥友透传复用) | 无;types.ts 加字段先行 |
| B2 | Scout→管理员改名 + 讨论摘要(自动+手动) | B1 无依赖可并行;复用 admin 基建 |
| B3 | markdown 导出(前端 Blob)+ 成本仪表盘 | 零依赖,随时可插 |
| B4 | 简易重roll与回溯编辑(气泡操作icon→单线性截断→编辑重发/替换原Agent发言) | 原复杂分支树暂缓;轻量快速落地 |
| B5 | i18n(共享语言包→前端 UI→后端系统消息码→prompt 模板→<pass> 双语法) | 不锁顺序;但系统消息码越早做 JSONL 存量越小 |
| B6 | bridges/(WS+REST 基建→飞书桥→Telegram 桥→限流 allowlist) | 依赖 B1 的 fromName 参数;平台应用凭证自备 |
| B7 | 订阅模式(mode 字段→意愿自评循环→私聊受众→并行波次→模式选择器) | 改动集中在 orchestrator+prompt,复用 oneShotSpeak/熔断基建;`ChatMessage.audience` 字段尽先进 types |

> B1 的 `userSpeak(text, opts?: {fromName})` 是 B6 用户名透传的直接前置,做 B1 时一并参数化。

## 八、关键文件落点(实施时对照)

- `server/src/core/types.ts`:MemberConfig.isUser / RoomConfig.userMemberId
- `server/src/core/room.ts`:userSpeak fromName 分支 / 绑定解绑方法 / dedupeName 复用(导入) / 消息截断与重发接口
- `server/src/core/orchestrator.ts`:选人过滤(随机/@allN/parseBaton 待命)/ 接棒给用户=停止
- `server/src/core/prompt.ts`:参与者列表(用户成员混入)/ 摘要注入(仿侦察报告段)
- `server/src/core/scout.ts` → `admin.ts`:改名+摘要职责+熔断复用
- `server/src/server/config.ts` + `config/agents.yaml`:scout 段→admin 段
- `server/src/server/routes.ts`:导入导出 REST / @管理员 特判 / 回溯截断与编辑重发 API
- `server/src/store/transcript.ts`:截断后重写该房间 JSONL
- `web/src/mentions.ts` + orchestrator.parseUserCommand:@候选排除 isUser(双侧契约同步改)
- `web/src/components/`:导入导出按钮 / 成本区块 / 消息气泡编辑/重roll icon 按钮与编辑态
- `server/locales/{zh-CN,en}.json`:共享语言包单一真源(UI 文案+系统消息码+prompt 模板)
- `bridges/`:独立包——config.yaml 静态绑定 / ws 客户端 / 飞书+TG 双桥 / allowlist+限流 / 长消息切分
- 订阅模式:`RoomConfig.mode`(baton|subscribe)、意愿评估(oneShotSpeak 复用)、`ChatMessage.audience`、buildPrompt 受众过滤、`/mode` 命令解析(routes 层,非魔法文本进 orchestrator)

## 九、测试同步义务

- orchestrator.test.ts:isUser 过滤场景(随机不中/@allN 不含/接棒给用户=停/切分支重算 pendingNext);**订阅模式场景**(意愿过阈发言/不过阈沉默/双闸门终止(全员低阈停+轮数顶)/评估失败=不发言/串行按意愿降序/私聊受众过滤(BC 看得见 D 看不见)/接棒模式下私聊尾行被剥/@allN 用完回订阅模式/mode 切换先 stop)
- baton.test.ts:parseBaton 匹配 isUser 成员 → 停止语义;`<pass>` 英文语法断言
- rooms-store.test.ts:导入导出往返 / userMemberId 剥除 / parentMessageId 持久化 / 消息码落库往返
- 分支树新测试:树重建 / graft 指针重指 / 重roll 同 trigger
- bridges 测试:回环过滤(用户自己那条不转发)/ 限流窗口 / 长消息切分边界(4096)
- 语言包键完整性:缺键检测(zh/en 键集一致,CI 可查)

## 十、后端架构优化演进规范(2026-09-04 架构审计定案)

> **原则**: 核心状态机与进程管控底座扎实，**严禁推倒式重构**。在后续业务批次(B1/B4)推进过程中，以“顺手微创演进”的方式逐步落地以下 4 项优化，消除隐性架构债务。

### 1. 路由解耦与控制器拆分(Eliminate God Router)
- **现状**: `server/src/server/routes.ts` 集中平铺了所有模块的裸正则匹配与参数提取，随功能增加极易迅速恶化。
- **演进目标**:
  - 抽取统一的错误处理、请求解析与 JSON 响应封装中间件。
  - 按业务域拆解控制器: `controllers/room.controller.ts`、`character.controller.ts`、`adapter.controller.ts`、`message.controller.ts`。
  - 路由定义结构化，参数合法性集中校验，消除重复的手写判空与 400 响应。
- **建议落地时机**: 配合 **B1**(导入导出/用户绑定)与 **B4**(回溯截断 API)共同重构。

### 2. 存储层分片写锁与内存分页(Sharded Isolation & Memory Hygiene)
- **现状**: 
  - `store/rooms.ts` 共用单模块级 `writeChain`，所有房间的配置与 sessionIds 写穿互锁阻塞。
  - `ChatRoom.messages` 启动全量加载并永久驻留内存，无法应对超长会话。
- **演进目标**:
  - **按房间分片互斥锁(Keyed Mutex)**: `withRoomLock(roomId, fn)`，房间 A 写穿不阻塞房间 B。
  - **内存热数据分页**: 内存仅驻留最新 $K$ 条热记录(满足实时流展示与 40 条 Prompt 上下文裁剪)，更早历史按需从 JSONL 流式读取。
- **建议落地时机**: 配合 **B4**(简易回溯截断与 JSONL 重写)一同落地。

### 3. WebSocket 广播由“全量扇出”升级为“房间频道订阅”(Channeling)
- **现状**: `MessageBus.broadcast` 对所有在线连接无差别发包，导致挂在房间 A 的客户端频繁收到房间 B 产生的高频 `agentEvent` 流式增量包，浪费网络带宽与主线程算力。
- **演进目标**:
  - 客户端连接后发送 `{ action: 'subscribe', roomId }` 进行频道订阅。
  - 全局事件(`rooms` 列表变更等)全员广播; 房间私有事件(`agentEvent`、`message`、`roomState`)**仅推送给订阅了该 roomId 的客户端**。
- **建议落地时机**: 配合 **B6**(外部桥接开发时对 WebSocket 性能要求提升)或作为独立质量优化项。

### 4. 适配器启动期探针与跨端共享契约(Health Check & Parity)
- **现状**:
  - `agents.yaml` 中配置的 CLI 若未安装在系统 PATH 中，服务启动不报警，直到 Agent 第一次发言 spawn 失败才暴露。
  - 前端 `mentions.ts` 与后端 `orchestrator.ts` 的 `@` 解析正则为双侧独立维护，存在漂移隐患。
- **演进目标**:
  - **启动期探针**: `server/src/server/index.ts` 启动时对已启用的适配器执行轻量 `--version` 探针检查，不可用时提前警告并置灰。
  - **跨端共享契约**: 提取纯数据模型与正则规范，保证前后端对 `@` 指令与接棒语法的解析单一真源。
- **建议落地时机**: 配合 **B5**(i18n 多语言语法对齐)一并固化。
