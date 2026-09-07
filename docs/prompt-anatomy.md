# Prompt 解剖:每个 agent 到底收到什么

> 来源:2026-09-04 会话整理。代码真源:`core/prompt.ts`(buildPrompt)、`core/orchestrator.ts`(trigger 措辞与条目语义)、`adapters/claude.ts` + `adapters/proc.ts`(CLI 包装)、`config/agents.yaml`。
> 改 prompt 结构前先读 §7 三个结构性问题;与 `design-grill-2026-09-03.md`(B5 i18n:prompt 模板将走语言包)有联动。

## 0. 全链路:prompt 是谁、在哪拼的

```
用户消息/接棒传递 → Orchestrator.runOne(entry)
                      ├─ runScout()                 ← 绑项目的房间,首棒前可能先跑侦察
                      ├─ buildPrompt(room, member,  ← ★ prompt 唯一组装点(prompt.ts)
                      │     history, {trigger, instruction, batonMode})
                      └─ invoke → adapter.speak(req) ← prompt 经 stdin 喂给 CLI
                                  claude -p --output-format stream-json ...
```

- trigger 的措辞在 orchestrator 里决定(§3)
- 段落结构在 prompt.ts 里拼(§2)
- CLI 包装在 adapter 层(§1)

## 1. 进程层:包在 prompt 外面的东西

每次发言 spawn 一个独立进程(proc.ts spawnCli):

```
claude -p --output-format stream-json --verbose
        [--resume <sessionId>]              ← 成员第 2+ 次发言时带上
        [--allowedTools "Read Glob Grep"]   ← room.toolPermission 翻译而来
        [...member.extraArgs]               ← 如 --model sonnet
cwd = room.projectPath(绑项目的房)或 %TEMP%\ai-chatroom-speak(隔离)
prompt ← stdin 管道写入(绝不进命令行参数,v1 血泪)
```

要点:

- **agent 看不到 system prompt 层**:persona 不是 system role,是用户 prompt 的第一段——
  它下面压着 CLI 自带的完整 agent system prompt(工具说明、agentic 行为规范)。
  persona 是在跟 CLI 自带指令"抢注意力",所以命令式约束比文学化描写有效。
- **`--resume` 意味着上下文累积**:成员第 N 次发言时,session 里已有前 N-1 次的完整 prompt
  + TA 自己的历史回答,新 prompt 再叠上去(§7 坑 3)。

## 2. Prompt 本体:固定 7 段,`---` 分隔

buildPrompt 按序 push,用 `\n\n---\n\n` 连接:

| # | 段落标题 | 内容 | 来源 | 条件 |
|---|---|---|---|---|
| 1 | `# 你的角色` | **本人 persona 全文** | `member.persona` | 恒有 |
| 2 | `# 房间:{name}` | 房間名 + `讨论主题:{topic}` | RoomConfig | 恒有 |
| 3 | `# 其他参与者` | **每个其他成员的 persona 全文**,每行 `- 名字: persona` | 遍历 members | 有其他成员时 |
| 4 | `# 讨论对象:本地项目` | 分两种(见下) | projectPath + scout | 仅绑项目的房间 |
| 5 | `# 聊天记录(按时间顺序,最新在最后)` | 最近 **40 条**,格式 `[发言者名] 正文` | history | 有历史时 |
| 6 | `# 接棒规则(重要)` | chain/callout 语义 + 候选名单 + 语法 | batonMode | **仅接棒类条目** |
| 7 | `# 现在轮到你发言` | trigger + 固定指令 + 长度约束 | entry + room | 恒有 |

**第 4 段的两个分支**(互斥):

- **侦察报告已存在**(历史上有一条 `from:'scout'` 的消息):项目根路径 + **侦察报告全文**(≤400 字)
  + "不要重复用工具浏览项目,只有报告没覆盖的才单独去读"
- **还没有侦察报告**:项目根路径 + **目录树** + permissionBrief(权限档位→工具能力说明)
  + "需要细节直接用工具读,首次发言前建议先浏览关键文件"

**第 7 段固定拼装**(trigger 在最前):

```
{trigger}                                    ← 10 种变体,见 §3
请直接以你的角色身份发言。不要复述设定,不要使用 markdown 标题,直接说出你的观点/回应。
{lengthBrief}                                ← short:300字内 / normal:600字内 / long:不限
```

**第 6 段全文**(接棒条目才有;chain/callout 只差第一句):

```
这是接棒链讨论,你发完言后由你决定下一位发言者,TA 会立即接着发言。          ← chain
你在回应用户的点名。回应完毕后,由你指定下一位发言者——
讨论将暂停,等用户发话后 TA 才开始。                                        ← callout

发言正文结束后,另起一行写接棒指令(与用户输入语法一致):
- 想让谁接话:最后一行写 `<接棒>@名字`(从:{其他成员名单} 中选)
- 认为讨论已充分收敛、没有继续的必要:最后一行写 `<接棒>结束`
选择依据:谁的观点被你质疑了、谁还没说过话、谁的视角最适合回应你刚才的内容。不要接棒给自己。
```

## 3. trigger 的 10 种变体(编排器决定)

