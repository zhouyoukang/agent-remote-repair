# Agent Remote Repair Hub v7.0

> 道法自然 · 万法归宗 · 六源自适应 · 反向控制 · 诊断修复 · 用户彻底无为

远程 Windows/Android 诊断、修复、**投屏**与**控制**系统。
**一个命令启动一切，零配置，自动发现 6 种投屏/控制源，自动公网。**

## 前置要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| **Node.js** | **≥ 18.0** | 必须（`fetch` / `crypto.randomUUID`） |
| Python | ≥ 3.8 | 可选 — PS Agent Relay 需要，Hub 无 Python 也能独立运行 |
| ADB | 任意 | 可选 — Android 控制/投屏需要 |

## 快速开始

```bash
npm install && npm start
```

就这样。浏览器打开 **`http://localhost:3002`** 即可使用五感控制台。

> 端口默认 3002，若被占用自动递增 (3003, 3004...)，观察控制台输出确认实际端口。
> Python 未安装时 Relay 不可用，Hub 仍以 WebSocket 直连模式正常运行。

- 道核驱动: 动态端口/Token/指纹，无硬编码
- 6 种投屏源自动发现: ghost_shell / scrcpy / dao-remote / MJPEG / adb_hub / Agent截屏
- 5 级输入路由自适应: ghost → InputRoutes → adb_hub → dao-remote → scrcpy → ADB兜底
- 自适应公网隧道: cloudflared(自动下载) → ngrok → SSH(localhost.run)，零配置零费用
- 浏览器实时投屏 + 触控/键盘/文本反向控制

## 设计哲学

- **道法自然** — 零配置，一切自动发现、自动适配
- **万法归宗** — 统一入口 `captureScreenBest` / `sendInputToDevice`，6 种投屏源、5 级输入源透明切换
- **反者道之动** — 优先级自适应: ghost(30fps最强) → scrcpy(安卓最强) → dao(亲情远程) → adb_hub(ADB全控) → Agent截屏(最通用)
- **柔弱胜刚强** — 服务可随时上下线，30s 自动重探，无感切换
- **去芜留菁** — 所有投屏/输入路径收敛为两个核心函数，无重复逻辑

## 架构

```text
  [目标Windows] ──irm /go | iex──►┐
       ↕ screencap (连续推送)      │
  [Android设备] ──ADB──►──────────┤
       ↕ scrcpy / MJPEG / ADB     │
  [浏览器五感] ──WS──► dao.js ────┤──► remote-agent (WS中枢)
       ↕ /ws/screen (实时投屏)     │       ↕ captureScreenBest()
       ↕ /ws/sense (诊断控制)      │       ↕ sendInputToDevice()
  [公网隧道] ──cloudflared/ngrok/SSH──►┘  ↕ /screen/* (投屏代理)
                                           ↕ /input/* (反向控制)
                              ──► ps-agent (HTTP Relay)
                              ──► ghost_shell :8000 (Windows 30fps)
                              ──► scrcpy Hub :8890 (Android)
                              ──► dao-remote :9900 (Go版亲情远程)
                              ──► MJPEG :8081 / Input :8084
                              ──► adb_hub :9861 (ADB全控中枢)
```

### 四层融合

| 层 | 组件 | 作用 |
|----|------|------|
| **道** | `dao_kernel.js` + `dao.js` | 道核(熵源/身份/发现/能力/会话) + 入口 |
| **屏** | `/screen/*` + `/ws/screen` | 6 源投屏: ghost/scrcpy/dao/mjpeg/adb_hub/agent，自适应 |
| **手** | `/input/*` + 触控/键盘 | 5 级输入: ghost/InputRoutes/adb_hub/dao/scrcpy + ADB兜底 |
| **脑** | `/brain/*` + 诊断引擎 | 诊断修复: 网络/hosts/防火墙/缓存 |

## 投屏与控制

### 浏览器投屏 (零安装)

打开 `http://localhost:3002` → 投屏tab → 截屏/实时投屏

- **单次截屏**: `captureScreenBest()` 自动选最优源
- **实时投屏**: Agent 连续推送屏幕帧 / ghost_shell 30fps WS流
- **触控点击**: 点击屏幕图像直接操控远程设备
- **键盘转发**: 焦点在投屏页时自动转发按键
- **文本输入**: 弹窗输入 → 发送到远程
- **Windows 控制栏**: ghost/dao 在线时自动显示桌面快捷操作

### 投屏源自动发现 (6 源优先级)

| 优先级 | 源 | 端口 | 能力 | 适用 |
|--------|-----|------|------|------|
| ★★★★ | ghost_shell | 8000 | 30fps WS流/截图/桌面控制 | Windows |
| ★★★☆ | scrcpy Hub | 8890 | 截图/录制/控制/多设备 | Android |
| ★★★☆ | dao-remote | 9900 | 截图/桌面控制 (Go版) | Windows |
| ★★☆☆ | MJPEG | 8081 | 实时MJPEG流 | Android |
| ★★☆☆ | adb_hub | 9861 | ADB截图/shell/多设备 | Android |
| ★☆☆☆ | Agent screencap | — | PowerShell桌面截图 | Windows |

