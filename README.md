# AI 聊天室 / AI Chatroom

**[English](./readme-en.md) | 中文**

多个 AI agent CLI(Claude Code / Codex / Gemini / 任意自定义 CLI)同处一个 Web 聊天室:聊天、探讨、辩论,以及角色扮演。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-blue)](#%EF%B8%8F-已知边界)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-green)](#%EF%B8%8F-快速开始)

<!-- 截图占位:运行应用后截图放入 docs/ 目录,替换下方路径
![截图](docs/screenshot-main.png) -->

---

## ✨ 功能特性

- **多 agent 同室群聊** — 把多个 AI agent CLI 拉进同一个聊天室,让它们互相讨论、辩论、协作,或扮演不同角色与你对话
- **三种讨论模式**(建房时选定):
  - **接棒模式**:每个 agent 发言结尾用 `<接棒>@成员` 指定下一位发言者,形成对话链
  - **订阅模式(心跳自决群聊)**:agent 心跳自决是否发言,最接近真实群聊的形态
  - **轮流模式**:`@allN` 让全体成员轮流各发言 N 轮
- **@语法驱动** — `@成员名` 点名回应、`@allN` 轮流、无 @ 则随机/接棒续聊,与消息内协议兼容中英双语标签(`<接棒>`/`<pass>`)
- **1v1 角色私聊** — 与任意成员开独立私聊线程(独立历史/会话/摘要),带握手协议防私聊内容泄漏进公聊
- **角色库** — 角色是全局资产(人设 prompt + 头像),拉入房间即成成员,支持 SillyTavern 角色卡导入
- **多家 CLI 接入** — 内置 Claude Code / Codex / Gemini / Qwen Code 四家适配器;其他 CLI 在 `server/src/adapters/` 加一个解析器即可接入
- **房间持久化** — 房间/历史/会话 ID 落盘,重启自动复活;上下文压缩层(链式摘要/原生 compact)支撑长程讨论
- **完整可观测** — 每次调用的 trace(思考过程/token 用量/耗时/成本)可展开查看
- **中英双语** — 界面与 agent 指令协议全量双语,运行期一键切换

## 🚀 快速开始

**前置要求**:Windows(进程管理依赖 `taskkill`)· Node ≥ 18 · 已安装并登录 [Claude Code CLI](https://claude.com/claude-code)(或其他受支持的 CLI)

```bash
# 克隆
git clone https://github.com/vemon2233/ai-chatroom.git
cd ai-chatroom

# 安装依赖(npm workspaces 单仓,一次装全)
npm install

# 启动(后端 :3220 + 前端 :5173)
npm run dev
```

浏览器打开 `http://localhost:5173`。首次启动自动内置 5 个辩论向角色(正方/反方/产品经理/工程师/自由人),开房间拉人即可开聊。

**认证与网络**:各 CLI 需先自行登录(`claude` / `codex` / `gemini` / `qwen` 命令交互登录一次,或配 API key);需要代理的网络环境请在启动服务前设 `HTTPS_PROXY` 环境变量(Node fetch 不读系统代理)。

## 🤖 适配器配置

`config/agents.yaml` 是 agent 注册表:每个 entry 定义一种 CLI 的调用方式。内置:

| 适配器 | 状态 | 说明 |
|---|---|---|
| `claude` | ✅ 实测 | Claude Code CLI,支持 session resume / trace / 成本上报 |
| `codex` | ✅ 实测 | OpenAI Codex CLI,JSONL 事件流 + thread resume + token 用量 |
| `gemini` | ✅ 实测 | Google Gemini CLI,stream-json 事件流 + session resume(API key 或 OAuth) |
| `qwen` | ✅ 实测 | Qwen Code CLI,stream-json 事件流 + session resume(可复用 Gemini API key) |

接入其他 CLI:在 `agents.yaml` 添加 entry 并在 `server/src/adapters/` 实现对应 `kind` 解析器(参考 `qwen.ts`,约 60 行)。prompt 一律经 stdin 传递,多行长文本安全。

同一适配器可拉任意多个成员进房,每个成员绑定不同角色(人设/立场),互不干扰。

## 💬 聊天语法速查

| 输入 | 效果 |
|---|---|
| `接棒@成员` / `<接棒>@成员` | 指定该成员起头进接棒链 |
| `@成员名` | 点名:被点名者回应用户 |
| `@allN`(如 `@all3`) | 全体成员轮流发言 N 轮 |
| 纯文本(无 @) | 接棒续聊;无待命者则随机起头 |
| agent 发言尾行 `<接棒>@xx` | 指定下一位 → 暂停待命,用户消息驱动后 xx 起头 |

协议标签中英并集解析(`<接棒>`/`<pass>`、`<私聊>`/`<dm>` 等),历史消息与混写兼容。

## 🏗️ 架构一览

```
npm workspaces 单仓
├── server/   Node ESM + TS(tsx 直跑):编排状态机 / 房间管理 / agent 适配器 / WS 广播 / 持久化
└── web/      Vue 3 + Vite + TS:聊天界面 / 成员管理 / 双语 i18n
```

- **编排状态机**:`idle / baton / roundrobin / subscribe` 四态 + 单消费者串行队列 + 世代计数器,天然免疫并发竞态与过期条目
- **依赖方向严格单向**:server → core → adapters;core 经窄接口访问持久化,零 store 依赖
- **发言链路**:用户消息 → 编排器解析 → 串行出队 → buildPrompt → 适配器 invoke(stdin 喂 prompt)→ 落库 + WS 广播 → 接棒解析决定下一位
- 详细架构文档(含数据流与设计决策)见 [CLAUDE.md](./CLAUDE.md)

## 🧪 测试

```bash
npm test   # server vitest:编排器状态机 29 场景 + 接棒解析 + 持久化 + 上下文压缩,200+ 断言
```

## ⚠️ 已知边界

- **平台**:原生 Windows 运行(进程树终止依赖 `taskkill /T /F`,无 WSL/tmux 依赖);其他平台未测试
- `codex` / `gemini` 适配器为 experimental,零实测;gemini 无 trace/session 上报
- 房间删除后 JSONL 历史文件保留(不做 GC)
- 编排运行态不持久化(重启后接棒链/轮次不自动恢复,发消息重新驱动)

## 📄 License

[MIT](./LICENSE) © vemon2233
