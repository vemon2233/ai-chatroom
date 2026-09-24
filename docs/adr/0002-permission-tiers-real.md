# ADR-0002:权限三档真实化(--disallowedTools 硬闸)

日期:2026-09-24
状态:已接受

## 背景

实测发现权限档位失真:claude 适配器把 readonly 翻译成 `--allowedTools "Read Glob Grep"`——但该参数是**预批准清单**(列出的免确认)而非**限制清单**,挡不住清单外的工具;叠加用户全局 `~/.claude/settings.json` 的 `permissions.defaultMode: bypassPermissions`,spawn 出的 CLI 闸门全拆 → readonly 房间 agent 实测可写文件可跑命令,hack.txt 真实落盘。gemini/qwen 当时连权限参数都不传。

任务模式以权限档位为日常旋钮(full 默认),失真档位使"派出去的 agent 能干什么"预期错误——修复是前置依赖。

## 决策

1. **claude 适配器三档加 `--disallowedTools` 硬拒绝清单**(与 --allowedTools 并存):
   - readonly: disallow = Write Edit NotebookEdit Bash Task Agent KillShell WebFetch WebSearch
   - readwrite: disallow = Bash Task Agent KillShell WebFetch WebSearch(真·文件读写,无命令无网络)
   - full: 不限制
   - 实测依据:--disallowedTools 使工具从会话移除,写入被硬拦,且不受全局 bypassPermissions 影响。
2. **WebFetch/WebSearch 仅 full 档可用**:Read 不限路径的前提下,网络是数据外发唯一出口,readwrite 及以下关闭;要查文档的任务明示用 full。
3. **Task/Agent 子代理工具全档拒绝**(readonly/readwrite;full 本就不限):任务房 agent 本身就是被派的,再派孙 agent 属失控面扩大。
4. **extraArgs 白名单**:角色卡导入/建房/拉角色三处只放行 `--model` 与 `--thinking-budget`(带格式校验),其余拒绝并警告——堵住"角色卡夹带 --dangerously-bypass 私货参数"的命令行注入面。
5. **权限说明文案修正**:promptTexts 的 r.permReadonly/Readwrite/Full 按真实语义改写,agent 侧宣称与 CLI 实际行为对齐。
6. qwen(--approval-mode plan/auto-edit/yolo,三档实测)、gemini(同形 flag,按文档)、codex(--sandbox,零实测)维持既有翻译,已有 adapter-permissions.test.ts 行为锁。

## 已知边界(接受)

- **三档管工具种类,不管路径范围**:Read/Write 均不按 cwd 限制——readonly 能读全盘,readwrite 绝对路径能写项目外。CLI 无正向路径白名单参数;路径约束靠任务 prompt 约定("工作仅限项目目录"),硬边界(OS 级沙箱)留待真出事再上。
- claude 的 readwrite 档拒 Bash 后,任务房默认档取 full(跑测试刚需),UI 明示"完全权限"。

## 实现约束(grill-you 审计补记:超时轨道)

**超时默认关闭(无上限),agents.yaml 留全局配置项 + 房间可调,用户手动启用才生效**——保守默认,不替用户做主。

**启用后,超时必须实现为 cancelled 语义,严禁走 error 轨道**。证据:orchestrator.invokeWithRetry 对 `error + resumeSessionId` 的自愈会 **delete member.sessionIds 并自动全量重试**(orchestrator.ts:943-955)——若超时复用 error 路径,session 被清(违反"超时不清 session")+ 自动重跑(违反"停止等用户")。

正确实现:harness(proc.ts)加可配置计时上限,超时触发 cancel(killTree);`SpeakOutcome` 加 `timedOut?: boolean` 区分"用户主动停"与"超时停";orchestrator 按 timedOut 换占位文案("(超时已停止,可重发继续)")。cancelled 轨道已验证的保证(不清 session/不重试/保留半截正文)全部继承。
