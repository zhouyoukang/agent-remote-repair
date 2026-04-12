// ============================================================
// 道 · 隧道 (dao_tunnel.js)
// 零配置公网接入 — 用户无为, 系统自通
//
// 自动 SSH 隧道 → localhost.run (免费, 无需注册, 无需域名)
// 用户无需配置 FRP / Cloudflare / Nginx / 域名 / 公网IP
// 一切自动: 建立 → 解析URL → 断线重连 → 无感切换
// ============================================================

const { spawn } = require("child_process");

let _tunnelUrl = null;
let _tunnelProcess = null;
let _reconnecting = false;
let _onUrlCallbacks = [];
let _stopped = false;

// ═══════════════════════════════════════════════════════════
// SSH availability check
// ═══════════════════════════════════════════════════════════

function checkSSH() {
  return new Promise(function (resolve) {
    try {
      var proc = spawn("ssh", ["-V"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      proc.on("error", function () {
        resolve(false);
      });
      proc.on("close", function (code) {
        resolve(true); // ssh -V exits 0 on most systems, but even non-zero means it exists
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
// Tunnel lifecycle
// ═══════════════════════════════════════════════════════════

function _createTunnel(localPort) {
  if (_stopped) return;
  console.log("[tunnel] Connecting to localhost.run (port " + localPort + ")...");

  _tunnelProcess = spawn(
    "ssh",
    [
      "-o", "StrictHostKeyChecking=no",
      "-o", "ServerAliveInterval=30",
      "-o", "ServerAliveCountMax=3",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "LogLevel=ERROR",
      "-R", "80:localhost:" + localPort,
      "nokey@localhost.run",
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );

  _tunnelProcess.stdout.on("data", function (data) {
    var lines = data.toString().split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      // localhost.run outputs lines like: https://XXXX.lhr.life
      var match = line.match(/(https?:\/\/[^\s]+\.lhr\.life)/);
      if (match) {
        var newUrl = match[1];
        if (newUrl !== _tunnelUrl) {
          _tunnelUrl = newUrl;
          console.log("[tunnel] Public URL: " + _tunnelUrl);
          for (var j = 0; j < _onUrlCallbacks.length; j++) {
            try {
              _onUrlCallbacks[j](_tunnelUrl);
            } catch (e) {}
          }
        }
      }
    }
  });

  _tunnelProcess.stderr.on("data", function (data) {
    var line = data.toString().trim();
    if (line && !line.includes("Warning:") && !line.includes("Permanently added")) {
      console.log("[tunnel]", line);
    }
  });

  _tunnelProcess.on("close", function (code) {
    _tunnelProcess = null;
    if (_stopped) return;
    var oldUrl = _tunnelUrl;
    _tunnelUrl = null;
    if (oldUrl) {
      console.log("[tunnel] Disconnected (was: " + oldUrl + ")");
    }
    // Exponential backoff: 5s, 10s, 20s, max 60s
    var delay = _reconnecting ? Math.min(60000, 10000) : 5000;
    _reconnecting = true;
    console.log("[tunnel] Reconnecting in " + (delay / 1000) + "s...");
    setTimeout(function () {
      _reconnecting = false;
      _createTunnel(localPort);
    }, delay);
  });

  _tunnelProcess.on("error", function (err) {
    console.log("[tunnel] Process error:", err.message);
  });
}

// ═══════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════

async function start(localPort) {
  _stopped = false;
  var hasSSH = await checkSSH();
  if (!hasSSH) {
    console.log("[tunnel] SSH not available — skipping tunnel");
    console.log("[tunnel] Install OpenSSH or use FRP/Cloudflare for public access");
    return false;
  }
  _createTunnel(localPort);
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
  // If URL already available, call immediately
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
};