| 场景 | trigger 原文 | batonMode |
|---|---|---|
| 用户 `<接棒>@A` 指定起手 | 用户 指定你起头,请就主题开个头或回应该消息。 | chain |
| 冷启动(纯文本/「开始」按钮,随机选中) | 讨论继续,请你先就主题开个头。 | chain |
| 冷启动(待命接棒者起头) | 同上(由 pendingNextId 优先) | chain |
| 接棒链传递(上一位指定了你) | {上一位名} 指定你接棒。请针对 TA 刚才的发言回应、反驳或补充。 | chain |
| 用户 `@A` 点名 | 用户在聊天中 @了你,请回应用户。回应完在结尾用 \<接棒\>@名字 指定下一位(讨论将暂停等待用户)。 | callout |
| 用户直接指令(气泡按钮) | 用户(房间主人)直接对你说:{原文}\n回应完在结尾用… | callout |
| @allN 普通轮次 | 这是第 N 轮发言。请先亮明你的立场。/ 针对前面发言者的观点进行回应、反驳或补充。 | **无** |
| @allN 轮末位(r>1) | 这是第 N 轮的收尾发言。针对前面发言者的观点进行回应、反驳或补充。 | 无 |
| @allN 终局总结 | 讨论已到最后一轮,这是收场总结(终局发言,没有下一位)。请总结:各方核心观点、分歧点、可能的共识或结论。不要再写接棒行。 | 无 |

(另有"冷场补救"防御性变体,正常路径到不了。)

**@allN 条目没有 batonMode → 看不到接棒规则段**,且落库前会剥掉其输出里惯性写出的接棒行
(orchestrator runOne 的 `batonActive` 剥离分支);反过来,接棒条目的消息正文**保留**
`<接棒>@xx` 尾行入库——所以它会出现在后续所有人的聊天记录段里(这是特性:接棒决策对全员可见)。

## 4. 第 5 段"聊天记录"里到底混着什么

historyText 对 messages 数组**不加过滤**,最近 40 条全量转录。agent 在"聊天记录"里看到:

- 用户消息(含 `@`/`<接棒>` 指令原文)
- 各 agent 的最终发言正文(接棒类消息**带** `<接棒>@xx` 尾行)
- **系统消息**:「🎯 A 把接棒交给 B」「⏸ A 指定 B 接棒…」「已取消之前的指令…」「A 加入了房间」…
- **侦察报告全文**(它是 `from:'scout'` 的正常落库消息)
- 取消占位:「(已停止思考)」或半截正文

看不到的:各成员的 thinking/trace/工具调用过程(只有最终 text)、trigger 原文、usage——
这些只进 `detail`,不进 prompt。

## 5. agent 看不到的东西(心智边界)

- 其他成员的 adapter 类型、extraArgs、模型——只有名字 + persona
- 编排状态、chainBudget、pendingNextId、世代——agent 对"轮次结构"的全部感知
  只来自 trigger 措辞和聊天记录里的系统消息
- 房间的 toolPermission 枚举本身(只见翻译后的 allowedTools 参数 + 文字说明)
- 角色 note、颜色、sessionIds

## 6. 完整示例

(工程师被产品经理接棒、绑项目房间、侦察已完成):

```
# 你的角色
你是资深工程师。从技术可行性、实现成本和风险角度发言。      ← persona 全文

---

# 房间:架构评审
讨论主题:该不该用微服务重写订单系统

---

# 其他参与者
- 产品经理: 你是产品经理。从用户价值、产品定位和商业角度发言。   ← 他人 persona 全文
- 自由人: 你是一般讨论者。观点中立,就事论事,哪里有价值就支持哪里。

---

# 讨论对象:本地项目(侦察报告已有,无需重复探索)
项目根目录:`D:\...`
……侦察报告 400 字……

---

# 聊天记录(按时间顺序,最新在最后)
[系统] 自由讨论开始(接棒模式)……
[🔍 侦察员] ……报告全文第二次出现……
[产品经理] 我认为……           ← 带 <接棒>@工程师 尾行
[系统] 🎯 产品经理 把接棒交给 工程师

---

# 接棒规则(重要)
这是接棒链讨论,你发完言后由你决定下一位发言者……(候选:产品经理 / 自由人)

---

# 现在轮到你发言
产品经理 指定你接棒。请针对 TA 刚才的发言回应、反驳或补充。
请直接以你的角色身份发言。不要复述设定,不要使用 markdown 标题……
发言控制在 600 字以内,论证完整、有理有据,不空泛。
```

## 7. 三个结构性问题(改 prompt 结构时的待办)

1. **侦察报告双重注入**:报告在历史里落库(第 5 段 40 条窗口内全量出现),同时第 4 段
   又专门注入全文(那个 `history.find(from==='scout')` 不受窗口限制)。同一份 400 字报告
   每次 prompt 付两遍钱;窗口挤出后第 4 段仍继续注入。
2. **permissionBrief 注入不一致**:权限说明只在"无侦察报告"分支注入。侦察一旦跑完,
   agent 的 prompt 里再也没有工具能力说明——但 CLI 的 `--allowedTools` 限制仍然生效。
   agent 不知道自己能干什么,试了才被拒。
3. **`--resume` 让历史按轮复利**:成员 A 第 3 次发言时,session 里已有第 1、2 次的完整
   prompt(各含 roster + 40 条历史)+ 回答;新 prompt 再带一份。聊天记录对同一 agent 是
   O(N²) 重复注入,本人 persona 每轮重付。这是 token 大头,比"其他参与者"的 O(N²) 更狠。
   (讨论摘要功能——design-grill B2——落地后可作为历史压缩的载体,与本坑同解。)

## 附:persona 写法结论(同会话讨论)

- ST 的 1000 token 卡片是单角色沉浸 RP 的形态(example dialogue 占大头),不适用本场景:
  persona 在这里是**被乘 N 的头部开销**(本人全文 + 注入每个其他成员),且与 CLI 自带
  system prompt 抢注意力,命令式行为约束 > 文学化描写。
- 推荐形态(80–250 字,五要素):①身份+具体资历 ②评判标准(先看什么)③默认倾向与
  转变条件 ④语言风格+一句示例台词 ⑤禁区。
- 若要厚角色:MemberConfig 拆 `persona`(自用全文)+ `brief`(给他人的一行简介),
  "其他参与者"段注入 brief,成本从 O(N²) 降回 O(N)。
