# Agent Remote Repair Hub v3.0

> 解构一切 · 从根本底层实现用户彻底无为 · 完全动态软编码决一切问题

远程 Windows 诊断、修复与控制系统。**一个命令启动一切，零配置，零依赖，自动公网。**

## 快速开始

```bash
npm install && npm start
```

就这样。没有了。

- 自动启动 WebSocket 中枢 + HTTP Relay
- 自动生成安全Token
- 自动建立公网隧道（SSH → localhost.run）
- 自动检测 LAN IP
- 控制台输出 Agent 安装命令，复制到目标机器执行即可

## 设计哲学

- **道法自然** — 零配置文件，零环境变量，一切自动生成自动检测
- **用户无为** — 不需要配 FRP，不需要买域名，不需要开端口，不需要编辑任何文件
- **万法归宗** — 一个 `node dao.js` 启动所有服务，一个 `/go` 端点连接所有Agent
- **柔弱胜刚强** — SSH隧道自动重连，Agent自动重连，Relay自动发现，网络中断无感恢复
- **去芜留菁** — 零硬编码，适用于任意 Windows 机器

## 架构

```text
  [目标Windows] ──irm /go | iex──►┐
                                    │
  [浏览器五感] ──WS──► dao.js ─────┤──► remote-agent :3002 (WS中枢)
                                    │         ↕ bridge (自动发现)
  [localhost.run] ──SSH隧道──►─────┘──► ps-agent :9910 (HTTP Relay)
                                              ↕ proxy (/relay/*)
                                    ◄───── 单端口统一接入 ─────►
```

### 三层融合

| 层 | 组件 | 作用 |
|----|------|------|
| **道** | `dao.js` | 万法归宗入口，启动一切，协调一切 |
| **桥** | `dao_bridge.js` + `dao_tunnel.js` | LAN自动发现 + 公网SSH隧道 |
| **器** | `server.js` + `ps_agent_server.py` | WS中枢 + HTTP Relay |

## 接入方式

### 方式一：公网（自动隧道，推荐）

启动后控制台显示公网URL，目标机器执行：

```powershell
irm https://xxxx.lhr.life/go | iex
```

### 方式二：局域网

```powershell
irm http://192.168.x.x:3002/go | iex
```

### 方式三：HTTP Relay（穿透防火墙）

```powershell
irm http://192.168.x.x:9910/bootstrap.ps1 | iex
```

## 端点一览

| 端点 | 说明 |
|------|------|
| `/` | 五感控制台（浏览器） |
| `/go` | 统一Agent脚本（自动ws/wss） |
| `/agent.ps1` | WS Agent脚本（兼容旧版） |
| `/status` | 系统状态JSON |
| `/relay/*` | PS Agent Relay代理（单端口接入） |
| `/brain/exec` | 远程执行命令 |
| `/brain/auto` | 自动诊断 |
| `/brain/state` | 状态查询 |

## 高级用法

```bash
# 禁用隧道（仅LAN）
node dao.js --no-tunnel

# 单独启动各组件
npm run hub          # 仅 WebSocket 中枢
npm run relay        # 仅 HTTP Relay

# Brain CLI
cd remote-agent && node brain.js exec "hostname"
cd remote-agent && node brain.js auto
cd remote-agent && node brain.js state

# 系统守护
powershell -EP Bypass -File desktop_guardian.ps1 -Action diagnose
powershell -EP Bypass -File desktop_guardian.ps1 -Action fix
```

## 环境变量（全部可选，有合理默认值）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3002` | Hub端口 |
| `PS_AGENT_PORT` | `9910` | Relay端口 |
| `PS_AGENT_MASTER_TOKEN` | *(auto)* | 共享Token（自动生成） |
| `NO_TUNNEL` | `0` | 设为1禁用隧道 |
| `PUBLIC_URL` | *(auto-detect)* | 公开URL（隧道自动覆盖） |

## 项目结构

```text
├── dao.js                      # 道 · 万法归宗入口 (ONE command)
├── package.json                # npm start = node dao.js
├── remote-agent/               # WebSocket 诊断中枢
│   ├── server.js              # 主服务 (可独立运行 / 被dao.js集成)
│   ├── dao_bridge.js          # Relay自动发现 (LAN扫描 + WAN兜底)
│   ├── dao_tunnel.js          # SSH隧道 (localhost.run 零配置公网)
│   ├── page.js                # 前端页面
│   └── brain.js               # CLI
├── ps-agent/                   # HTTP Agent Relay
│   ├── ps_agent_server.py     # 零依赖Python (token自动生成)
│   └── ps_agent_client.ps1    # PowerShell客户端 (19种命令)
├── web/index.html              # 硬件诊断向导
├── desktop_guardian.ps1        # 通用安全守护 (23项诊断 + 14项修复)
├── docs/                       # 手册
└── frpc.example.toml           # FRP模板 (可选, 有隧道则不需要)
```

## 系统守护 (desktop_guardian.ps1)

通用安全扫描 · 无密码管理员检测 · 流氓软件 · 防火墙 · RDP · SMB · hosts · portproxy · 服务冲突 · 资源监控 · 幽灵账号检测

## License

MIT
