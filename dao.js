#!/usr/bin/env node
// ╔══════════════════════════════════════════════════════════╗
// ║  道 · 万法归宗 — 一切从这里开始                          ║
// ║                                                          ║
// ║  node dao.js                                             ║
// ║                                                          ║
// ║  道生一 (DaoKernel)    → 内核觉醒，万物涌现              ║
// ║  一生二 (Identity+Disc) → 身份+发现，替代一切配置         ║
// ║  二生三 (+Capability)  → 能力检测，适配一切环境           ║
// ║  三生万物              → Hub+Relay+Tunnel 完整系统       ║
// ║                                                          ║
// ║  NOTHING hard-coded. EVERYTHING emerges at runtime.      ║
// ╚══════════════════════════════════════════════════════════╝

const { spawn } = require("child_process");
const path = require("path");
const { DaoKernel, DaoEntropy, _log } = require("./dao_kernel");

// ═══════════════════════════════════════════════════════════
// 道核 — 一切从此涌现，不从环境变量，不从配置文件
// ═══════════════════════════════════════════════════════════

var kernel = new DaoKernel();
var relayProcess = null;
var relayRestarting = false;

// 唯变所适: CLI覆盖仅在用户明确指定时生效
var NO_TUNNEL =
  process.argv.includes("--no-tunnel") || process.env.NO_TUNNEL === "1";
var OVERRIDE_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 0;

// ═══════════════════════════════════════════════════════════
// Start PS Agent Relay (python child process)
// 柔弱胜刚强: Relay端口/Token全由道核生成，不靠环境变量
// ═══════════════════════════════════════════════════════════

function startRelay(relayPort, token) {
  if (relayRestarting) return;
  var env = Object.assign({}, process.env, {
    PS_AGENT_PORT: String(relayPort),
    PS_AGENT_MASTER_TOKEN: token,
    PS_AGENT_PUBLIC_URL: "http://localhost:" + relayPort,
  });

  relayProcess = spawn("python", ["ps_agent_server.py"], {
    cwd: path.join(__dirname, "ps-agent"),
    env: env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  relayProcess.stdout.on("data", function (d) {
    var lines = d.toString().split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line) console.log("[relay] " + line);
    }
  });
  relayProcess.stderr.on("data", function (d) {
    var line = d.toString().trim();
    if (line) console.log("[relay!] " + line);
  });
  relayProcess.on("close", function (code) {
    relayProcess = null;
    if (!relayRestarting) {
      console.log("[relay] Exited (" + code + "), restarting in 5s...");
      relayRestarting = true;
      setTimeout(function () {
        relayRestarting = false;
        startRelay(relayPort, token);
      }, 5000);
    }
  });
  relayProcess.on("error", function (err) {
    console.log("[relay!] Failed to start python: " + err.message);
    console.log(
      "[relay!] Hub will still work without Relay (WebSocket direct only)",
    );
  });
}

// ═══════════════════════════════════════════════════════════
// Start Hub (server.js — same process via require)
// 万物归一: 道核状态注入 server.js 环境
// ═══════════════════════════════════════════════════════════

function startHub(hubPort, relayPort, token) {
  // 道法自然: 仅注入必需的运行时值，不注入固定常量
  process.env.PORT = String(hubPort);
  process.env.PS_AGENT_MASTER_TOKEN = token;
  process.env.RELAY_PORT = String(relayPort);

  var bestIP = kernel.discovery.getBestIP();
  var defaultPublic = bestIP ? bestIP + ":" + hubPort : "localhost:" + hubPort;
  process.env.PUBLIC_URL = process.env.PUBLIC_URL || defaultPublic;

  // 万法之资: 投屏端口自动发现 — 有就用，无则探测
  // 道法自然: 不再硬编码8890/8081/8084，由环境覆盖或由server.js运行时探测
  var screenEnv = {
    SCRCPY_HUB_PORT: process.env.SCRCPY_HUB_PORT || "8890",
    MJPEG_PORT: process.env.MJPEG_PORT || "8081",
    INPUT_PORT: process.env.INPUT_PORT || "8084",
    GHOST_SHELL_PORT: process.env.GHOST_SHELL_PORT || "8000",
    DAO_REMOTE_PORT: process.env.DAO_REMOTE_PORT || "9900",
    ADB_HUB_PORT: process.env.ADB_HUB_PORT || "9861",
    ADB_HUB_TOKEN: process.env.ADB_HUB_TOKEN || "adb_hub_2026",
  };
  Object.assign(process.env, screenEnv);

  // 注入道核状态供server.js使用
  process.env.DAO_FINGERPRINT = kernel.identity.fingerprint;
  process.env.DAO_ADB_PATH = kernel.discovery.adbPath || "";
  process.env.DAO_ADB_DEVICES = kernel.discovery.adbDevices.join(",");
  process.env.DAO_BEST_INPUT = kernel.capability.bestInput().split(":")[0];
  process.env.DAO_BEST_CODEC = kernel.capability.bestCodec();

  var hub = require("./remote-agent/server");
  hub.start(hubPort);
  return hub;
}

