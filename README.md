# Agent Remote Repair Hub

> 五感连接远方，大脑分析万象，一命接万机。

远程 Windows 诊断、修复与控制系统。一条命令接入任意 Windows 电脑。

## 架构

```text
  浏览器(五感) ──WS──► remote-agent ◄──bridge──► ps-agent relay ◄──HTTP── Agent(PowerShell)
                       :3002                      :9910              任意Windows机
                       分析引擎·hosts守护          命令队列·长轮询
```

- **remote-agent** — WebSocket 实时中枢（五感 + 分析引擎 + Agent直连）
- **ps-agent** — HTTP 命令队列中继（零依赖Python + PowerShell客户端）
- **dao_bridge** — 桥接层（WS ↔ HTTP Relay 自动发现互通）

## 快速开始

```bash
# 1. 诊断中枢
cd remote-agent && npm install && node server.js
# → http://localhost:3002  (浏览器)
# → irm http://<IP>:3002/agent.ps1 | iex  (Agent)

# 2. PS Agent Relay
cd ps-agent && python ps_agent_server.py
# → http://localhost:9910  (Dashboard)
# → irm http://<IP>:9910/bootstrap.ps1 | iex  (一键接入)

# 3. 系统守护
powershell -EP Bypass -File desktop_guardian.ps1 -Action diagnose  # 23项诊断
powershell -EP Bypass -File desktop_guardian.ps1 -Action fix       # 14项修复

# 4. 公网 — 复制 frpc.example.toml → frpc.toml，填入服务器信息
```

## PS Agent 命令

`shell` · `screenshot` · `sysinfo` · `process_list` · `process_kill` · `file_list` · `file_read` · `file_write` · `registry_read` · `service_list` · `network_info` · `env_vars` · `installed_apps` · `scheduled_tasks` · `clipboard` · `display_info` · `wifi_profiles` · `firewall_rules` · `power_plan`

## 诊断分析引擎

- **浏览器诊断**: DNS/HTTPS/IP 全链路检测 → Clash/VPN识别 → 根因分析 → 修复方案
- **Agent诊断**: 17步自动检查（hosts/proxy/DNS/防火墙/进程/内存）
- **Brain CLI**: `node brain.js exec|auto|state|say|msg`

## 系统守护 (desktop_guardian.ps1)

账号安全 · 恶意软件 · 防火墙 · RDP · SMB · hosts · portproxy · 服务冲突 · 资源监控

## 项目结构

```text
├── remote-agent/               # WebSocket 诊断中枢
│   ├── server.js              # 主服务
│   ├── dao_bridge.js          # 万法归宗桥接
│   ├── page.js                # 前端页面
│   └── brain.js               # CLI
├── ps-agent/                   # HTTP Agent Relay
│   ├── ps_agent_server.py     # 零依赖 Python 服务器
│   └── ps_agent_client.ps1    # 完整客户端 (19种命令)
├── web/index.html              # 硬件诊断向导 (零依赖静态页)
├── docs/
│   ├── 双机保护手册.md         # guardian 使用手册
│   └── 诊断手册_笔记本开机自动关机.md  # 硬件排查知识库
├── desktop_guardian.ps1        # 系统安全守护
├── frpc.example.toml           # FRP 配置模板
└── start_mechrevo_service.example.bat
```

## License

MIT
