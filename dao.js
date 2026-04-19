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
const {
  DaoRendezvousBeacon,
  deriveSigil,
} = require("./remote-agent/dao_rendezvous");
const { DaoNat } = require("./remote-agent/dao_nat");
const { DaoMdns } = require("./remote-agent/dao_mdns");

// ═══════════════════════════════════════════════════════════
// 道核 — 一切从此涌现，不从环境变量，不从配置文件
// ═══════════════════════════════════════════════════════════

var kernel = new DaoKernel();
var relayProcess = null;
var relayRestarting = false;
var ghostProcess = null;
var ghostRestarting = false;
var rendezvousBeacon = null;
var natMapper = null;
var mdnsAdvert = null;

// 唯变所适: CLI覆盖仅在用户明确指定时生效
// --lan-only: 两仪不出门 · 关闭所有公网暴露 (= --no-tunnel + --no-nat)
var LAN_ONLY =
  process.argv.includes("--lan-only") || process.env.DAO_LAN_ONLY === "1";
var NO_TUNNEL =
  LAN_ONLY ||
  process.argv.includes("--no-tunnel") ||
  process.env.NO_TUNNEL === "1";
// --no-nat: 显式禁用 UPnP/NAT-PMP (与 DAO_NO_NAT 对称, CLI 用户无需设 env)
if (
  LAN_ONLY ||
  process.argv.includes("--no-nat") ||
  process.env.DAO_NO_NAT === "1"
) {
  process.env.DAO_NO_NAT = "1";
}
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
      // 道·反者道之动: 若因端口权限 (Windows 保留) 反复失败, 换个新口
      var nextPort = code !== 0 ? DaoEntropy.portSync() : relayPort;
      if (nextPort !== relayPort) {
        _log(
          "[relay] Exited (" +
            code +
            "), port " +
            relayPort +
            " may be reserved — retrying on " +
            nextPort +
            " in 5s...",
        );
      } else {
        _log("[relay] Exited (" + code + "), restarting in 5s...");
      }
      relayRestarting = true;
      setTimeout(function () {
        relayRestarting = false;
        startRelay(nextPort, token);
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
// Start Ghost Shell (Go binary — 原生Win32投屏/控制引擎)
// 道法自然: GDI BitBlt + SendInput + WASAPI, 单binary零依赖
// 去芜存菁: 替代 dao_screen.js (Node→PowerShell→C#三层链路)
// ═══════════════════════════════════════════════════════════

function findGhostShell() {
  var fs = require("fs");
  // 道法自然: 从近到远, 逐级寻觅
  var candidates = [
    path.join(__dirname, "ghost_shell.exe"),
    path.join(__dirname, "bin", "ghost_shell.exe"),
    path.join(__dirname, "..", "ghost_shell", "ghost_shell.exe"),
  ];
  // 环境变量覆盖 — 万法归宗
  if (process.env.GHOST_SHELL_PATH) {
    candidates.unshift(process.env.GHOST_SHELL_PATH);
  }
  for (var i = 0; i < candidates.length; i++) {
    try {
      if (fs.existsSync(candidates[i])) return candidates[i];
    } catch (e) {}
  }
  return null;
}

function isGhostAlive(port) {
  var http = require("http");
  return new Promise(function (resolve) {
    var req = http.get(
      "http://127.0.0.1:" + port + "/status",
      { timeout: 2000 },
      function (res) {
        var d = "";
        res.on("data", function (c) {
          d += c;
        });
        res.on("end", function () {
          resolve(true);
        });
      },
    );
    req.on("error", function () {
      resolve(false);
    });
    req.on("timeout", function () {
      req.destroy();
      resolve(false);
    });
  });
}

function startGhostShell(port) {
  if (ghostRestarting) return;
  var ghostPort = port || 8000;
  process.env.GHOST_SHELL_PORT = String(ghostPort);

  // 先探: 已有 ghost_shell 在运行?
  isGhostAlive(ghostPort).then(function (alive) {
    if (alive) {
      _log(
        "[ghost] 已发现运行中的 ghost_shell :" +
          ghostPort +
          " — 道法自然, 无需启动",
      );
      return;
    }

    // 寻: 查找 ghost_shell.exe
    var ghostPath = findGhostShell();
    if (!ghostPath) {
      _log(
        "[ghost] ghost_shell.exe 未找到 — Hub仍可运行, 投屏源将由server.js探测",
      );
      _log(
        "[ghost] 提示: 将 ghost_shell.exe 放入 bin/ 或项目根目录即可自动启动",
      );
      return;
    }

    _log("[ghost] 启动 " + ghostPath);
    ghostProcess = spawn(ghostPath, [], {
      cwd: path.dirname(ghostPath),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
    });

    ghostProcess.stdout.on("data", function (d) {
      d.toString()
        .split("\n")
        .forEach(function (line) {
          line = line.trim();
          if (line) console.log("[ghost] " + line);
        });
    });
    ghostProcess.stderr.on("data", function (d) {
      var line = d.toString().trim();
      if (line) console.log("[ghost!] " + line);
    });
    ghostProcess.on("close", function (code) {
      ghostProcess = null;
      if (!ghostRestarting) {
        _log("[ghost] Exited (" + code + "), restarting in 5s...");
        ghostRestarting = true;
        setTimeout(function () {
          ghostRestarting = false;
          startGhostShell(ghostPort);
        }, 5000);
      }
    });
    ghostProcess.on("error", function (err) {
      _log("[ghost!] 启动失败: " + err.message);
    });
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

  // 万法之资 · 唯变所适: 端口与令牌皆从身份派生, 無字面量后备
  // · 端口: 用户 env 覆盖 → 默认首选 → server.js 在 registry 里探测 portCandidates [base, +1, +2]
  //   所以这里仅传递 "首选" 值; 窞死后 registry 自动发现实际存活端口
  // · 令牌: ADB_HUB_TOKEN 从 Ed25519 身份确定性派生, 没有任何字面量 fallback
  var preferredPorts = {
    SCRCPY_HUB_PORT: process.env.SCRCPY_HUB_PORT || "8890",
    MJPEG_PORT: process.env.MJPEG_PORT || "8081",
    INPUT_PORT: process.env.INPUT_PORT || "8084",
    GHOST_SHELL_PORT: process.env.GHOST_SHELL_PORT || "8000",
    DAO_REMOTE_PORT: process.env.DAO_REMOTE_PORT || "9900",
    ADB_HUB_PORT: process.env.ADB_HUB_PORT || "9861",
    SUNLOGIN_PORT: process.env.SUNLOGIN_PORT || "13333",
  };
  Object.assign(process.env, preferredPorts);
  // ADB_HUB_TOKEN 四级涌现 (道可道 非常少):
  //   ① env 覆盖 (用户明确指定)
  //   ② 身份派生 serviceToken (永远可算, 跨进程等价)  ⬅ 默认走这条
  //   ③ 缓存文件 (共享同机协作)  ⬅ server.js 负责写
  //   ④ 无字面量后备 — 失败就失败, 让问题暴露
  if (!process.env.ADB_HUB_TOKEN) {
    try {
      process.env.ADB_HUB_TOKEN = kernel.identity.serviceToken("adb_hub", 32);
    } catch (e) {
      _log("[道核] ADB_HUB_TOKEN 派生失败: " + e.message);
    }
  }

  // 注入道核状态供server.js使用
  process.env.DAO_FINGERPRINT = kernel.identity.fingerprint;
  process.env.DAO_ADB_PATH = kernel.discovery.adbPath || "";
  process.env.DAO_ADB_DEVICES = kernel.discovery.adbDevices.join(",");
  process.env.DAO_BEST_INPUT = kernel.capability.bestInput().split(":")[0];
  process.env.DAO_BEST_CODEC = kernel.capability.bestCodec();
  process.env.DAO_REMOTE_TOOLS = JSON.stringify(
    kernel.discovery.remoteTools || [],
  );

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
    // 把公网 URL 一并写入 LAN 信标, 同网段客户端也能直连公网入口
    if (rendezvousBeacon) rendezvousBeacon.setPublicUrl(url);

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
  // Ed25519 签名令牌 — 7天有效, 重启自动刷新 (替代硬编码共享密码)
  var token = kernel.identity.createToken(86400 * 7, { role: "master" });

  console.log("");
  console.log("  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║   道 · Agent Remote Repair Hub v8.7                  ║");
  console.log("  ║   Ed25519端到端 · 道核驱动 · 唯变所适 · 万法归宗    ║");
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
  // ① Ghost Shell (Go native, 先启动给hub探测时间)
  //   端口首选来自 env (用户可覆盖), 否则沿用传统 8000
  var ghostPort = parseInt(process.env.GHOST_SHELL_PORT || "8000", 10);
  startGhostShell(ghostPort);

  // ② Relay (child process, auto-discovered by bridge)
  startRelay(relayPort, token);

  // 道法自然: 给screen service 2秒启动时间, hub初始探测才能发现
  setTimeout(function () {
    // ③ Hub (in-process)
    var hub = startHub(hubPort, relayPort, token);

    // ─── 二生三: 连接外部 ───
    // ④ Tunnel (non-blocking) + NAT 自穿 (并行尝试, 任一成功即公网可达)
    startTunnel(hub, hubPort);
    startNat(hub, hubPort);

    // ⑤ 太上不知有之: LAN 多播信标 (同网段客户端无 URL 自发现)
    startRendezvous(hubPort);

    // ⑤b mDNS · dao-<fp8>.local — Bonjour/Avahi/Windows 原生解析
    //   同网段任意设备浏览器输入 http://dao-xxxxxxxx.local:<port>/ 即达
    //   无需配 IP, 无需扫码 (补扫码的盲区)
    startMdns(hubPort);

    // ─── 三生万物: 本地入口 ───
    var bestIP = kernel.discovery.getBestIP() || "127.0.0.1";
    console.log("  3D世界: http://" + bestIP + ":" + hubPort + "/marble");
    console.log(
      "  投屏:  http://" + bestIP + ":" + ghostPort + " (ghost_shell)",
    );
    console.log("  配对:  http://" + bestIP + ":" + hubPort + "/pair (QR)");

    // ⑥ 不知有之 · 自动打开本机浏览器 (127.0.0.1 走本机免鉴权, 用户零动作入控)
    //   可禁用: DAO_NO_BROWSER=1 或 --no-browser
    var noBrowser =
      process.env.DAO_NO_BROWSER === "1" ||
      process.argv.includes("--no-browser");
    if (!noBrowser) {
      setTimeout(function () {
        openLocalBrowser("http://127.0.0.1:" + hubPort + "/");
      }, 1200);
    }
  }, 2500);
}

// ═══════════════════════════════════════════════════════════
// 不知有之 · 自动浏览器落地 — 道法自然
// ═══════════════════════════════════════════════════════════
function openLocalBrowser(url) {
  try {
    var platform = process.platform;
    if (platform === "win32") {
      // Windows: start "" "<url>" — 空标题参数防止引号歧义
      spawn("cmd", ["/c", "start", "", url], {
        stdio: "ignore",
        detached: true,
        windowsHide: true,
      }).unref();
    } else if (platform === "darwin") {
      spawn("open", [url], {
        stdio: "ignore",
        detached: true,
      }).unref();
    } else {
      // linux / bsd
      spawn("xdg-open", [url], {
        stdio: "ignore",
        detached: true,
      }).unref();
    }
    _log("[浏览器] 已自启: " + url + "  (禁用: --no-browser)");
  } catch (e) {
    _log("[浏览器] 自启失败 (已跳过): " + e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// mDNS · dao-<fp8>.local — 同网段浏览器原生可达
// ═══════════════════════════════════════════════════════════
function startMdns(hubPort) {
  if (process.env.DAO_NO_MDNS === "1") {
    _log("[mDNS] 已禁用 (DAO_NO_MDNS=1)");
    return;
  }
  try {
    mdnsAdvert = new DaoMdns({
      fingerprint: kernel.identity.fingerprint,
      port: hubPort,
      path: "/c",
    });
    mdnsAdvert.start();
    var host = "dao-" + kernel.identity.fingerprint.slice(0, 8) + ".local";
    console.log("  mDNS:  http://" + host + ":" + hubPort + "/");
  } catch (e) {
    _log("[mDNS] 启动失败: " + e.message + " (已跳过)");
  }
}

// ═══════════════════════════════════════════════════════════
// LAN 多播信标 — 太上, 不知有之
// ═══════════════════════════════════════════════════════════
function startRendezvous(hubPort) {
  try {
    var sigil = deriveSigil(kernel.identity.fingerprint);
    rendezvousBeacon = new DaoRendezvousBeacon({
      fingerprint: kernel.identity.fingerprint,
      port: hubPort,
      publicUrl: kernel.publicUrl || "",
      sigil: sigil,
    });
    rendezvousBeacon.start();
  } catch (e) {
    _log("[信标] 启动失败: " + e.message + " (已跳过)");
  }
}

// ═══════════════════════════════════════════════════════════
// NAT 自穿 — 打通到底, 不借外力
// ═══════════════════════════════════════════════════════════
function startNat(hub, hubPort) {
  if (process.env.DAO_NO_NAT === "1") {
    _log("[NAT] 已禁用 (DAO_NO_NAT=1)");
    return;
  }
  try {
    natMapper = new DaoNat();
    // 公开给 server.js 的 /dao/discover /pair 端点即时读取
    global.__daoNat = natMapper;
    natMapper
      .start(hubPort, {
        description: "dao-remote/" + kernel.identity.fingerprint.slice(0, 8),
      })
      .then(function (result) {
        if (!result || !result.publicUrl) return;
        var host = result.publicUrl
          .replace(/^https?:\/\//, "")
          .replace(/\/$/, "");
        if (hub && typeof hub.setPublicUrl === "function")
          hub.setPublicUrl(host);
        kernel.publicUrl = result.publicUrl;
        if (rendezvousBeacon) rendezvousBeacon.setPublicUrl(result.publicUrl);
        console.log("");
        console.log(
          "  ╔═══ NAT 穿透成功 (" +
            result.protocol +
            ") ═════════════════════╗",
        );
        console.log("  ║  公网: " + pad(result.publicUrl, 49) + " ║");
        console.log(
          "  ╚═══════════════════════════════════════════════════════════╝",
        );
        console.log("");
      })
      .catch(function (e) {
        _log("[NAT] 穿透未能成功: " + e.message + " (退 LAN)");
      });
  } catch (e) {
    _log("[NAT] 启动异常: " + e.message);
  }
}

// Graceful shutdown
process.on("SIGINT", function () {
  console.log("\n[dao] 道归无极...");
  if (ghostProcess) {
    try {
      ghostRestarting = true;
      ghostProcess.kill();
    } catch (e) {}
  }
  if (relayProcess) {
    try {
      relayProcess.kill();
    } catch (e) {}
  }
  if (rendezvousBeacon) {
    try {
      rendezvousBeacon.stop();
    } catch (e) {}
  }
  if (natMapper) {
    try {
      natMapper.stop();
    } catch (e) {}
  }
  if (mdnsAdvert) {
    try {
      mdnsAdvert.stop();
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

// ═══════════════════════════════════════════════════════════
// CLI 子命令 — 开机自启守护: --install / --uninstall / --service-status
// 无为而无不为: 不与 main 争道, 命中则处理完毕即退出
// ═══════════════════════════════════════════════════════════
(function dispatchServiceCli() {
  var argv = process.argv;
  var daoService;
  function lazy() {
    if (!daoService) daoService = require("./dao_service");
    return daoService;
  }
  function runAndExit(promise) {
    promise
      .then(function (r) {
        console.log(JSON.stringify(r, null, 2));
        process.exit(r.ok || r.installed ? 0 : 1);
      })
      .catch(function (e) {
        console.error(e && e.stack ? e.stack : e);
        process.exit(2);
      });
  }
  if (argv.includes("--install")) {
    runAndExit(lazy().install({ extraArgs: ["--no-browser"] }));
    return;
  }
  if (argv.includes("--uninstall")) {
    runAndExit(lazy().uninstall());
    return;
  }
  if (argv.includes("--service-status")) {
    runAndExit(lazy().status());
    return;
  }
  main();
})();
