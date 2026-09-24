# 01: 权限三档真实化

**What to build:** readonly 房间的 agent 真的写不了文件、跑不了命令;readwrite 真的只有文件读写(无命令无网络);full 明示全开。用户在任意房间切档位,agent 的实际工具面与档位宣称一致(实测级验证:readonly 房尝试写文件被 CLI 硬拦)。

依据 ADR-0002:claude 适配器加 `--disallowedTools` 硬闸(readonly: Write/Edit/NotebookEdit/Bash/Task/Agent/KillShell/WebFetch/WebSearch;readwrite: Bash/Task/Agent/KillShell/WebFetch/WebSearch;full: 空)。promptTexts 三档权限说明文案按真实语义改写(zh/en,zh 侧同步既有测试断言)。qwen/gemini/codex 既有翻译不动。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] claudePermissionArgs 三档产出 disallow 契约参数,纯函数测试断言(adapter-permissions.test.ts 扩)
- [ ] readonly 档实测:绑项目的 readonly 房让 agent 尝试写文件,CLI 层拒绝(文件不落盘)
- [ ] readwrite 档实测:写文件成功、Bash/联网被拒
- [ ] promptTexts 权限文案 zh/en 与档位实际行为一致,既有断言同步
- [ ] typecheck + 全量测试绿