### 输入路由优先级

| 优先级 | 源 | 说明 |
|--------|-----|------|
| 1 | ghost_shell | Windows 桌面 30fps 控制 (鼠标/键盘/滚轮) |
| 2 | InputRoutes | Android 120+ API 端点 |
| 3 | adb_hub | ADB 全控中枢 (tap/swipe/key/text/shell) |
| 4 | dao-remote | 亲情远程 Go 版 |
| 5 | scrcpy Hub | scrcpy API |
| 兜底 | ADB fallback | 原始 `adb shell input` 命令 |

## 端点一览

| 端点 | 说明 |
|------|------|
| `/` | 五感控制台（浏览器） |
| `/go` | 统一 Agent 脚本（自动 ws/wss，多路径） |
| `/api/health` | Hub 健康探针 |
| `/screen/sources` | 投屏源状态 + 最优源 |
| `/screen/capture` | 截屏 (mode=auto/ghost/scrcpy/dao/adb_hub/agent) |
| `/screen/stream` | 实时流代理 |
| `/screen/scrcpy/*` | scrcpy Hub API 代理 |
| `/screen/ghost/*` | ghost_shell API 代理 |
| `/screen/dao/*` | dao-remote API 代理 |
| `/screen/adb/*` | adb_hub API 代理 |
| `/input/{action}` | 反向控制 (tap/swipe/key/text/home/back/scroll/...) |
| `/ws/screen` | WebSocket 实时投屏 + 输入通道 |
| `/ws/sense` | WebSocket 诊断控制台 |
| `/ws/agent` | WebSocket Agent 连接 |
| `/status` | 系统状态 JSON |
| `/relay/*` | PS Agent Relay 代理 |
| `/brain/exec` | 远程执行命令 |
| `/brain/auto` | 自动诊断 |
| `/marble` | 3D 世界 Gaussian Splatting Viewer (需 `WLT_API_KEY`) |

## 环境变量（全部可选）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3002` | Hub 端口 (默认3002, 占用则自动递增) |
| `SCRCPY_HUB_PORT` | `8890` | scrcpy Hub 端口 |
| `MJPEG_PORT` | `8081` | MJPEG 投屏端口 |
| `INPUT_PORT` | `8084` | InputRoutes/ScreenStream 端口 |
| `GHOST_SHELL_PORT` | `8000` | ghost_shell 端口 |
| `DAO_REMOTE_PORT` | `9900` | dao-remote 端口 |
| `ADB_HUB_PORT` | `9861` | adb_hub 端口 |
| `ADB_HUB_TOKEN` | `adb_hub_2026` | adb_hub 认证令牌 |
| `NO_TUNNEL` | `0` | 设为 1 禁用公网隧道 |
| `PUBLIC_URL` | *(auto)* | 公网 URL (隧道建立后自动覆盖) |

> 详见 `.env.example`

## 项目结构

```text
├── dao_kernel.js               # 道核 — 熵源/身份/发现/能力/会话 (万物之源)
├── dao.js                      # 入口 — 道生一, 一生二, 二生三, 三生万物
├── remote-agent/               # WebSocket 中枢
│   ├── server.js              # 主服务: 6源投屏 + 5级输入 + 统一截屏
│   ├── page.js                # 前端: 投屏/触控/终端/诊断/系统信息
│   ├── dao_bridge.js          # Relay 自动发现桥接 (道核Token)
│   ├── dao_tunnel.js          # 自适应隧道 (cloudflared→ngrok→SSH)
│   └── brain.js               # CLI 交互工具
├── ps-agent/                   # HTTP Agent Relay (Python)
├── web/index.html              # 硬件诊断向导 (静态)
├── .env.example                # 环境配置模板
├── desktop_guardian.ps1        # 安全守护 (23诊断 + 14修复)
└── frpc.example.toml           # FRP 隧道模板 (可选)
```

## 核心函数

| 函数 | 位置 | 作用 |
|------|------|------|
| `captureScreenBest()` | server.js | 统一截屏: ghost→scrcpy→dao→adb_hub→agent，返回 {image, source} |
| `sendInputToDevice()` | server.js | 统一输入: ghost→InputRoutes→adb_hub→dao→scrcpy，自适应 |
| `discoverScreenSources()` | server.js | 6 源探测: 30s 轮询，状态变化实时通知 |
| `getBestScreenSource()` | server.js | 优先级排序: ghost>scrcpy>dao>mjpeg>adb_hub>input |
| `adbFallbackCmd()` | server.js | ADB 兜底: 万法皆空时回归原始 shell 命令 |
| `getUnifiedAgentScript()` | server.js | 生成 PowerShell Agent: 多路径连接 + 屏幕推送 |

## License

MIT
