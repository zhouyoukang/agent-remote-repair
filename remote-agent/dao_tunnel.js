// ╔══════════════════════════════════════════════════════════╗
// ║  道 · 隧道 (dao_tunnel.js)                              ║
// ║  水善利万物而不争 — 自适应公网穿透                        ║
// ║                                                          ║
// ║  探测优先级: cloudflared → ngrok → SSH(localhost.run)    ║
// ║  全部失败则LAN模式。断线自动重连，无缝切换。              ║
// ║  用户无需配置: 零域名 · 零注册 · 零费用                  ║
// ╚══════════════════════════════════════════════════════════╝

const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

let _tunnelUrl = null;
let _tunnelProcess = null;
let _tunnelMethod = null; // 'cloudflared' | 'ngrok' | 'ssh'
let _reconnectAttempt = 0;
let _onUrlCallbacks = [];
let _stopped = false;
let _localPort = 0;

// ═══════════════════════════════════════════════════════════
// 二进制探测 — 道法自然: 有什么用什么, 不假设任何存在
// ═══════════════════════════════════════════════════════════

function _findBinary(name) {
  var isWin = process.platform === "win32";
  var exe = isWin ? name + ".exe" : name;
  // PATH
  try {
    var cmd = isWin ? "where " + exe + " 2>nul" : "which " + name;
    var result = execSync(cmd, {
      timeout: 3000,
      windowsHide: true,
      encoding: "utf-8",
    }).trim();
    if (result) return result.split("\n")[0].trim();
  } catch (e) {}
  // Local directory
  var local = path.join(__dirname, "..", exe);
  try {
    if (fs.existsSync(local) && fs.statSync(local).size > 100000) return local;
  } catch (e) {}
  var local2 = path.join(__dirname, exe);
  try {
    if (fs.existsSync(local2) && fs.statSync(local2).size > 100000)
      return local2;
  } catch (e) {}
  return null;
}

