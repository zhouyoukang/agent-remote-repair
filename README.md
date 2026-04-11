# Agent Remote Repair Hub

> 道生一，一生二，二生三，三生万物。
> 五感连接远方，大脑分析万象，一命接万机。

**完整的远程 Windows 诊断、修复与控制系统** — WebSocket 实时诊断中枢 + HTTP 命令队列 Agent Relay + 系统安全守护 + 硬件排查知识库。

一条命令接入任意 Windows 电脑，全功能远程控制。

## 系统架构

```text
                    ┌──────────────────────────────────────────────────────────────┐
                    │                      Full System Architecture                │
                    │                                                              │
  ┌──────────┐     │  ┌──────────────────┐     ┌───────────────────┐             │
  │  浏览器   │ WS  │  │  remote-agent    │     │   ps-agent relay  │   HTTP      │
  │  (五感)   │────►│  │  WebSocket Hub   │◄───►│   HTTP Queue Srv  │◄──────┐    │
  └──────────┘     │  │  :3002           │     │   :9910           │       │    │
                    │  │  dao_bridge.js ──┘     └─────────┬─────────┘       │    │
  ┌──────────┐     │  │  分析引擎 · hosts守护             │                 │    │
  │   AI     │     │  └──────────────────┘               │ Long Poll       │    │
  │ Cascade  │─────┤                                      │                 │    │
  └──────────┘     │                              ┌───────▼─────────┐      │    │
                    │                              │   Agent Client  │      │    │
                    │                              │   (PowerShell)  ├──────┘    │
                    │                              │   任意Windows机  │           │
                    │                              └─────────────────┘           │
                    └──────────────────────────────────────────────────────────────┘
```

**三层架构**:
- **remote-agent** — WebSocket 实时诊断中枢（浏览器五感 + Agent直连 + 智能分析引擎）
- **ps-agent** — HTTP 命令队列中继（零依赖Python服务器 + PowerShell客户端，一行代码接入任意PC）
- **dao_bridge** — 桥接层（remote-agent ↔ ps-agent relay 自动发现互通）

## 核心组件

