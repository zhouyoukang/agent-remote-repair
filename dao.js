#!/usr/bin/env node
// ╔══════════════════════════════════════════════════════════╗
// ║  道 · 万法归宗 — 一切从这里开始                          ║
// ║                                                          ║
// ║  node dao.js                                             ║
// ║                                                          ║
// ║  一个命令:                                                ║
// ║    ① 启动 WebSocket 诊断中枢 (remote-agent)              ║
// ║    ② 启动 HTTP Agent Relay (ps-agent)                    ║
// ║    ③ 自动建立公网隧道 (SSH → localhost.run)              ║
// ║    ④ 自动生成共享Token                                   ║
// ║    ⑤ 自动发现 · 自动配置 · 用户彻底无为                  ║
// ╚══════════════════════════════════════════════════════════╝

const { spawn } = require("child_process");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

// ═══════════════════════════════════════════════════════════
// Config — zero env files needed, all auto-generated
// ═══════════════════════════════════════════════════════════

const HUB_PORT = parseInt(process.env.PORT || "3002", 10);
const RELAY_PORT = parseInt(process.env.PS_AGENT_PORT || "9910", 10);
const SHARED_TOKEN =
  process.env.PS_AGENT_MASTER_TOKEN ||
  crypto.randomBytes(24).toString("base64url");
const NO_TUNNEL =
  process.argv.includes("--no-tunnel") || process.env.NO_TUNNEL === "1";

var relayProcess = null;
var relayRestarting = false;

// ═══════════════════════════════════════════════════════════
// LAN IP detection
// ═══════════════════════════════════════════════════════════

function getLanIPs() {
  var ips = [];
  var nets = os.networkInterfaces();
  for (var name of Object.keys(nets)) {
    for (var iface of nets[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  // 道法自然: 按可达性排序 — 真实LAN优先, 虚拟网卡靠后
  // 192.168.x.x = 家庭/办公(最常见), 10.x = 企业/VPN, 172.16-31 = Docker/Hyper-V
  ips.sort(function (a, b) {
    return ipScore(a) - ipScore(b);
  });
  return ips;
}

function ipScore(ip) {
  if (/^192\.168\./.test(ip)) return 0; // 家庭/办公LAN — 最优
  if (/^10\./.test(ip)) return 2; // 企业网/VPN — 可能是虚拟
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 3; // Docker/Hyper-V — 通常不可达
  return 1; // 其他 — 中等
}

function getBestLanIP() {
  // 最优: 解析路由表找默认出口网卡IP
  try {
    var out = require("child_process")
      .execSync("route print 0.0.0.0", { timeout: 3000, windowsHide: true })
      .toString();
    var lines = out.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var parts = lines[i].trim().split(/\s+/);
      // Windows route print: Network Destination  Netmask  Gateway  Interface  Metric
      if (
        parts.length >= 5 &&
        parts[0] === "0.0.0.0" &&
        parts[1] === "0.0.0.0"
      ) {
        var ifaceIP = parts[3];
        if (
          ifaceIP &&
          /^\d+\.\d+\.\d+\.\d+$/.test(ifaceIP) &&
          ifaceIP !== "0.0.0.0"
        ) {
          return ifaceIP;
        }
      }
    }
  } catch (e) {}
  // 回退: 排序启发式
  var ips = getLanIPs();
  return ips.length > 0 ? ips[0] : null;
}

// ═══════════════════════════════════════════════════════════
// Start PS Agent Relay (python child process)
// ═══════════════════════════════════════════════════════════

function startRelay() {
  if (relayRestarting) return;
  var env = Object.assign({}, process.env, {
    PS_AGENT_PORT: String(RELAY_PORT),
    PS_AGENT_MASTER_TOKEN: SHARED_TOKEN,
    PS_AGENT_PUBLIC_URL: "http://localhost:" + RELAY_PORT,
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
        startRelay();
      }, 5000);
    }
  });
  relayProcess.on("error", function (err) {
    console.log("[relay!] Failed to start python: " + err.message);
    console.log(
      "[relay!] PS Agent Relay requires Python 3. Install from python.org",
    );
    console.log(
      "[relay!] Hub will still work without Relay (WebSocket direct only)",
    );
  });
}

// ═══════════════════════════════════════════════════════════
// Start Hub (server.js — same process via require)
// ═══════════════════════════════════════════════════════════

function startHub() {
  // Set env before requiring server.js
  process.env.PORT = String(HUB_PORT);
  process.env.PS_AGENT_MASTER_TOKEN = SHARED_TOKEN;
  process.env.RELAY_PORT = String(RELAY_PORT);

  var bestIP = getBestLanIP();
  var defaultPublic = bestIP
    ? bestIP + ":" + HUB_PORT
    : "localhost:" + HUB_PORT;
  process.env.PUBLIC_URL = process.env.PUBLIC_URL || defaultPublic;

  var hub = require("./remote-agent/server");
  hub.start(HUB_PORT);
  return hub;
}

// ═══════════════════════════════════════════════════════════
// Start Tunnel (SSH → localhost.run, zero config)
// ═══════════════════════════════════════════════════════════

function startTunnel(hub) {
  if (NO_TUNNEL) {
    console.log("[tunnel] Disabled (--no-tunnel)");
    return;
  }

  var tunnel = require("./remote-agent/dao_tunnel");

  tunnel.onUrl(function (url) {
    // Strip trailing slash, extract host
    var host = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    hub.setPublicUrl(host);

    console.log("");
    console.log("  ╔═══════════════════════════════════════════════════╗");
    console.log("  ║  公网隧道已建立 — 任何地方均可接入                ║");
    console.log("  ╠═══════════════════════════════════════════════════╣");
    console.log("  ║  " + pad("URL:   " + url, 49) + " ║");
    console.log("  ║  " + pad("Agent: irm " + url + "/go | iex", 49) + " ║");
    console.log("  ╚═══════════════════════════════════════════════════╝");
    console.log("");
  });

  tunnel.start(HUB_PORT).then(function (started) {
    if (!started) {
      console.log("[tunnel] Will use LAN access only");
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
  var lanIPs = getLanIPs();

  console.log("");
  console.log("  ╔══════════════════════════════════════════╗");
  console.log("  ║   道 · Agent Remote Repair Hub v3.0      ║");
  console.log("  ║   一切从这里开始 · 用户彻底无为          ║");
  console.log("  ╚══════════════════════════════════════════╝");
  console.log("");
  console.log("  Token:  " + SHARED_TOKEN.substring(0, 12) + "...");
  console.log("  LAN:    " + (lanIPs.join(", ") || "none"));
  console.log("  Hub:    :" + HUB_PORT);
  console.log("  Relay:  :" + RELAY_PORT);
  console.log("  Tunnel: " + (NO_TUNNEL ? "disabled" : "auto (localhost.run)"));
  console.log("");

  // ① Start relay (give it a head start)
  startRelay();

  // ② Start hub (after short delay for relay to bind port)
  setTimeout(function () {
    var hub = startHub();

    // ③ Start tunnel
    setTimeout(function () {
      startTunnel(hub);
    }, 1000);
  }, 1500);
}

// Graceful shutdown
process.on("SIGINT", function () {
  console.log("\n[dao] Shutting down...");
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

main();
