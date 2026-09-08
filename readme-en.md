# AI Chatroom / AI 聊天室

**English | [中文](./README.md)**

Multiple AI agent CLIs (Claude Code / Codex / Gemini / any custom CLI) in a single web chatroom: chatting, discussing, debating — and role-playing.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-blue)](#%EF%B8%8F-known-limitations)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-green)](#%EF%B8%8F-quick-start)

<!-- Screenshot placeholder: run the app, save screenshots under docs/, then replace the path below
![Screenshot](docs/screenshot-main.png) -->

---

## ✨ Features

- **Multi-agent group chat** — Pull multiple AI agent CLIs into one chatroom and let them discuss, debate, collaborate, or role-play different characters with you
- **Three discussion modes** (chosen at room creation):
  - **Baton mode**: each agent ends its turn with `<pass>@member` to hand the floor to the next speaker, forming a conversation chain
  - **Subscribe mode (heartbeat-driven group chat)**: agents decide on their own heartbeat whether to speak — the closest thing to a real group chat
  - **Round-robin mode**: `@allN` makes every member speak N rounds in turn
- **@-syntax driven** — `@member` for callouts, `@allN` for round-robin, plain text for random/baton continuation; in-message protocol tags parse as the union of Chinese and English (`<接棒>`/`<pass>`)
- **1v1 private chats** — Open an isolated DM thread with any member (separate history/session/summary), with a handshake protocol that keeps private content out of the public room
- **Character library** — Characters are global assets (persona prompt + avatar); pulling one into a room creates a member. SillyTavern character cards can be imported
- **Plug in any CLI** — Copy the `generic` template in `config/agents.yaml` to hook up any CLI that "reads a prompt, writes text"
- **Persistent rooms** — Rooms/history/session IDs are persisted and revived on restart; a context-compression layer (chained summaries / native compact) supports long-running discussions
- **Full observability** — Every invocation's trace (thinking process / token usage / duration / cost) is expandable
- **Bilingual (zh/en)** — The UI and the agent instruction protocol are fully bilingual, switchable at runtime

## 🚀 Quick Start

**Prerequisites**: Windows (process management relies on `taskkill`) · Node ≥ 18 · [Claude Code CLI](https://claude.com/claude-code) installed and logged in (or another supported CLI)

```bash
# Clone
git clone https://github.com/vemon2233/ai-chatroom.git
cd ai-chatroom

# Install dependencies (npm workspaces monorepo, one shot)
npm install

# Start (backend :3220 + frontend :5173)
npm run dev
```

Open `http://localhost:5173` in your browser. Five debate-oriented characters (正方/反方/产品经理/工程师/自由人 — pro/con/product manager/engineer/moderator) are seeded on first launch — create a room, add them, and start chatting.

No AI CLI installed? The built-in `generic` adapter defaults to `cat` (echoes the prompt), so you can explore the UI flow first.

## 🤖 Adapter Configuration

`config/agents.yaml` is the agent registry: each entry defines how to invoke one CLI. Built in:

| Adapter | Status | Notes |
|---|---|---|
| `claude` | ✅ tested | Claude Code CLI, with session resume / trace / cost reporting |
| `generic` | ✅ tested | Universal template — any CLI that "reads a prompt, writes text" works |
| `codex` | ⚠️ experimental | Codex CLI, untested |
| `gemini` | ⚠️ experimental | Gemini CLI, untested; no trace/session reporting |

To plug in a custom CLI (e.g. a DeepSeek harness): copy the `generic` block in `agents.yaml` and rename it — prompts are always fed via stdin, safe for long multi-line text.

The same adapter can back any number of members in a room, each bound to a different character (persona/stance), without interference.

## 💬 Chat Syntax Cheat Sheet

| Input | Effect |
|---|---|
| `<pass>@member` (or `接棒@成员`) | Start the baton chain with that member |
| `@member` | Callout: the named member responds to you |
| `@allN` (e.g. `@all3`) | Every member speaks N rounds in turn |
| Plain text (no @) | Baton continuation; if none pending, a random member starts |
| Agent's last line `<pass>@xx` | Names the next speaker → paused pending; xx starts after your next message |

Protocol tags parse as the union of Chinese and English (`<接棒>`/`<pass>`, `<私聊>`/`<dm>`, …), so history and mixed usage stay compatible.

## 🏗️ Architecture at a Glance

```
npm workspaces monorepo
├── server/   Node ESM + TS (runs directly via tsx): orchestration state machine / room management / agent adapters / WS broadcast / persistence
└── web/      Vue 3 + Vite + TS: chat UI / member management / bilingual i18n
```

- **Orchestration state machine**: `idle / baton / roundrobin / subscribe` + a single-consumer serial queue + a generation counter — naturally immune to concurrency races and stale entries
- **Strict one-way dependencies**: server → core → adapters; core reaches persistence through narrow interfaces with zero store imports
- **Speech pipeline**: user message → orchestrator parse → serial dequeue → buildPrompt → adapter invoke (prompt via stdin) → persist + WS broadcast → baton resolution decides the next speaker
- Full architecture doc (data flow and design decisions) in [CLAUDE.md](./CLAUDE.md)

## 🧪 Tests

```bash
npm test   # server vitest: 29 orchestrator state-machine scenarios + baton parsing + persistence + context compression, 200+ assertions
```

## ⚠️ Known Limitations

- **Platform**: runs natively on Windows (process-tree termination relies on `taskkill /T /F`; no WSL/tmux); other platforms untested
- `codex` / `gemini` adapters are experimental and untested; gemini has no trace/session reporting
- JSONL history files are kept after room deletion (no GC)
- Orchestration runtime state is not persisted (baton chains/rounds don't auto-resume after restart; send a message to re-drive)

## 📄 License

[MIT](./LICENSE) © vemon2233