| 组件 | 说明 | 技术栈 |
|------|------|--------|
| **remote-agent/** | WebSocket 实时诊断中枢 — 五感(浏览器) + 大脑(分析) + 手(Agent) | Node.js + ws |
| **ps-agent/** | HTTP Agent Relay — 一行命令控制任意 Windows PC | Python stdlib + PowerShell |
| **dao_bridge.js** | 万法归宗桥接 — remote-agent ↔ relay 自动发现与互通 | Node.js |
| **desktop_guardian.ps1** | 系统安全守护 — 23项诊断 / 14项自动修复 / hosts守护 | PowerShell |
| **诊断手册** | 笔记本硬件排查知识库 — 8章从简到难 | Markdown |
| **web/** | 交互式硬件诊断向导 — 手机端优化 | Next.js 14 + Tailwind |

## 快速开始

### 1. 远程诊断中枢 (WebSocket)

```bash
cd remote-agent
npm install
node server.js
# 浏览器: http://localhost:3002
# Agent:  管理员PowerShell运行 irm http://<IP>:3002/agent.ps1 | iex
```

### 2. PS Agent Relay (HTTP命令队列)

```bash
cd ps-agent
python ps_agent_server.py
# Dashboard: http://localhost:9910
```

在目标 Windows PC 上一行接入:

```powershell
# 方式A: 一键 bootstrap（从服务器下载并运行）
irm http://your-server:9910/bootstrap.ps1 | iex

# 方式B: 完整客户端（19种命令类型）
.\ps_agent_client.ps1 -Server http://your-server:9910
```

### 3. 系统守护

```powershell
# 23项诊断
powershell -ExecutionPolicy Bypass -File desktop_guardian.ps1 -Action diagnose

# 14项自动修复
powershell -ExecutionPolicy Bypass -File desktop_guardian.ps1 -Action fix

# hosts持续守护（60s间隔）
powershell -ExecutionPolicy Bypass -File desktop_guardian.ps1 -Action hosts-guard
```

### 4. 公网访问

通过 FRP / Nginx / Cloudflare Tunnel 将端口映射到公网。
- 复制 `frpc_mechrevo.example.toml` → `frpc_mechrevo.toml`，填入服务器信息。

## PS Agent — 19种远程命令

| 命令类型 | 功能 |
|---------|------|
| `shell` | 执行任意 PowerShell 命令 |
| `screenshot` | 截屏（JPEG，可调缩放） |
| `sysinfo` | 完整系统信息 + 进程 + 端口 |
| `process_list` / `process_kill` | 进程管理 |
| `file_list` / `file_read` / `file_write` | 文件操作 |
| `registry_read` | 注册表读取 |
| `service_list` | Windows 服务列表 |
| `network_info` | 网络适配器/IP/DNS/连接数 |
| `env_vars` | 环境变量（支持过滤） |
| `installed_apps` | 已安装软件 |
| `scheduled_tasks` | 计划任务 |
| `clipboard` | 剪贴板内容 |
| `display_info` | 显示器信息 |
| `wifi_profiles` | WiFi 配置（含密码） |
| `firewall_rules` | 防火墙规则 |
| `power_plan` | 电源计划 |

## 远程诊断中枢 — 智能分析

```text
五感 (浏览器)          大脑 (分析引擎)           手 (Agent)
  看见状态              17步自动诊断              执行命令
  听见日志              Clash/VPN识别             截图/文件
  触达终端              hosts劫持检测             系统信息
  嗅到问题              根因分析                  守护修复
  品味修复              修复方案推荐              进程管理
```

- **Brain CLI**: `node brain.js exec/auto/state/say/msg`
- **dao_bridge**: 当 Agent 未直连 WebSocket 时，自动通过 ps-agent relay 下发命令（LAN探测 → 公网兜底）

## 系统守护 — desktop_guardian.ps1

23项诊断 + 14项修复:
- **账号安全** — 无密码账号 / 幽灵登录
- **恶意软件** — AlibabaProtect / BingWallpaper
- **系统配置** — 防火墙 / RDP / SMB / hosts / portproxy
- **服务冲突** — W3SVC(IIS)锁443 / SstpSvc / Flexnet
- **资源监控** — 进程膨胀 / C盘空间 / 远控冗余
- **hosts守护** — 持续60s监控，自动清理恶意条目

## 诊断手册

完整硬件排查知识库: [`诊断手册_笔记本开机自动关机.md`](./诊断手册_笔记本开机自动关机.md)

| 章节 | 内容 |
|------|------|
| 第一章 | 快速判别 — 8种症状对照表 |
| 第二章 | 零成本排查（静电/电源/外设/按键） |
| 第三章 | 轻度拆机（内存/硬盘/电池/主板） |
| 第四章 | 深度硬件（清灰/CMOS/短路检测） |
| 第五章 | 软件/BIOS层排查 |
| 第六章 | 机械革命品牌特有问题 |
| 第七章 | 终极排查流程图 |
| 第八章 | 无界14+ (7840HS) 专属问题 |

## 项目结构

```text
├── README.md                          # 本文件
├── _AGENTS.md                         # AI Agent 操作指南
├── desktop_guardian.ps1                # 系统安全守护脚本
├── 诊断手册_笔记本开机自动关机.md       # 硬件排查知识库
├── remote-agent/                      # WebSocket 远程诊断中枢
│   ├── server.js                     # 主服务 (五感+大脑+Agent)
│   ├── dao_bridge.js                 # 万法归宗桥接 (↔ PS Relay)
│   ├── page.js                       # 前端页面
│   ├── brain.js                      # CLI 工具
│   ├── package.json                  # 依赖: ws
│   └── .env.example
├── ps-agent/                          # HTTP Agent Relay
│   ├── ps_agent_server.py            # Relay 服务器 (零依赖Python)
│   ├── ps_agent_client.ps1           # 完整 Agent 客户端
│   ├── README.md                     # 详细 API 文档
│   └── .env.example
├── web/                               # Next.js 诊断向导
│   └── app/page.tsx
├── docs/
│   └── 双机保护手册.md
├── frpc_mechrevo.example.toml         # FRP 配置模板
└── start_mechrevo_service.example.bat
```

## 技术栈

| 层 | 技术 | 特点 |
|----|------|------|
| 实时通信 | Node.js + WebSocket | 浏览器 ↔ Agent 双向实时 |
| 命令队列 | Python stdlib HTTP | 零依赖，任意公网环境 |
| 桥接层 | dao_bridge.js | LAN自动发现 → 公网兜底 |
| Agent端 | PowerShell | 零安装，Windows原生 |
| 前端 | 原生HTML/JS + Next.js | 暗色主题，移动端适配 |

## License

MIT