function _checkBinaryAsync(name) {
  return new Promise(function (resolve) {
    try {
      var proc = spawn(name, name === "ssh" ? ["-V"] : ["version"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      proc.on("error", function () {
        resolve(false);
      });
      proc.on("close", function () {
        resolve(true);
      });
      setTimeout(function () {
        try {
          proc.kill();
        } catch (e) {}
        resolve(false);
      }, 5000);
    } catch (e) {
      resolve(false);
    }
  });
}

// ═══════════════════════════════════════════════════════════
// URL提取 — 从子进程输出中解析公网URL
// ═══════════════════════════════════════════════════════════

function _notifyUrl(url) {
  if (url && url !== _tunnelUrl) {
    _tunnelUrl = url;
    _reconnectAttempt = 0;
    console.log("[tunnel:" + _tunnelMethod + "] Public URL: " + _tunnelUrl);
    for (var j = 0; j < _onUrlCallbacks.length; j++) {
      try {
        _onUrlCallbacks[j](_tunnelUrl);
      } catch (e) {}
    }
  }
}

function _extractUrl(line) {
  var match = line.match(/(https:\/\/[a-z0-9][\w.-]+\.[a-z]{2,})/i);
  return match ? match[1] : null;
}

// ═══════════════════════════════════════════════════════════
// 重连机制 — 反者道之动: 断开即重生
// ═══════════════════════════════════════════════════════════

function _scheduleReconnect() {
  if (_stopped) return;
  var oldUrl = _tunnelUrl;
  _tunnelUrl = null;
  _tunnelProcess = null;
  if (oldUrl) console.log("[tunnel] Disconnected (was: " + oldUrl + ")");
  _reconnectAttempt++;
  var delay = Math.min(60000, 5000 * Math.pow(2, _reconnectAttempt - 1));
  console.log(
    "[tunnel] Reconnecting in " +
      delay / 1000 +
      "s (#" +
      _reconnectAttempt +
      ")...",
  );
  setTimeout(function () {
    _startBest(_localPort);
  }, delay);
}

// ═══════════════════════════════════════════════════════════
// Cloudflared — 零注册Quick Tunnel (最优: 稳定+HTTPS+自动)
// ═══════════════════════════════════════════════════════════

function _startCloudflared(localPort, cfPath) {
  _tunnelMethod = "cloudflared";
  console.log("[tunnel:cloudflared] Starting quick tunnel → :" + localPort);

  _tunnelProcess = spawn(
    cfPath,
    ["tunnel", "--url", "http://localhost:" + localPort, "--no-autoupdate"],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );

  // cloudflared outputs URL on stderr
  _tunnelProcess.stderr.on("data", function (data) {
    var lines = data.toString().split("\n");
    for (var i = 0; i < lines.length; i++) {
      var url = _extractUrl(lines[i]);
      if (url && url.includes("trycloudflare.com")) {
        _notifyUrl(url);
      } else {
        var line = lines[i].trim();
        if (
          line &&
          !line.includes("INF") &&
          !line.includes("Thank you") &&
          !line.includes("cloudflare")
        )
          console.log("[tunnel:cf]", line);
      }
    }
  });
  _tunnelProcess.stdout.on("data", function (data) {
    var url = _extractUrl(data.toString());
    if (url) _notifyUrl(url);
  });
  _tunnelProcess.on("close", _scheduleReconnect);
  _tunnelProcess.on("error", function (err) {
    console.log("[tunnel:cloudflared] Error:", err.message);
    _scheduleReconnect();
  });
}

// ═══════════════════════════════════════════════════════════
// Ngrok — 需要注册但稳定 (次优)
// ═══════════════════════════════════════════════════════════

function _startNgrok(localPort, ngrokPath) {
  _tunnelMethod = "ngrok";
  console.log("[tunnel:ngrok] Starting tunnel → :" + localPort);

  _tunnelProcess = spawn(
    ngrokPath,
    ["http", String(localPort), "--log", "stdout", "--log-format", "term"],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );

  _tunnelProcess.stdout.on("data", function (data) {
    var lines = data.toString().split("\n");
    for (var i = 0; i < lines.length; i++) {
      var url = _extractUrl(lines[i]);
      if (url && url.includes("ngrok")) _notifyUrl(url);
    }
  });
  _tunnelProcess.stderr.on("data", function (data) {
    var url = _extractUrl(data.toString());
    if (url) _notifyUrl(url);
  });
  _tunnelProcess.on("close", _scheduleReconnect);
  _tunnelProcess.on("error", function (err) {
    console.log("[tunnel:ngrok] Error:", err.message);
    _scheduleReconnect();
  });
}

// ═══════════════════════════════════════════════════════════
// SSH → localhost.run — 免注册免安装 (兜底)
// ═══════════════════════════════════════════════════════════

function _startSSH(localPort) {
  _tunnelMethod = "ssh";
  console.log("[tunnel:ssh] Connecting to localhost.run → :" + localPort);

  _tunnelProcess = spawn(
    "ssh",
    [
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "ServerAliveInterval=30",
      "-o",
      "ServerAliveCountMax=3",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "LogLevel=ERROR",
      "-R",
      "80:localhost:" + localPort,
      "nokey@localhost.run",
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );

  _tunnelProcess.stdout.on("data", function (data) {
    var lines = data.toString().split("\n");
    for (var i = 0; i < lines.length; i++) {
      var url = _extractUrl(lines[i].trim());
      if (url) _notifyUrl(url);
    }
  });
  _tunnelProcess.stderr.on("data", function (data) {
    var line = data.toString().trim();
    if (
      line &&
      !line.includes("Warning:") &&
      !line.includes("Permanently added")
    ) {
      console.log("[tunnel:ssh]", line);
    }
  });
  _tunnelProcess.on("close", _scheduleReconnect);
  _tunnelProcess.on("error", function (err) {
    console.log("[tunnel:ssh] Error:", err.message);
    _scheduleReconnect();
  });
}

// ═══════════════════════════════════════════════════════════
// 自适应选择 — 上善若水: 有cloudflared用cloudflared, 有ngrok用
// ngrok, 有SSH用SSH, 全无则LAN
// ═══════════════════════════════════════════════════════════

async function _startBest(localPort) {
  if (_stopped) return;

  // ① cloudflared (最优)
  var cfPath = _findBinary("cloudflared");
  if (cfPath) {
    _startCloudflared(localPort, cfPath);
    return;
  }

  // ② ngrok (次优)
  var ngrokPath = _findBinary("ngrok");
  if (ngrokPath) {
    _startNgrok(localPort, ngrokPath);
    return;
  }

  // ③ SSH → localhost.run (兜底)
  var hasSSH = await _checkBinaryAsync("ssh");
  if (hasSSH) {
    _startSSH(localPort);
    return;
  }

  console.log("[tunnel] 无可用隧道工具 (cloudflared/ngrok/ssh)");
  console.log("[tunnel] 仅局域网模式 — 安装任一工具即可自动公网穿透");
}

// ═══════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════

async function start(localPort) {
  _stopped = false;
  _localPort = localPort;
  await _startBest(localPort);
  return true;
}

function stop() {
  _stopped = true;
  if (_tunnelProcess) {
    try {
      _tunnelProcess.kill();
    } catch (e) {}
    _tunnelProcess = null;
  }
  _tunnelUrl = null;
}

function onUrl(callback) {
  _onUrlCallbacks.push(callback);
  if (_tunnelUrl) {
    try {
      callback(_tunnelUrl);
    } catch (e) {}
  }
}

function waitForUrl(timeoutMs) {
  timeoutMs = timeoutMs || 15000;
  if (_tunnelUrl) return Promise.resolve(_tunnelUrl);
  return new Promise(function (resolve) {
    var done = false;
    var timer = setTimeout(function () {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, timeoutMs);
    onUrl(function (url) {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(url);
      }
    });
  });
}

module.exports = {
  start: start,
  stop: stop,
  onUrl: onUrl,
  waitForUrl: waitForUrl,
  get url() {
    return _tunnelUrl;
  },
  get active() {
    return !!_tunnelProcess;
  },
  get method() {
    return _tunnelMethod;
  },
};
