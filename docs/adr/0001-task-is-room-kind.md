# ADR-0001:任务是房间的一种 kind,底层引擎全共用

日期:2026-09-24
状态:已接受(决策史:kind 方案 → 推断方案 → 回归 kind 方案,见"决策史")

## 背景

产品要从"多 agent 聊天室"扩展出"派编程任务给 agent"的形态(每任务一个 agent,绑定项目目录,不同 agent 不同项目)。候选底座:①房间加 kind 字段;②独立 Task 实体;③1v1 私聊改造;④不加字段靠推断(projectPath+单成员)。

## 决策

**`RoomConfig` 加 `kind: 'chat' | 'task'`(可选字段,存量读时默认 chat)。侧边栏在"房间/角色"旁增加"任务" tab——任务在 UI 信息组织中是一等公民。底层引擎(编排器/持久化/WS/trace/统计)全共用,零分叉。**

任务房配置约束:projectPath 必填、mode 恒 baton(建房校验强制)、默认权限 full、默认 contextMode stateful、无 Scout 预检、成员 1 起步可加。

## 决策史(为什么绕了一圈回到 kind)

1. 首议 kind(判据确定性),用户对引入分类持谨慎态度;
2. 退为推断方案(零 schema 变更,拿 90% 价值);
3. 再深挖出统一方案(行为差异归 persona+已有字段,系统无需感知"任务");
4. **最终定 kind**:用户明确要"任务 tab"的一等公民信息组织——任务列表(状态/绑定项目/最后动态)是真需求而非工程师洁癖;且任务功能面(超时保护/状态/成本聚合)持续膨胀,kind 是稳定锚;统一方案的"零分支"是幻觉(前端 tab 筛选照样要判据,只是丢了后端校验与测试把柄)。底层仍是同一套房间机制——kind 只是表皮分类标签,删不掉引擎共用。

## 理由

1. 任务刚需四样(projectPath→cwd/权限字段/成员快照多实例/sessionIds 持久化)房间全有,私聊全无——排除③;独立实体违背"严禁推倒式重构"——排除②。
2. UI 一等公民需求 + 功能膨胀挂靠 → 排除④。
3. schema 成本小:项目已有 mode/contextMode 同类先例(可选字段+默认值),存量零迁移。

## 复用边界(以编排语义为界,不以文件为界——防腐化)

- **不变的是语义机制,不是文件清单**:编排循环/世代计数器/cancel 三态/resume 自愈/compact 防踩踏**零改动**。kind 在 core 的全部足迹 = types.ts 字段 + prompt.ts 教学段族分支 + room.ts scout 跳过;超时经 adapters(proc.ts harness 计时)+ SpeakOutcome.timedOut 标记实现(见 ADR-0002)。
- **警铃**:任何时候想 fork 编排语义(复制 orchestrator/store 文件做"任务版"),即设计腐化信号,回到本 ADR。

## 实施义务(grill-you 审计补记,2026-09-24)

- **超时必须走 cancelled 轨道**:error 轨道会清 sessionIds 并自动重试(orchestrator invokeWithRetry 自愈机制),与"超时停止等用户重发"语义相反。
- **多成员任务房 = 复用既有手动 @ 点名驱动**(定案):零新机制,既有 @ 待命/停止语义原生承载(成员干完即停,用户停止后 @ 下一位)。不教接棒语法,无自动链——不引入"B 未被叫就自动审"的机械轮转。
- **导入 task 房 projectPath 失效 → 降级为 chat 房** + 系统消息警示(定案):不拒绝导入(保"导入永不失败"),不产无项目僵尸(cwd 回落共享临时目录的静默错误)。
- **extraArgs 白名单 = 单一校验函数**,收口全部入口(角色创建/角色卡导入/建房成员/房间导入成员/角色导入),勿逐处内联。
- **i18n 义务**:任务段族进 promptTexts(zh/en 双写,新键不受既有字节锁约束但键集须齐);超时占位消息走 messages.ts A 类;前端任务 tab/表单文案进 zh.ts/en.ts。
- **测试义务**:kind 建房校验(拒绝无 projectPath 的 task 房)/任务 prompt 段族断言/超时路径(cancelled 轨道、不清 sessionIds、不重试)/导入 task 房降级/任务导出含 kind 往返。
- **/model 需新增成员变更路由**(现仅 POST/DELETE members);skills 候选扫描需 server 端点(~/.claude 与项目 .claude 仅 server 可达);/skills 询问复用 instruct 端点。
- RoomSettings PATCH 对 task 房过滤无关字段(subscribeConfig/chainBudget)。

## 后果

- 任务房设置面板条件渲染(隐藏 chainBudget/speechLength/subscribeConfig 等无关项),非从类型删除。
- 私聊保持角色闲聊语义,不做任务能力。
- 权限三档真实化是任务模式前置依赖,另行落地(见 ADR-0002 如有)。
