# Agent Remote Repair Hub

> 五感连接远方，大脑分析万象，一命接万机。

远程 Windows 诊断、修复与控制系统。零硬编码 · 零外部依赖 · 用户自配公网 · 一条命令接入任意 Windows 电脑。

## 设计哲学

- **道法自然** — 全部配置通过环境变量，不固定任何IP/域名/主机名
- **无为配置** — 用户只需配自己的公网服务（FRP/Nginx/Cloudflare Tunnel），系统自适应
- **万法归宗** — LAN 自动发现 Relay（并行子网扫描），WAN 公网兜底，无需手动指定
- **去芜留菁** — 零硬编码依赖，诊断项通用化，适用于任意 Windows 机器

## 架构

```text
  浏览器(五感) ──WS──► remote-agent ◄──bridge──► ps-agent relay ◄──HTTP── Agent(PowerShell)
                       :3002                      :9910              任意Windows机
                       分析引擎·hosts守护          命令队列·长轮询
                                    ↑
                           LAN自动发现 + WAN兜底
```

- **remote-agent** — WebSocket 实时中枢（五感 + 分析引擎 + Agent直连）
- **ps-agent** — HTTP 命令队列中继（零依赖Python + PowerShell客户端）
- **dao_bridge** — 桥接层（WS ↔ HTTP Relay 自动发现互通，并行子网扫描）
- **desktop_guardian** — 通用安全守护（自动扫描无密码管理员、流氓服务、安全风险）

## 快速开始

```bash
# 1. 配置环境变量 (可选，有合理默认值)
cp remote-agent/.env.example remote-agent/.env
cp ps-agent/.env.example ps-agent/.env

# 2. 启动诊断中枢
cd remote-agent && npm install && node server.js
# → http://localhost:3002  (浏览器)
# → irm http://<IP>:3002/agent.ps1 | iex  (Agent)

# 3. 启动 PS Agent Relay
cd ps-agent && python ps_agent_server.py
# → http://localhost:9910  (Dashboard)
# → irm http://<IP>:9910/bootstrap.ps1 | iex  (一键接入)

# 4. 系统守护
powershell -EP Bypass -File desktop_guardian.ps1 -Action diagnose
powershell -EP Bypass -File desktop_guardian.ps1 -Action fix

# 5. 公网 (可选) — 复制 frpc.example.toml → frpc.toml，填入你的服务器信息
```

## 环境变量

| 变量 | 默认值 | 说明 |
| ------ | -------- | ------ |
| `PORT` | `3002` | remote-agent 监听端口 |
| `PUBLIC_URL` | `localhost:3002` | 浏览器和Agent访问地址 |
| `PS_AGENT_PORT` | `9910` | PS Agent Relay 端口 |
| `PS_AGENT_MASTER_TOKEN` | *(auto-generated)* | 管理API认证令牌 |
| `PS_AGENT_PUBLIC_URL` | `http://localhost:9910` | Agent bootstrap地址 |
| `PUBLIC_RELAY` | *(empty)* | 公网Relay地址（WAN兜底） |
| `RELAY_PORT` | `9910` | Relay探测端口 |
| `PROBE_OCTETS` | `1` | 快速探测的LAN末位IP（逗号分隔） |

## PS Agent 命令

`shell` · `screenshot` · `sysinfo` · `process_list` · `process_kill` · `file_list` · `file_read` · `file_write` · `registry_read` · `service_list` · `network_info` · `env_vars` · `installed_apps` · `scheduled_tasks` · `clipboard` · `display_info` · `wifi_profiles` · `firewall_rules` · `power_plan`

## 诊断分析引擎

- **浏览器诊断**: DNS/HTTPS/IP 全链路检测 → Clash/VPN识别 → 根因分析 → 修复方案
- **Agent诊断**: 17步自动检查（hosts/proxy/DNS/防火墙/进程/内存）
- **Brain CLI**: `node brain.js exec|auto|state|say|msg`
- **DNS解析**: 多DoH provider容错（Cloudflare → Google 自动切换）

## 系统守护 (desktop_guardian.ps1)

通用安全扫描 · 无密码管理员检测 · 流氓软件 · 防火墙 · RDP · SMB · hosts · portproxy · 服务冲突 · 资源监控 · 幽灵账号检测

## 项目结构

```text
├── remote-agent/               # WebSocket 诊断中枢
│   ├── server.js              # 主服务
│   ├── dao_bridge.js          # 万法归宗桥接 (LAN并行发现 + WAN兜底)
│   ├── page.js                # 前端页面
│   ├── brain.js               # CLI
│   └── .env.example           # 环境变量模板
├── ps-agent/                   # HTTP Agent Relay
│   ├── ps_agent_server.py     # 零依赖 Python 服务器 (token自动生成)
│   ├── ps_agent_client.ps1    # 完整客户端 (19种命令)
│   └── .env.example           # 环境变量模板
├── web/index.html              # 硬件诊断向导 (零依赖静态页)
├── docs/
│   ├── 双机保护手册.md         # guardian 使用手册
│   └── 诊断手册_笔记本开机自动关机.md
├── desktop_guardian.ps1        # 通用系统安全守护
├── frpc.example.toml           # FRP 配置模板
└── start_service.example.bat   # 一键启动模板
```

## License

MIT
