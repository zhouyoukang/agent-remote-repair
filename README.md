# Agent 远程修复中枢 🔧

> 道生一，一生二，二生三，三生万物。
> AGI = 人 + AI。五感连接远方，大脑分析万象。

**一套完整的远程电脑诊断与修复系统**，包含 WebSocket 远程诊断中枢、PowerShell 安全守护脚本、笔记本硬件排查手册，适用于 Windows 系统的远程管理与故障排查。

## ✨ 核心组件

| 组件 | 说明 | 技术栈 |
|------|------|--------|
| **remote-agent/** | WebSocket 远程诊断中枢 — 浏览器(五感)+Agent(手)+分析引擎(脑) | Node.js + ws + 原生HTML/CSS/JS |
| **desktop_guardian.ps1** | 系统安全守护 — 23项诊断/14项自动修复/hosts守护 | PowerShell |
| **诊断手册** | 笔记本硬件排查完整知识库 — 8章从简到难 | Markdown |
| **web/** | 交互式硬件诊断向导 — 手机端优化 | Next.js 14 + TypeScript + Tailwind |

## 🚀 快速开始

### 远程诊断中枢

```bash
cd remote-agent
npm install
node server.js
# 浏览器打开 http://localhost:3002
# 目标电脑管理员 PowerShell: irm http://<你的IP>:3002/agent.ps1 | iex
```

### 系统守护脚本

```powershell
# 诊断（23项安全检查）
powershell -ExecutionPolicy Bypass -File desktop_guardian.ps1 -Action diagnose

# 自动修复（14项）
powershell -ExecutionPolicy Bypass -File desktop_guardian.ps1 -Action fix

# hosts 持续守护（60s间隔，自动清理恶意条目）
powershell -ExecutionPolicy Bypass -File desktop_guardian.ps1 -Action hosts-guard

# JSON报告输出
powershell -ExecutionPolicy Bypass -File desktop_guardian.ps1 -Action report
```

### 诊断向导 (Web)

```bash
cd web && npm install && npm run dev
# 浏览器打开 http://localhost:3000
```

### 公网访问（FRP隧道）

1. 复制 `frpc_mechrevo.example.toml` → `frpc_mechrevo.toml`
2. 填入你的 FRP 服务器信息
3. 双击 `start_mechrevo_service.bat` 即可

## 📦 远程诊断中枢 — 架构

```
┌─────────────────────────────────────────────────┐
│              远程诊断中枢 server.js              │
│                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐   │
│  │  五感     │    │   大脑    │    │    手     │   │
│  │  Sense   │◄──►│  Brain   │◄──►│  Agent   │   │
│  │ (浏览器)  │    │ (分析)    │    │(PowerShell)│  │
│  └──────────┘    └──────────┘    └──────────┘   │
└─────────────────────────────────────────────────┘
```

- **五感 (浏览器)** — 看见状态 · 听见日志 · 触达终端 · 嗅到问题 · 品味修复
- **大脑 (分析引擎)** — 17步自动诊断 · Clash/VPN识别 · hosts守护 · 根因分析
- **Brain CLI** — `node brain.js exec/auto/state/say/msg`

## 🛡️ 系统守护 — desktop_guardian.ps1

23项诊断 + 14项自动修复，覆盖：

- **账号安全** — 无密码账号/幽灵登录
- **恶意软件** — AlibabaProtect/BingWallpaper
- **系统配置** — 防火墙/RDP/SMB/hosts/portproxy
- **服务冲突** — W3SVC(IIS)锁443/SstpSvc/Flexnet
- **资源监控** — 进程膨胀/C盘空间/远控冗余
- **hosts守护** — 持续60s监控，自动清理windsurf/codeium条目

## 📖 诊断手册

完整的诊断知识库在 [`诊断手册_笔记本开机自动关机.md`](./诊断手册_笔记本开机自动关机.md)，包含：

| 章节 | 内容 |
|------|------|
| 第一章 | 快速判别——症状分类（8种症状对照表） |
| 第二章 | 零成本排查（释放静电/检查电源/外设/按键） |
| 第三章 | 轻度拆机（内存/硬盘/电池/主板目视） |
| 第四章 | 深度硬件（清灰换硅脂/CMOS/短路检测） |
| 第五章 | 软件/BIOS层排查 |
| 第六章 | 机械革命品牌特有问题 |
| 第七章 | 终极排查流程图 |
| 第八章 | 无界14+ (7840HS) 型号专属问题与解法 |

## 🛠️ 技术栈

- **Node.js + ws** — WebSocket 远程诊断中枢
- **PowerShell** — 系统守护与自动修复
- **原生 HTML/CSS/JS** — 零依赖前端（暗色主题）
- **Next.js 14 + TypeScript + Tailwind** — 交互式诊断向导

## 📁 项目结构

```
├── README.md                          # 本文件
├── AGENTS.md                          # AI Agent 操作指南
├── desktop_guardian.ps1                # 系统安全守护脚本
├── 诊断手册_笔记本开机自动关机.md       # 硬件排查知识库
├── frpc_mechrevo.example.toml         # FRP 配置模板
├── start_mechrevo_service.example.bat # 一键启动脚本模板
├── remote-agent/                      # WebSocket 远程诊断中枢
│   ├── server.js                     # 服务器 (五感+大脑+Agent)
│   ├── page.js                       # 前端页面 (暗色主题, 4Tab)
│   ├── brain.js                      # CLI 工具
│   ├── package.json                  # 仅依赖 ws 包
│   ├── .env.example                  # 环境变量模板
│   ├── frpc.example.toml             # FRP 配置模板
│   └── README.md                     # 详细文档
├── web/                               # Next.js 交互式诊断向导
│   ├── app/page.tsx                  # 核心页面 (诊断树+5视图)
│   ├── package.json
│   └── netlify.toml                  # Netlify 部署配置
└── docs/
    └── 双机保护手册.md                 # 详细保护体系文档
```

## 🔑 排查核心逻辑（三层递进）

| 层级 | 核心动作 | 预估成功率 |
|------|---------|-----------|
| ⚡ **零成本层** | 释放静电 → 检查电源 → 拔外设 → 检查按键 | ~40% |
| 🔧 **拆机层** | 重插内存(橡皮擦) → 检查电池 → 拔硬盘/CMOS放电 | ~35% |
| ⬆️ **系统层** | 散热清灰 → **升级BIOS** → DDU重装OEM驱动 → 送修 | ~25% |

## ⚠️ 无界14+ (7840HS) 已知通病

1. **BIOS旧版Bug** — 蓝屏/重启/内存异常 → 升级到 T140_PHX_13+
2. **780M掉驱动** — 黑屏卡死 → 用OEM驱动，不用AMD官方最新
3. **内存频率** — 出厂4800MHz避蓝屏，手动调5600可能不稳
4. **随机重启+嘎达声** — 主板供电回路问题
5. **电池0%/255%** — 电池管理IC故障
6. **S0睡眠耗电** — BIOS改S3或注册表修改

## 📄 License

MIT

## 🙏 致谢

- 机械革命用户社区
- CSDN / 博客园 / 知乎上分享维修经验的网友
- 所有开源工具的贡献者