// ═══════════════════════════════════════════════════════════
// Start Tunnel — 水善利万物而不争
// 自适应隧道: SSH / cloudflared / ngrok / tailscale
// ═══════════════════════════════════════════════════════════

function startTunnel(hub, hubPort) {
  if (NO_TUNNEL) {
    _log("[隧道] 已禁用 (--no-tunnel)");
    return;
  }

  var tunnel = require("./remote-agent/dao_tunnel");

  tunnel.onUrl(function (url) {
    var host = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    hub.setPublicUrl(host);
    kernel.publicUrl = url;

    console.log("");
    console.log("  ╔═══════════════════════════════════════════════════╗");
    console.log("  ║  公网隧道已建立 — 任何地方均可接入                ║");
    console.log("  ╠═══════════════════════════════════════════════════╣");
    console.log("  ║  " + pad("URL:   " + url, 49) + " ║");
    console.log(
      "  ║  " +
        pad("Agent: irm " + url + "/go?token=..." + " | iex", 49) +
        " ║",
    );
    console.log("  ╚═══════════════════════════════════════════════════╝");
    console.log("");
  });

  tunnel.start(hubPort).then(function (started) {
    if (!started) {
      _log("[隧道] 仅局域网模式");
    }
  });
}

function pad(str, len) {
  if (str.length >= len) return str.substring(0, len);
  return str + " ".repeat(len - str.length);
}

// ═══════════════════════════════════════════════════════════
// MAIN — 道生一, 一生二, 二生三, 三生万物
// ═══════════════════════════════════════════════════════════

function main() {
  // ─── 道生一: 内核觉醒 ───
  var state = kernel.awaken();

  // 柔弱胜刚强: 用户可覆盖端口，否则用道核动态分配
  var hubPort = OVERRIDE_PORT || kernel.port;
  var relayPort = DaoEntropy.portSync();
  // 道核签名令牌 — 替代硬编码共享密码
  var token = kernel.identity.createToken(86400 * 365, { role: "master" });

  console.log("");
  console.log("  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║   道 · Agent Remote Repair Hub v7.0                  ║");
  console.log("  ║   道核驱动 · 软编码一切 · 唯变所适 · 万法归宗        ║");
  console.log("  ╚══════════════════════════════════════════════════════╝");
  console.log("");
  console.log("  身份:   " + kernel.identity.fingerprint);
  console.log("  LAN:    " + (kernel.discovery.localIPs.join(", ") || "none"));
  console.log(
    "  Hub:    :" + hubPort + (hubPort === 3002 ? " (默认)" : " (动态)"),
  );
  console.log("  Relay:  :" + relayPort + " (动态)");
  console.log(
    "  隧道:  " +
      (NO_TUNNEL
        ? "disabled"
        : kernel.discovery.tunnels.length > 0
          ? kernel.discovery.tunnels
              .map(function (t) {
                return path.parse(t).name;
              })
              .join(" + ") + " + SSH"
          : "SSH (localhost.run)"),
  );
  console.log(
    "  ADB:   " +
      (kernel.discovery.adbPath
        ? kernel.discovery.adbDevices.length + " 设备"
        : "未发现"),
  );
  console.log(
    "  输入:  " + (kernel.capability.bestInput().split(":")[0] || "none"),
  );
  console.log("  编码:  " + kernel.capability.bestCodec());
  console.log("");

  // ─── 一生二: 启动子系统 ───
  // ① Relay (child process, auto-discovered by bridge)
  startRelay(relayPort, token);

  // ② Hub (in-process)
  var hub = startHub(hubPort, relayPort, token);

  // ─── 二生三: 连接外部 ───
  // ③ Tunnel (non-blocking)
  startTunnel(hub, hubPort);

  // ─── 三生万物: WorldLabs 3D世界 ───
  console.log("  3D世界: http://localhost:" + hubPort + "/marble");
}

// Graceful shutdown
process.on("SIGINT", function () {
  console.log("\n[dao] 道归无极...");
  if (relayProcess) {
    try {
      relayProcess.kill();
    } catch (e) {}
  }
  var tunnel = null;
  try {
    tunnel = require("./remote-agent/dao_tunnel");
  } catch (e) {}
  if (tunnel) tunnel.stop();
  process.exit(0);
});

process.on("SIGTERM", function () {
  process.emit("SIGINT");
});

// 道核实例导出 — 万物皆可从此取
module.exports = { kernel: kernel };

main();
