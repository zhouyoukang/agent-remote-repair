# AGENTS.md — AI Agent 操作指南

## 项目性质
远程电脑诊断与修复系统，包含 WebSocket 远程中枢 + PowerShell 安全守护 + 硬件排查知识库。

## 工具矩阵

| 工具 | 用途 | 启动方式 |
|------|------|----------|
| `desktop_guardian.ps1` | 23项诊断/14项修复/hosts守护/JSON报告 | `pwsh -File desktop_guardian.ps1 -Action diagnose` |
| `remote-agent/server.js` | WebSocket远程诊断中枢 | `cd remote-agent && node server.js` |
| `remote-agent/brain.js` | CLI: exec/auto/state/say/msg | `node brain.js auto` |
| `诊断手册_笔记本开机自动关机.md` | 硬件排查知识库(8章) | 直接阅读 |

## Agent 规则
1. **诊断优先于修复** — 先 `diagnose`，看清问题再 `fix`
2. **hosts-guard 持续运行** — 防止恶意软件反复写入 hosts
3. **远程中枢需管理员 Agent** — `irm http://host:3002/agent.ps1 | iex` 需管理员权限
4. **Brain CLI 是 Agent 的手** — 通过 `brain.js exec` 执行远程命令

## 关联
- `remote-agent/README.md` — 远程中枢详细架构
- `docs/双机保护手册.md` — 详细保护体系
