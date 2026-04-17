const http = require("http");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");
const os = require("os");
const bridge = require("./dao_bridge");
const { DaoKernel, DaoIdentity, DaoRateLimit } = require("../dao_kernel");
const { SunloginBridge } = require("../dao_sunlogin");
const { ScreenRegistry } = require("./dao_screen_registry");
const daoPair = require("./dao_pair");

// 万法之资: 向日葵深度集成 — config解析 + 云API + 全功能调用
var _sunloginBridge = new SunloginBridge();
try {
  var slInit = _sunloginBridge.init();
  if (slInit.ok) {
    console.log(
      "[sunlogin] 向日葵 v" +
        slInit.version +
        " | " +
        slInit.hostname +
        " | " +
        slInit.plugins +
        " plugins | " +
        (slInit.running ? "运行中" : "未运行"),
    );
  }
} catch (e) {
  console.log("[sunlogin] init: " + e.message);
}

// 道核身份: Ed25519 非对称身份 (与dao.js共享同一密钥文件)
var _daoIdentity = new DaoIdentity();
// 速率限制: 20次/分钟/IP — 防暴力破解
var _authLimiter = new DaoRateLimit(20, 60000);
// 一码配对会话池 · 32-hex pairId → { token, expiresAt, used }
// QR 仅带 pairId (32 字节 hex), 客户端 POST /pair/claim 换取真 token
// 一次性 (used=true 后即删), 到期自动清理 — 柔弱胜刚强: 瞬遇即逝, 不留痕
var _pairSessions = new Map();
var _pairCleanTimer = setInterval(function () {
  var now = Date.now();
  _pairSessions.forEach(function (v, k) {
    if (v.used || v.expiresAt < now) _pairSessions.delete(k);
  });
}, 30000);
if (_pairCleanTimer && typeof _pairCleanTimer.unref === "function") {
  _pairCleanTimer.unref();
}

// ═══════════════════════════════════════════════════════════════
// 道核注入 — 万物皆动, 一切从运行时涌现
// dao.js 先 awaken() 再 require 此文件, 环境变量仅作过渡桥梁
// ═══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3002;
// 实际 listen 端口 (EADDRINUSE 重试后会偏移, 配对/发现端点须用此值而非 PORT 常量)
var _listenPort = parseInt(PORT, 10);
// 唯变所适 · 请求自知: 默认不对外预设任何 URL
// · env 明指 → 以 env 为准 (隧道/反代场景)
// · 无 env → 选一个 LAN IP 作后备表志 (用于日志显示与 tunnel 前的 best-effort)
// · 仍无 → 空字符串; 实际回应的每条 URL 由 getReqHost(req) 从请求头自述
// 道可道 非常少: 不再字面量外露 "localhost"
var _publicUrl =
  process.env.PUBLIC_URL ||
  (function () {
    try {
      var nets = os.networkInterfaces();
      for (var name of Object.keys(nets)) {
        for (var iface of nets[name]) {
          if (iface.family === "IPv4" && !iface.internal) {
            return iface.address + ":" + PORT;
          }
        }
      }
    } catch (e) {}
    return ""; // 令 URL 由每条请求的 Host 头自描述
  })();
var RELAY_PORT = parseInt(process.env.RELAY_PORT || "9910", 10);

// 投屏链路: 万法之资 — 运行时探测, 环境覆盖仅为兼容
var SCREEN_PORTS = {
  scrcpy: parseInt(process.env.SCRCPY_HUB_PORT || "8890", 10),
  mjpeg: parseInt(process.env.MJPEG_PORT || "8081", 10),
  input: parseInt(process.env.INPUT_PORT || "8084", 10),
  ghost: parseInt(process.env.GHOST_SHELL_PORT || "8000", 10),
  dao: parseInt(process.env.DAO_REMOTE_PORT || "9900", 10),
  adb_hub: parseInt(process.env.ADB_HUB_PORT || "9861", 10),
  sunlogin: parseInt(process.env.SUNLOGIN_PORT || "13333", 10),
};
// 道生令牌 · ADB_HUB_TOKEN 三级涌现 (道可道 非常少 — 无字面量后备):
//   ① env 明指
//   ② 缓存文件 ~/.dao-remote/adb_hub.token (同机协作共读)
//   ③ Ed25519 serviceToken 确定性派生 (每身份唯一, 重启等价)
// 三条或均失败 → throw, 不隐瞒问题
var ADB_HUB_TOKEN = (function () {
  if (process.env.ADB_HUB_TOKEN) return process.env.ADB_HUB_TOKEN;
  var fs = require("fs");
  var path = require("path");
  var osMod = require("os");
  var dir = path.join(osMod.homedir(), ".dao-remote");
  var tokenFile = path.join(dir, "adb_hub.token");
  try {
    if (fs.existsSync(tokenFile)) {
      var cached = fs.readFileSync(tokenFile, "utf-8").trim();
      if (cached) return cached;
    }
  } catch (e) {}
  // Ed25519 deterministic signing — 必成功而且跨重启一致
  var token = _daoIdentity.serviceToken("adb_hub", 32);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  } catch (e) {}
  return token;
})();
// 一表定万法: 投屏/输入来源集中于注册表 — 增删改只需动一行
var _screenReg = new ScreenRegistry();
// _screenSources 是注册表状态的别名视图 — 所有 .get/.has/.forEach 消费者零改动
var _screenSources = _screenReg.state;
var _screenClients = new Set();
// WebRTC signaling relay — offerer (browser) ↔ answerer (screen source)
var _rtcOfferers = new Set();
var _rtcAnswerers = new Set();
// REST fallback postbox for SDP/ICE exchange (environments where WS is blocked)
var _rtcPostBox = { offer: [], answer: [] };
// 万法之资: 远程工具注册表 — 道核发现的一切可用投屏/远程工具
var _remoteTools = JSON.parse(process.env.DAO_REMOTE_TOOLS || "[]");

// 道核状态 (由 dao.js 注入)
var _daoFingerprint = process.env.DAO_FINGERPRINT || "";
var _daoAdbPath = process.env.DAO_ADB_PATH || "";
var _daoBestInput = process.env.DAO_BEST_INPUT || "";
var _daoBestCodec = process.env.DAO_BEST_CODEC || "";

// 道法自然: 有端口=HTTP直连, 无端口=HTTPS(隧道/域名)
function isSecure() {
  return !/:\d+$/.test(_publicUrl);
}
function httpProto() {
  return isSecure() ? "https" : "http";
}
function wsProto() {
  return isSecure() ? "wss" : "ws";
}

// ==================== 请求自知 · 唯变所适 ====================
function isSecureReq(req) {
  return DaoKernel.reqProto(req) === "https";
}
function getReqHost(req) {
  return DaoKernel.reqHost(req) || _publicUrl;
}
function getReqHttpProto(req) {
  return DaoKernel.reqProto(req);
}
function getReqWsProto(req) {
  return DaoKernel.reqWsProto(req);
}
function getAllLanIPs() {
  var ips = [];
  var nets = os.networkInterfaces();
  for (var name of Object.keys(nets)) {
    for (var iface of nets[name]) {
      if (iface.family === "IPv4" && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

// ==================== STATE ====================
const MASTER_TOKEN = process.env.PS_AGENT_MASTER_TOKEN || "";
let senseSocket = null;
let senseData = {
  connected: false,
  ua: null,
  diagnostics: null,
  lastUpdate: null,
};
// 万法归宗: 多Agent安全通道 — 每台远程电脑一条独立连接
const agentSockets = new Map(); // hostname → WebSocket
const agentDataMap = new Map(); // hostname → {hostname,user,os,isAdmin,sysinfo,lastUpdate,lastPong,pingTimer}
let commandHistory = [];
const MAX_HISTORY = 500;
const pendingCommands = new Map();
let messageQueue = [];
let hostsGuardTimer = null;

// ==================== 安全通道: Ed25519 道核鉴权 ====================
// 签名令牌: 公钥验证 + 速率限制 + localhost豁免
function checkToken(req) {
  if (!MASTER_TOKEN) return true;
  var ip = (req.socket || req.connection || {}).remoteAddress || "";
  // localhost豁免
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1")
    return true;
  // 速率限制: 远程访问防暴力破解
  var clientIP = ip.replace(/^::ffff:/, "");
  if (!_authLimiter.check(clientIP)) {
    console.log("[auth] rate limited: " + clientIP);
    return false;
  }
  // 提取令牌: URL query 或 Authorization header
  var token = "";
  try {
    var u = new URL(req.url || "", "http://localhost");
    token = u.searchParams.get("token") || "";
  } catch (e) {}
  if (!token) {
    var auth = (req.headers || {}).authorization || "";
    if (auth.startsWith("Bearer ")) token = auth.slice(7);
  }
  if (!token) return false;
  // Ed25519 签名令牌 (v2) 或 HMAC 令牌 (v1 迁移期)
  if (_daoIdentity.verifyToken(token)) return true;
  // 旧式共享令牌 (向后兼容)
  if (token === MASTER_TOKEN) return true;
  return false;
}
function denyToken(res) {
  res.writeHead(401, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(
    JSON.stringify({
      error: "unauthorized",
      hint: "Add ?token=XXX or Authorization: Bearer XXX",
    }),
  );
}

// ==================== 多Agent辅助 ====================
function getDefaultAgent() {
  for (var [h, ws] of agentSockets) {
    if (ws.readyState === 1) return { hostname: h, ws: ws };
  }
  return null;
}
function getAgentList() {
  var list = [];
  agentDataMap.forEach(function (d, h) {
    list.push({
      connected: agentSockets.has(h) && agentSockets.get(h).readyState === 1,
      hostname: d.hostname,
      user: d.user,
      os: d.os,
      isAdmin: d.isAdmin,
      lastUpdate: d.lastUpdate,
      lastPong: d.lastPong,
      hasSysinfo: !!d.sysinfo,
    });
  });
  return list;
}
function getDefaultAgentData() {
  var def = getDefaultAgent();
  if (!def)
    return {
      connected: false,
      hostname: null,
      user: null,
      os: null,
      isAdmin: false,
      sysinfo: null,
      lastUpdate: null,
    };
  var d = agentDataMap.get(def.hostname) || {};
  return {
    connected: true,
    hostname: d.hostname,
    user: d.user,
    os: d.os,
    isAdmin: d.isAdmin,
    sysinfo: d.sysinfo || null,
    lastUpdate: d.lastUpdate,
    lastPong: d.lastPong,
  };
}

// ==================== 无感层: HOSTS GUARD ====================
function startHostsGuard() {
  if (hostsGuardTimer) return;
  const guardCmd =
    '$h=Get-Content "$env:SystemRoot\\System32\\drivers\\etc\\hosts" -EA SilentlyContinue | Where-Object {$_ -match "windsurf|codeium|exafunction"}; if($h){"DIRTY:$h"}else{"CLEAN"}';
  const cleanCmd =
    '$hp="$env:SystemRoot\\System32\\drivers\\etc\\hosts"; $h=Get-Content $hp -Encoding UTF8; $h=$h | Where-Object { $_ -notmatch "windsurf|codeium|exafunction" }; $h | Set-Content $hp -Encoding ASCII; ipconfig /flushdns | Out-Null; "FIXED"';
  hostsGuardTimer = setInterval(function () {
    if (agentSockets.size === 0) return;
    agentSockets.forEach(function (ws, hostname) {
      if (ws.readyState !== 1) return;
      execOnAgent(guardCmd, 10000, hostname)
        .then(function (r) {
          const out = (r.output || "").trim();
          if (out.startsWith("DIRTY:")) {
            console.log(
              "[guard] hosts dirty on " + hostname + ", auto-cleaning...",
            );
            execOnAgent(cleanCmd, 10000, hostname)
              .then(function (r2) {
                console.log("[guard] hosts cleaned on " + hostname);
                notifySense("say", {
                  level: "system",
                  text:
                    "<b>无感守护:</b> 检测到" +
                    hostname +
                    "写入hosts文件，已自动清理并刷新DNS。",
                });
              })
              .catch(function () {});
          }
        })
        .catch(function () {});
    });
  }, 60000);
  console.log("[guard] hosts guard started (60s interval)");
}
function stopHostsGuard() {
  if (hostsGuardTimer) {
    clearInterval(hostsGuardTimer);
    hostsGuardTimer = null;
    console.log("[guard] hosts guard stopped");
  }
}

// ==================== 投屏链路: 自动发现 · 适配一切 ====================
// 道法自然: 注册表驱动 — probe/best/capture/input 皆为一表之用
function discoverScreenSources() {
  return _screenReg.probeAll();
}

// 反者道之动 — 优先级自适应，源自注册表单一事实
function getBestScreenSource() {
  return _screenReg.best();
}

// 代理请求到投屏服务 — 万法归宗: 一个端口接入一切
function proxyToScreen(req, res, targetUrl) {
  var parsed = new URL(targetUrl);
  var opts = {
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    method: req.method,
    headers: Object.assign({}, req.headers, { host: parsed.host }),
    timeout: 30000,
  };
  var proxy = http.request(opts, function (proxyRes) {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxy.on("error", function () {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "screen source unreachable", url: targetUrl }),
    );
  });
  req.pipe(proxy, { end: true });
}

// Agent端截屏: 通过WS Agent执行ADB/screencap → base64 → 推送浏览器
// 柔弱胜刚强: 无需任何投屏服务, 只要Agent在线就能看屏幕
function captureScreenViaAgent(hostname) {
  // Windows: 直接截取Windows桌面
  var cmd =
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $bmp=New-Object Drawing.Bitmap([Windows.Forms.Screen]::PrimaryScreen.Bounds.Width,[Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $g=[Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0,0,0,0,$bmp.Size); $ms=New-Object IO.MemoryStream; $bmp.Save($ms,[Drawing.Imaging.ImageFormat]::Jpeg); [Convert]::ToBase64String($ms.ToArray())";
  return execOnAgent(cmd, 15000, hostname);
}

// Android截屏: 通过scrcpy Hub
function captureScreenViaScrcpy(serial) {
  return new Promise(function (resolve, reject) {
    var src = _screenSources.get("scrcpy");
    if (!src || src.status !== "online") {
      reject(new Error("scrcpy offline"));
      return;
    }
    var req = http.get(
      src.url + "/api/screenshot?s=" + (serial || ""),
      { timeout: 10000 },
      function (res) {
        var d = "";
        res.on("data", function (c) {
          d += c;
        });
        res.on("end", function () {
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
  });
}

// HTTP截图helper: 获取原始图片 → base64 data URI — 道法自然: 一法通万法
function _captureFromHttp(url, sourceName) {
  return new Promise(function (resolve, reject) {
    http
      .get(url, { timeout: 10000 }, function (res) {
        var chunks = [];
        res.on("data", function (c) {
          chunks.push(c);
        });
        res.on("end", function () {
          var buf = Buffer.concat(chunks);
          var ct = (res.headers["content-type"] || "").toLowerCase();
          if (ct.includes("json")) {
            try {
              var j = JSON.parse(buf.toString());
              resolve({
                ok: true,
                image: j.image || j.screenshot || "",
                source: sourceName,
                width: j.width,
                height: j.height,
              });
            } catch (e) {
              reject(e);
            }
          } else {
            var mime = ct.includes("png") ? "image/png" : "image/jpeg";
            resolve({
              ok: true,
              image: "data:" + mime + ";base64," + buf.toString("base64"),
              source: sourceName,
            });
          }
        });
      })
      .on("error", reject);
  });
}

// 万法归宗: 统一截屏 — 注册表按优先级遍历, 全部失败则回落到 Agent 截屏
// 优先级/分支仅定义在注册表, 此处是纯委派
function captureScreenBest(hostname, serial) {
  return _screenReg
    .captureBest({ hostname: hostname, serial: serial })
    .then(function (r) {
      if (r) return r;
      // 兜底: Agent 端 PowerShell 截屏 — 无投屏服务也能看屏
      return captureScreenViaAgent(hostname).then(function (ag) {
        return {
          ok: ag.ok,
          image: "data:image/jpeg;base64," + (ag.output || "").trim(),
          source: "agent",
          ms: ag.ms,
        };
      });
    });
}

// 万法之资: 发送输入到设备 — 自适应一切输入源
// 注册表按 priority 遍历, 定义于 _screenReg.register() 一处
function sendInputToDevice(action, params, serial) {
  return _screenReg.inputBest(action, params || {}, serial || "");
}

// 通用HTTP POST helper — 道法自然: 一法通万法
function _postToSource(url, data) {
  return new Promise(function (resolve, reject) {
    var body = JSON.stringify(data);
    var req = http.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 5000,
      },
      function (res) {
        var d = "";
        res.on("data", function (c) {
          d += c;
        });
        res.on("end", function () {
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            resolve({ ok: true, raw: d });
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ghost_shell / dao-remote 命令转换 — 统一action到/interact格式
function _ghostCmd(action, params) {
  var actionMap = {
    tap: "click",
    longpress: "click",
    key: "key",
    text: "type",
    home: "key",
    back: "key",
    recents: "key",
  };
  var cmd = { action: actionMap[action] || action };
  if (action === "tap" || action === "longpress") {
    cmd.action = "click";
    cmd.x = params.x || 0;
    cmd.y = params.y || 0;
  } else if (action === "swipe") {
    cmd.action = "mousedown";
    cmd.x = params.x1 || 0;
    cmd.y = params.y1 || 0;
    // ghost_shell handles swipe as mousedown+mousemove+mouseup; send click at dest
    cmd = { action: "click", x: params.x2 || 0, y: params.y2 || 0 };
  } else if (action === "text") {
    cmd.action = "type";
    cmd.text = params.text || "";
  } else if (action === "key") {
    cmd.action = "key";
    cmd.key = params.key || "";
  } else if (action === "home") {
    cmd = { action: "key", key: "lwin" };
  } else if (action === "back") {
    cmd = { action: "key", key: "alt+left" };
  } else if (action === "volume/up") {
    cmd = { action: "key", key: "volume_up" };
  } else if (action === "volume/down") {
    cmd = { action: "key", key: "volume_down" };
  } else if (action === "screenshot") {
    cmd = { action: "hotkey", key: "lwin+shift+s" };
  } else if (action === "lock") {
    cmd = { action: "hotkey", key: "lwin+l" };
  } else if (action === "launch") {
    cmd = { action: "open_app", text: params.app || params.text || "" };
  } else if (action === "scroll") {
    cmd = {
      action: "scroll",
      x: params.x || 0,
      y: params.y || 0,
      delta: params.delta || -120,
    };
  }
  return cmd;
}

// adb_hub 命令转换 — action → /api/adb/* 或 /api/control
function _adbHubInput(baseUrl, action, params, serial) {
  var device = serial || params.device || "";
  var tokenQ = "token=" + ADB_HUB_TOKEN;
  // 简单控制命令直接映射到 /api/control
  var ctrlActions = [
    "home",
    "back",
    "recents",
    "wake",
    "lock",
    "power",
    "notifications",
    "quicksettings",
    "volume/up",
    "volume/down",
    "screenshot",
  ];
  if (ctrlActions.indexOf(action) >= 0) {
    var aAction = action.replace("/", "_");
    return _getFromSource(
      baseUrl +
        "/api/control?action=" +
        aAction +
        "&device=" +
        device +
        "&" +
        tokenQ,
    );
  }
  if (action === "tap" && params.x != null) {
    return _getFromSource(
      baseUrl +
        "/api/tap?x=" +
        params.x +
        "&y=" +
        params.y +
        "&device=" +
        device +
        "&" +
        tokenQ,
    );
  }
  if (action === "swipe" && params.x1 != null) {
    return _getFromSource(
      baseUrl +
        "/api/swipe?x1=" +
        params.x1 +
        "&y1=" +
        params.y1 +
        "&x2=" +
        params.x2 +
        "&y2=" +
        params.y2 +
        "&duration=" +
        (params.duration || 300) +
        "&device=" +
        device +
        "&" +
        tokenQ,
    );
  }
  if (action === "text") {
    return _getFromSource(
      baseUrl +
        "/api/text?t=" +
        encodeURIComponent(params.text || "") +
        "&device=" +
        device +
        "&" +
        tokenQ,
    );
  }
  if (action === "key") {
    return _getFromSource(
      baseUrl +
        "/api/adb/shell?device=" +
        device +
        "&cmd=input+keyevent+" +
        encodeURIComponent(params.key || "") +
        "&" +
        tokenQ,
    );
  }
  // 通用: /api/control
  return _getFromSource(
    baseUrl +
      "/api/control?action=" +
      action +
      "&device=" +
      device +
      "&" +
      tokenQ,
  );
}

// 通用HTTP GET helper
function _getFromSource(url) {
  return new Promise(function (resolve, reject) {
    http
      .get(url, { timeout: 5000 }, function (res) {
        var d = "";
        res.on("data", function (c) {
          d += c;
        });
        res.on("end", function () {
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            resolve({ ok: true, raw: d });
          }
        });
      })
      .on("error", reject);
  });
}

// ═══════════════════════════════════════════════════════════════════
// 一表定万法 · Screen Source Registry
// 每个来源 = 一行。 增/删/改/调优先级都只动一处。
// 分类正确: capture/input 为 null = 不参与屏幕/输入路由, 只为 /status 可见
// ═══════════════════════════════════════════════════════════════════

// ── ghost_shell (Windows 30fps GDI+SendInput) ─────────────────────
_screenReg.register({
  id: "ghost",
  name: "Ghost Shell",
  priority: 10,
  port: SCREEN_PORTS.ghost,
  healthPath: "/status",
  capture: function (ctx, url) {
    return _captureFromHttp(url + "/capture", "ghost");
  },
  input: function (action, params, serial, url) {
    return _postToSource(url + "/interact", _ghostCmd(action, params));
  },
});

// ── scrcpy Hub (Android) ─────────────────────────────────────────
// 外部服务: 端口可能因冲突而上移 — 探 3 候选, 柔弱胜刚强
_screenReg.register({
  id: "scrcpy",
  name: "scrcpy Hub",
  priority: 20,
  portCandidates: [
    SCREEN_PORTS.scrcpy,
    SCREEN_PORTS.scrcpy + 1,
    SCREEN_PORTS.scrcpy + 2,
  ],
  healthPath: "/api/health",
  capture: function (ctx, url) {
    return captureScreenViaScrcpy(ctx.serial).then(function (r) {
      var img = r.image || r.screenshot || "";
      if (img && !img.startsWith("data:")) {
        img = "data:image/png;base64," + img;
      }
      return {
        ok: true,
        image: img,
        source: "scrcpy",
        width: r.width,
        height: r.height,
      };
    });
  },
  input: function (action, params, serial, url) {
    return _postToSource(
      url + "/api/" + action,
      Object.assign({ serial: serial || "" }, params),
    );
  },
});

// ── dao-remote (Go 版亲情远程) ───────────────────────────────────
_screenReg.register({
  id: "dao",
  name: "dao-remote",
  priority: 30,
  port: SCREEN_PORTS.dao,
  healthPath: "/status",
  capture: function (ctx, url) {
    return _captureFromHttp(url + "/capture", "dao");
  },
  input: function (action, params, serial, url) {
    return _postToSource(url + "/interact", _ghostCmd(action, params));
  },
});

// ── InputRoutes (8084) · 输入专用 (Android 120+ API) ─────────────
// 仅输入, 无截屏能力 — capture 留空
_screenReg.register({
  id: "input",
  name: "InputRoutes",
  priority: 40,
  port: SCREEN_PORTS.input,
  healthPath: "/status",
  capture: null,
  input: function (action, params, serial, url) {
    return _postToSource(url + "/" + action, params);
  },
});

// ── MJPEG (8081) · 截屏流 + 同端口输入 ─────────────────────────
// 外部服务: 给 3 候选端口, 适应多实例或端口冲突场景
_screenReg.register({
  id: "mjpeg",
  name: "MJPEG",
  priority: 50,
  portCandidates: [
    SCREEN_PORTS.mjpeg,
    SCREEN_PORTS.mjpeg + 1,
    SCREEN_PORTS.mjpeg + 2,
  ],
  healthPath: "/stream/status",
  capture: function (ctx, url) {
    return _captureFromHttp(url + "/capture", "mjpeg");
  },
  input: function (action, params, serial, url) {
    return _postToSource(url + "/" + action, params);
  },
});

// ── adb_hub · 全控中枢 ───────────────────────────────────────────
// 外部服务: 给 3 候选端口
_screenReg.register({
  id: "adb_hub",
  name: "adb_hub",
  priority: 60,
  portCandidates: [
    SCREEN_PORTS.adb_hub,
    SCREEN_PORTS.adb_hub + 1,
    SCREEN_PORTS.adb_hub + 2,
  ],
  healthPath: "/api/adb/devices",
  capture: function (ctx, url) {
    return _captureFromHttp(
      url +
        "/api/adb/screencap?device=" +
        (ctx.serial || "") +
        "&token=" +
        ADB_HUB_TOKEN,
      "adb_hub",
    );
  },
  input: function (action, params, serial, url) {
    return _adbHubInput(url, action, params, serial);
  },
});

// ── 向日葵 · 分类正确: 启动器, 非流源 ──────────────────────────
// v15 无本地 HTTP API. 通过 /tools/launch 调用主控界面.
// probe 仅为 /status 可见; capture/input=null → 不参与屏幕/输入路由
_screenReg.register({
  id: "sunlogin",
  name: "向日葵",
  priority: 99,
  url: "bridge://sunlogin",
  probe: function () {
    if (!_sunloginBridge.ready) return false;
    try {
      var ps = _sunloginBridge.refreshProcess();
      return !!ps.running;
    } catch (e) {
      return false;
    }
  },
  capture: null,
  input: null,
});

// ==================== ADB兜底: 万法之资 — 无服务也能控 ====================
// 道法自然: 将高层action映射为原始ADB命令, 适配一切Android设备
function adbFallbackCmd(action, params) {
  var keyMap = {
    home: "adb shell input keyevent KEYCODE_HOME",
    back: "adb shell input keyevent KEYCODE_BACK",
    recents: "adb shell input keyevent KEYCODE_APP_SWITCH",
    lock: "adb shell input keyevent KEYCODE_POWER",
    wake: "adb shell input keyevent KEYCODE_WAKEUP",
    power: "adb shell input keyevent KEYCODE_POWER",
    screenshot: "adb shell input keyevent KEYCODE_SYSRQ",
    notifications: "adb shell cmd statusbar expand-notifications",
    quicksettings: "adb shell cmd statusbar expand-settings",
    "volume/up": "adb shell input keyevent KEYCODE_VOLUME_UP",
    "volume/down": "adb shell input keyevent KEYCODE_VOLUME_DOWN",
    "media/play": "adb shell input keyevent KEYCODE_MEDIA_PLAY_PAUSE",
    "media/next": "adb shell input keyevent KEYCODE_MEDIA_NEXT",
    "media/prev": "adb shell input keyevent KEYCODE_MEDIA_PREVIOUS",
    splitscreen:
      "adb shell input keyevent KEYCODE_APP_SWITCH && sleep 0.3 && adb shell input keyevent KEYCODE_APP_SWITCH",
    menu: "adb shell input keyevent KEYCODE_MENU",
    search: "adb shell input keyevent KEYCODE_SEARCH",
    camera: "adb shell input keyevent KEYCODE_CAMERA",
    "brightness/up": "adb shell input keyevent KEYCODE_BRIGHTNESS_UP",
    "brightness/down": "adb shell input keyevent KEYCODE_BRIGHTNESS_DOWN",
  };
  if (keyMap[action]) return keyMap[action];
  if (action === "tap" && params.x != null && params.y != null) {
    return (
      "adb shell input tap " + Math.round(params.x) + " " + Math.round(params.y)
    );
  }
  if (action === "swipe" && params.x1 != null) {
    var dur = params.duration || 300;
    return (
      "adb shell input swipe " +
      Math.round(params.x1) +
      " " +
      Math.round(params.y1) +
      " " +
      Math.round(params.x2) +
      " " +
      Math.round(params.y2) +
      " " +
      dur
    );
  }
  if (action === "text" && params.text) {
    // ADB text input (escape spaces as %s)
    var t = params.text.replace(/ /g, "%s").replace(/'/g, "\\'");
    return "adb shell input text '" + t + "'";
  }
  if (action === "key" && params.key) {
    return "adb shell input keyevent " + params.key;
  }
  if (action === "longpress" && params.x != null) {
    var lx = Math.round(params.x),
      ly = Math.round(params.y);
    var ld = params.duration || 800;
    return (
      "adb shell input swipe " + lx + " " + ly + " " + lx + " " + ly + " " + ld
    );
  }
  if (action === "scroll") {
    var dir = params.direction || "down";
    var dist = params.distance || 500;
    var sx = Math.round((params.nx || 0.5) * 1080);
    var sy = Math.round((params.ny || 0.5) * 1920);
    var ey = dir === "up" ? sy + dist : sy - dist;
    return (
      "adb shell input swipe " + sx + " " + sy + " " + sx + " " + ey + " 300"
    );
  }
  return null;
}

// ==================== EXEC ENGINE (万法归宗: WS优先 → Relay兜底) ====================
function execOnAgent(cmd, timeout, hostname) {
  timeout = timeout || 30000;
  var ws = null;
  var target = hostname;
  if (hostname && agentSockets.has(hostname)) {
    ws = agentSockets.get(hostname);
  } else {
    var def = getDefaultAgent();
    if (def) {
      ws = def.ws;
      target = def.hostname;
    }
  }
  // 优先: WebSocket直连
  if (ws && ws.readyState === 1) {
    return new Promise(function (resolve, reject) {
      const id = crypto.randomUUID();
      const timer = setTimeout(function () {
        pendingCommands.delete(id);
        reject(new Error("timeout"));
      }, timeout);
      pendingCommands.set(id, {
        resolve: resolve,
        reject: reject,
        timer: timer,
        cmd: cmd,
      });
      ws.send(JSON.stringify({ type: "exec", id: id, cmd: cmd }));
      console.log("[brain->" + target + "]", cmd.substring(0, 80));
    });
  }
  // 兜底: 通过PS Agent Relay (万法归宗桥接)
  target = target || hostname || "unknown";
  console.log("[brain->relay]", target, cmd.substring(0, 80));
  return bridge
    .execOnRelay(target, cmd, Math.ceil(timeout / 1000))
    .then(function (r) {
      return { ok: !r.error, output: r.stdout || r.error || "", ms: 0 };
    });
}

function notifySense(type, data) {
  if (senseSocket && senseSocket.readyState === 1) {
    senseSocket.send(JSON.stringify(Object.assign({ type: type }, data)));
  }
}

function forwardTerminal(id, cmd, output, ok) {
  notifySense("terminal", { id: id, cmd: cmd, output: output, ok: ok });
}

// ==================== SENSE PAGE ====================
// 道法自然: 页面使用请求实际来源, 不用静态_publicUrl
function getSensePage(req) {
  var reqHost = getReqHost(req);
  return require("./page.js")(reqHost, MASTER_TOKEN);
}

// ==================== PWA CLAIM LANDING PAGE ====================
// 荃者所以在鱼 · 得鱼而忘荃 — 扫码即入, 二次免扫 (TOFU localStorage)
function getClaimLandingPage() {
  return (
    '<!DOCTYPE html><html lang="zh-cn"><head>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<meta name="theme-color" content="#0b0b0b">' +
    '<link rel="manifest" href="/manifest.webmanifest">' +
    '<link rel="icon" type="image/svg+xml" href="/icon.svg">' +
    "<title>道 · 认身份</title>" +
    "<style>" +
    "*{box-sizing:border-box;margin:0;padding:0}" +
    "body{background:#0b0b0b;color:#eee;font-family:-apple-system,Segoe UI,Roboto,sans-serif;" +
    "min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;" +
    "justify-content:center;padding:32px;gap:24px;text-align:center}" +
    ".ring{width:120px;height:120px;border:3px solid #222;border-top-color:#4af;border-radius:50%;" +
    "animation:spin 1s linear infinite}" +
    "@keyframes spin{to{transform:rotate(360deg)}}" +
    "h1{font-size:24px;font-weight:300;letter-spacing:.2em;color:#eee}" +
    ".status{color:#888;font-size:14px;line-height:1.6;max-width:320px}" +
    ".fp{font-family:ui-monospace,monospace;color:#4af;font-size:12px;letter-spacing:.1em}" +
    ".err{color:#f55;font-size:13px;margin-top:8px}" +
    ".btn{background:#4af;color:#000;border:none;padding:14px 28px;border-radius:8px;" +
    "font-size:14px;font-weight:500;letter-spacing:.1em;cursor:pointer;margin-top:12px}" +
    ".btn:hover{background:#6bf}" +
    ".muted{color:#555;font-size:11px;margin-top:16px}" +
    "</style>" +
    "</head><body>" +
    '<div class="ring" id="ring"></div>' +
    "<h1>道 · 认身份</h1>" +
    '<div class="status" id="status">正在与本机相认…</div>' +
    '<div class="fp" id="fp"></div>' +
    '<div id="action"></div>' +
    '<div class="muted">荃者所以在鱼 · 得鱼而忘荃</div>' +
    "<script>" +
    '(function(){"use strict";' +
    // 解析 location.hash — 支持 "pairId.fingerprint" 和 "dao://..." 两种格式
    "var hash=(location.hash||'').replace(/^#/,'');" +
    "var pairId='',fp='';" +
    "if(hash.indexOf('.')>0&&hash.indexOf('://')<0){" +
    "  var a=hash.split('.');pairId=a[0]||'';fp=a[1]||'';" +
    "}else if(hash.indexOf('dao://')===0){" +
    "  try{" +
    "    var u=new URL(hash.replace('dao://','https://x/'));" +
    "    var pp=u.pathname.replace(/^\\//,'').split('/');" +
    "    fp=u.host==='x'?(pp[0]||''):u.host;" +
    "    pairId=u.host==='x'?(pp[1]||''):(pp[0]||'');" +
    "  }catch(e){}" +
    "}" +
    "var S=document.getElementById('status');" +
    "var FP=document.getElementById('fp');" +
    "var R=document.getElementById('ring');" +
    "var A=document.getElementById('action');" +
    "function err(m){R.style.borderTopColor='#f55';S.textContent=m;S.className='err';}" +
    "function ok(m){S.textContent=m;}" +
    "if(fp)FP.textContent='指纹 '+fp;" +
    // 尝试从 localStorage 读 TOFU 缓存 (指纹匹配且未过期则直接跳 sense)
    //   无 hash 时 (用户直接访问 /c) 遍历 localStorage 找任意未过期记录 — 二次回家即入
    "function tryTofu(targetFp){" +
    "  try{" +
    "    if(targetFp){" +
    "      var c=JSON.parse(localStorage.getItem('dao-tofu-'+targetFp)||'null');" +
    "      if(c&&c.token&&c.expiresAt&&c.expiresAt*1000>Date.now()+30000)return c;" +
    "    }else{" +
    "      for(var i=0;i<localStorage.length;i++){" +
    "        var k=localStorage.key(i);" +
    "        if(!k||k.indexOf('dao-tofu-')!==0)continue;" +
    "        var v=JSON.parse(localStorage.getItem(k)||'null');" +
    "        if(v&&v.token&&v.expiresAt&&v.expiresAt*1000>Date.now()+30000)return v;" +
    "      }" +
    "    }" +
    "  }catch(e){}" +
    "  return null;" +
    "}" +
    "var cached=tryTofu(fp);" +
    "if(cached){" +
    "  ok('认得 · 直接入');" +
    "  setTimeout(function(){location.href='/sense?token='+encodeURIComponent(cached.token);},300);" +
    "  return;" +
    "}" +
    // 无缓存或过期 — 走 /pair/claim 兑换新 token (需要 pairId)
    "if(!pairId||!/^[0-9a-f]{32}$/.test(pairId)){" +
    "  err('未认得此设备 · 请在道核上生成新 QR 并扫码');" +
    "  A.innerHTML='<div style=\"color:#666;font-size:12px;margin-top:20px;line-height:1.8\">在电脑端打开 <b>/pair</b> 页面 · 用手机扫 QR · 自动完成相认</div>';" +
    "  return;" +
    "}" +
    "ok('正在兑换令牌…');" +
    "fetch('/pair/claim',{method:'POST',headers:{'Content-Type':'application/json'}," +
    "body:JSON.stringify({pairId:pairId})})" +
    ".then(function(r){return r.json().then(function(j){return{s:r.status,j:j};});})" +
    ".then(function(x){" +
    "  if(!x.j.ok){" +
    "    if(x.j.error==='not_found_or_used'||x.j.error==='already_claimed'){" +
    "      err('此 QR 已被使用 · 请重新生成');" +
    "    }else if(x.j.error==='expired'){" +
    "      err('此 QR 已过期 · 请重新生成');" +
    "    }else{" +
    "      err('兑换失败: '+(x.j.error||'unknown'));" +
    "    }" +
    '    A.innerHTML=\'<button class="btn" onclick="location.reload()">重试</button>\';' +
    "    return;" +
    "  }" +
    // 成功: TOFU 记忆 + 跳 sense
    "  try{" +
    "    localStorage.setItem('dao-tofu-'+x.j.fingerprint,JSON.stringify({" +
    "      token:x.j.token,expiresAt:x.j.expiresAt," +
    "      ips:x.j.ips||[],publicUrl:x.j.publicUrl||'',port:x.j.port," +
    "      firstSeen:Math.floor(Date.now()/1000)" +
    "    }));" +
    "  }catch(e){}" +
    "  R.style.borderTopColor='#4f4';" +
    "  ok('相认成功 · 正在进入…');" +
    "  setTimeout(function(){location.href='/sense?token='+encodeURIComponent(x.j.token);},400);" +
    "})" +
    ".catch(function(e){err('网络失败: '+e.message);" +
    '  A.innerHTML=\'<button class="btn" onclick="location.reload()">重试</button>\';});' +
    "})();" +
    "</script>" +
    "</body></html>"
  );
}

// ==================== ANALYSIS ENGINE (BROWSER DIAG) ====================
function analyzeDiagnostics(results) {
  const dns = results.filter(function (r) {
    return r.name.startsWith("DNS:") && !r.name.includes("ref");
  });
  const https = results.filter(function (r) {
    return r.name.startsWith("HTTPS:") && !r.name.includes("ref");
  });
  const ip = results.filter(function (r) {
    return r.name.startsWith("IP:");
  });
  const ref = results.filter(function (r) {
    return r.name.includes("ref");
  });
  const dnsOk = dns.filter(function (r) {
    return r.status === "pass";
  }).length;
  const dnsFail = dns.filter(function (r) {
    return r.status === "fail";
  }).length;
  const httpsOk = https.filter(function (r) {
    return r.status === "pass";
  }).length;
  const httpsFail = https.filter(function (r) {
    return r.status === "fail";
  }).length;
  const refOk = ref.filter(function (r) {
    return r.status === "pass";
  }).length;

  // Detect Clash/VPN environment:
  // Pattern 1: DNS returns 198.18.0.x fake-IPs (Clash fake-IP mode)
  // Pattern 2: DNS all fail but HTTPS all pass (Clash blocks DoH but proxies HTTPS)
  const clashByFakeIP = dns.some(function (r) {
    return r.detail && r.detail.match(/198\.18\./);
  });
  const clashByProxy = dnsFail > 0 && httpsFail === 0 && httpsOk >= 2;
  const clashDetected = clashByFakeIP || clashByProxy;

  const a = { level: "", summary: "", fixParts: [], clash: clashDetected };

  if (clashDetected) {
    // Clash/VPN env: traffic goes through proxy tunnel
    if (httpsOk > 0) {
      a.level = "alert-ok";
      const mode = clashByFakeIP ? "fake-IP模式" : "DoH拦截+HTTPS代理";
      a.summary =
        "<b>网络正常 (Clash/VPN代理中)</b> — " +
        mode +
        "，HTTPS通道畅通(" +
        httpsOk +
        "/" +
        https.length +
        ")。如Windsurf仍有问题，请检查Clash规则或hosts文件。";
      a.fixParts = ["hosts", "cache"];
    } else {
      a.level = "alert-warn";
      a.summary =
        "<b>Clash/VPN代理异常</b> — 检测到代理环境但HTTPS全部失败。请检查Clash是否正常运行。";
      a.fixParts = ["hosts", "cache"];
    }
  } else if (dnsFail === 0 && httpsFail === 0) {
    a.level = "alert-ok";
    a.summary =
      "<b>网络完全正常!</b> DNS全通、HTTPS全通。如Windsurf仍有问题，根因在本地缓存或配置。";
    a.fixParts = ["proxy", "cache"];
  } else if (dnsFail > 0 && refOk > 0) {
    a.level = "alert-err";
    a.summary =
      "<b>DNS解析异常</b> — GitHub可达但Windsurf域名(" +
      dnsFail +
      "个)失败，疑似DNS污染或hosts劫持。";
    a.fixParts = ["proxy", "dns", "hosts", "cache"];
  } else if (httpsFail > 0 && dnsOk > 0) {
    a.level = "alert-warn";
    a.summary =
      "<b>HTTPS连接异常</b> — DNS正常但HTTPS失败(" +
      httpsFail +
      "个)，可能被防火墙或代理拦截。";
    a.fixParts = ["proxy", "firewall", "cache"];
  } else if (dnsFail > 0 && httpsFail > 0) {
    a.level = "alert-err";
    a.summary = "<b>网络严重异常</b> — DNS+HTTPS大面积失败，服务不可达。";
    a.fixParts = ["proxy", "dns", "hosts", "firewall", "cache"];
  } else if (refOk === 0) {
    a.level = "alert-err";
    a.summary =
      "<b>网络整体不通</b> — 连GitHub都无法访问，请检查网线/WiFi/路由器。";
    a.fixParts = ["proxy", "dns"];
  } else {
    a.level = "alert-warn";
    a.summary =
      "<b>部分异常</b> (DNS:" +
      dnsOk +
      "/" +
      dns.length +
      " HTTPS:" +
      httpsOk +
      "/" +
      https.length +
      ")";
    a.fixParts = ["proxy", "dns", "hosts", "firewall", "cache"];
  }
  a.fixCmd = buildFixCommand(a.fixParts);
  return a;
}

function buildFixCommand(parts) {
  const c = ['Write-Host "===== Windsurf Fix =====" -ForegroundColor Cyan'];
  let s = 1;
  const t = parts.length;
  if (parts.includes("proxy")) {
    c.push(
      'Write-Host "[' + s + "/" + t + '] Proxy..." -ForegroundColor Yellow',
    );
    c.push("netsh winhttp reset proxy");
    c.push("[Environment]::SetEnvironmentVariable('HTTP_PROXY','','User')");
    c.push("[Environment]::SetEnvironmentVariable('HTTPS_PROXY','','User')");
    c.push("[Environment]::SetEnvironmentVariable('ALL_PROXY','','User')");
    c.push(
      "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -Name ProxyEnable -Value 0 -EA SilentlyContinue",
    );
    c.push("Write-Host '  OK' -ForegroundColor Green");
    s++;
  }
  if (parts.includes("dns")) {
    c.push('Write-Host "[' + s + "/" + t + '] DNS..." -ForegroundColor Yellow');
    c.push("ipconfig /flushdns");
    c.push("netsh winsock reset");
    c.push(
      "$a=Get-NetAdapter|?{$_.Status -eq 'Up'}; foreach($n in $a){Set-DnsClientServerAddress -InterfaceIndex $n.ifIndex -ServerAddresses ('223.5.5.5','8.8.8.8') -EA SilentlyContinue}",
    );
    c.push("Write-Host '  DNS->223.5.5.5/8.8.8.8' -ForegroundColor Green");
    s++;
  }
  if (parts.includes("hosts")) {
    c.push(
      'Write-Host "[' + s + "/" + t + '] Hosts..." -ForegroundColor Yellow',
    );
    c.push('$hp="$env:SystemRoot\\System32\\drivers\\etc\\hosts"');
    c.push(
      "$h=Get-Content $hp -EA SilentlyContinue; if($h){$h|?{$_ -notmatch 'codeium|windsurf|exafunction'}|Set-Content $hp -Encoding ASCII}",
    );
    c.push("Write-Host '  OK' -ForegroundColor Green");
    s++;
  }
  if (parts.includes("firewall")) {
    c.push(
      'Write-Host "[' + s + "/" + t + '] Firewall..." -ForegroundColor Yellow',
    );
    c.push(
      "Remove-NetFirewallRule -DisplayName 'Windsurf*' -EA SilentlyContinue",
    );
    c.push("Write-Host '  OK' -ForegroundColor Green");
    s++;
  }
  if (parts.includes("cache")) {
    c.push(
      'Write-Host "[' + s + "/" + t + '] Cache..." -ForegroundColor Yellow',
    );
    c.push("taskkill /IM Windsurf.exe /F 2>$null; Start-Sleep 2");
    c.push(
      'Remove-Item "$env:APPDATA\\Windsurf\\Cache" -Recurse -Force -EA SilentlyContinue',
    );
    c.push(
      'Remove-Item "$env:APPDATA\\Windsurf\\Network" -Recurse -Force -EA SilentlyContinue',
    );
    c.push("Write-Host '  OK' -ForegroundColor Green");
  }
  c.push('Write-Host "`n===== Done! Restart PC =====" -ForegroundColor Cyan');
  return c.join("; ");
}

// ==================== AUTO ANALYSIS ENGINE (AGENT DIAG) ====================
function analyzeAutoResults(results) {
  const get = function (name) {
    const r = results.find(function (x) {
      return x.name === name;
    });
    return r ? r.output : "";
  };
  const ok = function (name) {
    const r = results.find(function (x) {
      return x.name === name;
    });
    return r && r.ok;
  };

  const issues = [];
  const fixes = [];
  let level = "alert-ok";

  // Detect Clash/VPN: DNS returns 198.18.0.x (Clash fake-IP) or DNS config has 198.18.0.x
  const dnsWS = get("dns_windsurf");
  const dnsGH = get("dns_github");
  const dnsConfig = get("dns_config");
  const clashDetected =
    /198\.18\./.test(dnsWS) ||
    /198\.18\./.test(dnsGH) ||
    /198\.18\./.test(dnsConfig);

  // Check hosts — this is critical in BOTH normal and Clash environments
  const hosts = get("hosts_windsurf");
  if (hosts && hosts !== "(clean)") {
    issues.push("<b>hosts文件劫持:</b> " + hosts.substring(0, 80));
    if (clashDetected) {
      fixes.push(
        "<b>关键!</b> hosts条目绕过了Clash代理，导致Windsurf直连失败。删除hosts中的windsurf/codeium条目",
      );
    } else {
      fixes.push("清理hosts文件中的windsurf/codeium条目");
    }
    level = "alert-err";
  }

  if (clashDetected) {
    // Clash/VPN environment — different analysis logic
    const pingOk = get("ping_windsurf").indexOf("True") >= 0;
    if (pingOk && issues.length === 0) {
      // Clash working + no hosts issue = likely OK
      level = "alert-ok";
    } else if (!pingOk && issues.length === 0) {
      issues.push("Clash/VPN代理下windsurf.com:443不可达 — 检查Clash规则");
      fixes.push("确认Clash规则包含windsurf.com和codeium.com的代理规则");
      level = "alert-warn";
    }
    // Don't flag 198.18.0.x DNS as pollution — it's Clash fake-IP
    // Don't flag system proxy — Clash manages it
  } else {
    // Normal (non-VPN) environment — original analysis logic
    const proxy = get("proxy_check");
    const envProxy = get("env_proxy");
    if (proxy.indexOf("直接访问") < 0 && proxy.indexOf("Direct") < 0) {
      issues.push(
        "系统代理已配置: " + proxy.replace(/\n/g, " ").substring(0, 60),
      );
      fixes.push("清除系统代理: <code>netsh winhttp reset proxy</code>");
      if (level === "alert-ok") level = "alert-warn";
    }
    if (
      envProxy.indexOf("HTTP_PROXY=") >= 0 &&
      envProxy
        .replace(/HTTP_PROXY= \|/, "")
        .replace(/HTTPS_PROXY= \|/, "")
        .replace(/ALL_PROXY=/, "")
        .trim()
    ) {
      issues.push("环境变量代理: " + envProxy);
      fixes.push("清除代理环境变量");
      if (level === "alert-ok") level = "alert-warn";
    }

    // DNS check (only in non-Clash env)
    if (!ok("dns_windsurf") && ok("dns_github")) {
      issues.push("Windsurf DNS解析失败但GitHub正常 — DNS劫持或污染");
      fixes.push("切换DNS到 223.5.5.5 / 8.8.8.8");
      level = "alert-err";
    } else if (!ok("dns_windsurf") && !ok("dns_github")) {
      issues.push("DNS完全不可用");
      fixes.push("检查网络连接, 切换DNS");
      level = "alert-err";
    }

    // Connectivity check
    const ping = get("ping_windsurf");
    if (ping.indexOf("False") >= 0) {
      issues.push("windsurf.com:443 TCP连接失败");
      if (issues.length === 1)
        fixes.push("检查防火墙规则, 考虑添加Windsurf白名单");
      level = "alert-err";
    }

    // Firewall check
    const fw = get("firewall_windsurf");
    if (fw.indexOf("Block") >= 0) {
      issues.push("防火墙规则阻止了Windsurf");
      fixes.push(
        '删除阻止规则: <code>Remove-NetFirewallRule -DisplayName "Windsurf*"</code>',
      );
      level = "alert-err";
    }
  }

  // Check Windsurf process (both envs)
  const wsProc = get("windsurf_process");
  const wsPath = get("windsurf_path");
  if (wsProc.indexOf("not running") >= 0) {
    issues.push("Windsurf未运行");
  }
  if (wsPath.indexOf("not found") >= 0) {
    issues.push("未找到Windsurf安装路径");
    fixes.push("重新安装Windsurf");
    level = "alert-err";
  }

  // Check memory (both envs)
  const cpuMem = get("cpu_mem");
  const freeMatch = cpuMem.match(/free ([\d.]+)GB/);
  if (freeMatch && parseFloat(freeMatch[1]) < 1.0) {
    issues.push("内存不足: 仅剩 " + freeMatch[1] + "GB 空闲");
    fixes.push("关闭不必要的程序释放内存");
    if (level === "alert-ok") level = "alert-warn";
  }

  // Summary
  const env = clashDetected
    ? ' <span style="color:#ffa726">[Clash/VPN环境]</span>'
    : "";
  let summary;
  if (issues.length === 0) {
    summary =
      "<b>诊断完成: 一切正常</b>" +
      env +
      " — 网络通畅, hosts干净。如Windsurf仍有问题,建议清除缓存后重启。";
    fixes.push(
      "清除Windsurf缓存: 删除 %APPDATA%\\Windsurf\\Cache 和 Network 目录, 重启电脑",
    );
  } else {
    summary =
      "<b>发现 " +
      issues.length +
      " 个问题:</b>" +
      env +
      "<br>" +
      issues
        .map(function (x) {
          return "• " + x;
        })
        .join("<br>");
  }

  return {
    level: level,
    summary: summary,
    issues: issues,
    fixes: fixes,
    clash: clashDetected,
  };
}

// ==================== HTTP SERVER ====================
function readBody(req, cb) {
  let b = "";
  req.on("data", function (c) {
    b += c;
  });
  req.on("end", function () {
    cb(b);
  });
}
function jsonReply(res, data, code) {
  res.writeHead(code || 200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

// ==================== UNIFIED AGENT SCRIPT (/go) ====================
// 道法自然: 请求自知 — URL从请求本身推导, 不预测, 不硬编码
function getUnifiedAgentScript(req) {
  var reqHost = getReqHost(req);
  var reqSecure = isSecureReq(req);
  var proto = reqSecure ? "wss" : "ws";
  var tok = MASTER_TOKEN;
  var portMatch = reqHost.match(/:(\d+)$/);
  var port = portMatch ? portMatch[1] : reqSecure ? "443" : "80";
  // 构建多路径: 请求来源(已证明可达) → localhost → 127.0.0.1 → 所有LAN IP
  // 道法自然: 去重, 每条路径唯一, 第一条最优
  var suffix = "/ws/agent?token=" + tok;
  var seen = {};
  var urls = [];
  function addUrl(u) {
    if (!seen[u]) {
      seen[u] = true;
      urls.push(u);
    }
  }
  addUrl(proto + "://" + reqHost + suffix);
  if (!reqSecure) {
    addUrl("ws://localhost:" + port + suffix);
    addUrl("ws://127.0.0.1:" + port + suffix);
    // 所有LAN IP作为兜底 — 适配多网卡/VPN/Docker一切拓扑
    var lanIPs = getAllLanIPs();
    for (var i = 0; i < lanIPs.length; i++) {
      addUrl("ws://" + lanIPs[i] + ":" + port + suffix);
    }
  }
  var L = [];
  L.push(
    "# ═══════════ 道 · Unified Agent v7.0 — 万法之资 · 唯变所适 ═══════════",
  );
  L.push('$ErrorActionPreference = "Continue"');
  L.push("$urls = @(");
  for (var u = 0; u < urls.length; u++) {
    L.push('  "' + urls[u] + '"');
  }
  L.push(")");
  L.push(
    'Write-Host "`n  ═══════════════════════════════════════" -ForegroundColor Cyan',
  );
  L.push(
    'Write-Host "  道 · Unified Agent v7.0 — 万法之资 · 唯变所适" -ForegroundColor Cyan',
  );
  L.push('Write-Host "  Source: ' + reqHost + '" -ForegroundColor Cyan');
  L.push('Write-Host "  Paths:  $($urls.Count)" -ForegroundColor Cyan');
  L.push(
    'Write-Host "  ═══════════════════════════════════════`n" -ForegroundColor Cyan',
  );
  L.push(
    "function Get-Info { @{ hostname=$env:COMPUTERNAME; user=$env:USERNAME; os=(Get-CimInstance Win32_OperatingSystem -EA SilentlyContinue).Caption; isAdmin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); psVer=$PSVersionTable.PSVersion.ToString(); arch=$env:PROCESSOR_ARCHITECTURE } }",
  );
  L.push("function Send-Msg($ws, $obj) {");
  L.push("  $j = $obj | ConvertTo-Json -Depth 5 -Compress");
  L.push("  $b = [Text.Encoding]::UTF8.GetBytes($j)");
  L.push(
    "  $ws.SendAsync([ArraySegment[byte]]::new($b), [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null",
  );
  L.push("}");
  // 智能连接函数: 遍历所有路径, 第一个通的就用
  L.push("function Try-Connect {");
  L.push("  foreach ($u in $urls) {");
  L.push("    try {");
  L.push("      $w = [Net.WebSockets.ClientWebSocket]::new()");
  L.push("      $w.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(15)");
  L.push("      $cts = [Threading.CancellationTokenSource]::new(5000)");
  L.push('      Write-Host "[...] Trying $u" -ForegroundColor Yellow');
  L.push(
    "      $w.ConnectAsync([Uri]$u, $cts.Token).GetAwaiter().GetResult() | Out-Null",
  );
  L.push('      Write-Host "[OK] Connected via $u" -ForegroundColor Green');
  L.push("      return $w");
  L.push("    } catch {");
  L.push(
    '      Write-Host "[x] $u -> $($_.Exception.InnerException.Message ?? $_)" -ForegroundColor DarkGray',
  );
  L.push("      try { $w.Dispose() | Out-Null } catch {}");
  L.push("    }");
  L.push("  }");
  L.push("  return $null");
  L.push("}");
  L.push("$attempt = 0");
  L.push("while ($true) {");
  L.push("  $attempt++");
  L.push("  $ws = Try-Connect");
  L.push("  if (-not $ws) {");
  L.push("    $wait = [Math]::Min($attempt * 3, 30)");
  L.push(
    '    Write-Host "[...] All paths failed, retry in ${wait}s (#$attempt)..." -ForegroundColor Yellow',
  );
  L.push("    Start-Sleep $wait; continue");
  L.push("  }");
  L.push("  $attempt = 0");
  L.push("  try {");
  L.push('    Send-Msg $ws @{type="hello"; sysinfo=(Get-Info)}');
  L.push("    $buf = [byte[]]::new(1048576)");
  L.push("    $script:screenCapture = $false");
  L.push("    $script:capInterval = 1000");
  L.push("    $script:lastCapTime = [DateTime]::MinValue");
  L.push("    while ($ws.State -eq [Net.WebSockets.WebSocketState]::Open) {");
  // 道法自然: 投屏时用短超时让循环轮转, 否则无限等待
  L.push(
    "      $rcvTimeout = if($script:screenCapture){[math]::Max(100,$script:capInterval - 50)}else{30000}",
  );
  L.push("      $cts = [Threading.CancellationTokenSource]::new($rcvTimeout)");
  L.push("      $gotMsg = $false");
  L.push("      try {");
  L.push("        $seg = [ArraySegment[byte]]::new($buf)");
  L.push(
    "        $r = $ws.ReceiveAsync($seg, $cts.Token).GetAwaiter().GetResult()",
  );
  L.push("        $gotMsg = $true");
  L.push("      } catch [System.OperationCanceledException] { }");
  L.push("      finally { $cts.Dispose() }");
  L.push("      if (-not $gotMsg) { }"); // timeout → skip to screen capture
  L.push(
    "      elseif ($r.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) { break }",
  );
  L.push("      else {");
  L.push(
    "      $n = $r.Count; while (-not $r.EndOfMessage) { $seg = [ArraySegment[byte]]::new($buf,$n,$buf.Length-$n); $r = $ws.ReceiveAsync($seg,[Threading.CancellationToken]::None).GetAwaiter().GetResult(); $n += $r.Count }",
  );
  L.push(
    "      $msg = [Text.Encoding]::UTF8.GetString($buf,0,$n) | ConvertFrom-Json",
  );
  L.push("      switch ($msg.type) {");
  L.push('        "exec" {');
  L.push('          Write-Host "[>] $($msg.cmd)" -ForegroundColor Yellow');
  L.push(
    "          try { $sw=[Diagnostics.Stopwatch]::StartNew(); $out=(Invoke-Expression $msg.cmd) 2>&1|Out-String; $sw.Stop(); $out=$out.TrimEnd()",
  );
  L.push(
    '            if($out.Length -gt 102400){$out=$out.Substring(0,102400)+"`n...[truncated]"}',
  );
  L.push(
    '            Write-Host "[<] $($sw.ElapsedMilliseconds)ms" -ForegroundColor Green',
  );
  L.push(
    '            Send-Msg $ws @{type="cmd_result";id=$msg.id;ok=$true;output=$out;ms=$sw.ElapsedMilliseconds}',
  );
  L.push(
    '          } catch { Write-Host "[!] $_" -ForegroundColor Red; Send-Msg $ws @{type="cmd_result";id=$msg.id;ok=$false;output=$_.Exception.Message;ms=0} }',
  );
  L.push("        }");
  L.push('        "get_sysinfo" {');
  L.push(
    "          try { $c=(Get-CimInstance Win32_Processor -EA SilentlyContinue|Select -First 1).Name; $o=Get-CimInstance Win32_OperatingSystem -EA SilentlyContinue",
  );
  L.push(
    '            $dk=Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -EA SilentlyContinue|%{@{drive=$_.DeviceID;sizeGB=[math]::Round($_.Size/1GB,1);freeGB=[math]::Round($_.FreeSpace/1GB,1)}}',
  );
  L.push(
    '            $ad=Get-NetAdapter -EA SilentlyContinue|?{$_.Status -eq "Up"}|%{@{name=$_.Name;desc=$_.InterfaceDescription;speed=$_.LinkSpeed}}',
  );
  L.push(
    '            Send-Msg $ws @{type="sysinfo";cpu=$c;os=$o.Caption+" "+$o.Version;ramGB=[math]::Round($o.TotalVisibleMemorySize/1MB,1);ramFreeGB=[math]::Round($o.FreePhysicalMemory/1MB,1);disks=$dk;adapters=$ad;processes=(Get-Process -EA SilentlyContinue).Count;uptime=[math]::Round((New-TimeSpan -Start $o.LastBootUpTime).TotalHours,1)}',
  );
  L.push(
    '          } catch { Send-Msg $ws @{type="sysinfo";error=$_.Exception.Message} }',
  );
  L.push("        }");
  L.push(
    '        "ping" { Send-Msg $ws @{type="pong";time=(Get-Date -Format o)} }',
  );
  // 投屏链路: Agent端截屏推送 (timeout-based async — 道法自然, 不依赖线程)
  L.push('        "start_screen_capture" {');
  L.push(
    '          Write-Host "[screen] Starting capture (interval=$($msg.interval)ms)..." -ForegroundColor Cyan',
  );
  L.push("          $script:screenCapture = $true");
  L.push(
    "          $script:capInterval = if($msg.interval){[int]$msg.interval}else{1000}",
  );
  L.push("          $script:lastCapTime = [DateTime]::MinValue");
  L.push(
    "          Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
  );
  L.push("        }");
  L.push('        "stop_screen_capture" {');
  L.push("          $script:screenCapture = $false");
  L.push(
    '          Write-Host "[screen] Capture stopped" -ForegroundColor Yellow',
  );
  L.push('          Send-Msg $ws @{type="screen_stopped"}');
  L.push("        }");
  L.push("      }");
  L.push("      }"); // close else { (message handling)
  // 道法自然: 投屏帧在主循环中发送, 与消息接收交替进行
  // 反者道之动: 无需线程, ReceiveAsync超时后自然轮转到截屏
  L.push(
    "      if ($script:screenCapture -and $ws.State -eq [Net.WebSockets.WebSocketState]::Open) {",
  );
  L.push("        $now = [DateTime]::UtcNow");
  L.push(
    "        if (($now - $script:lastCapTime).TotalMilliseconds -ge $script:capInterval) {",
  );
  L.push("          try {");
  L.push("            $bounds = [Windows.Forms.Screen]::PrimaryScreen.Bounds");
  L.push(
    "            $scale = if($bounds.Width -gt 1920){[math]::Round(1920/$bounds.Width,2)}else{1}",
  );
  L.push(
    "            $cw = [int]($bounds.Width*$scale); $ch = [int]($bounds.Height*$scale)",
  );
  L.push("            $bmp = New-Object Drawing.Bitmap($cw,$ch)");
  L.push("            $g = [Drawing.Graphics]::FromImage($bmp)");
  L.push(
    "            $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::Low",
  );
  L.push(
    "            $g.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighSpeed",
  );
  L.push("            $g.CopyFromScreen(0,0,0,0,$bounds.Size)");
  L.push("            $ms2 = New-Object IO.MemoryStream");
  L.push(
    '            $enc = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()|?{$_.MimeType -eq "image/jpeg"}',
  );
  L.push("            $ep = New-Object Drawing.Imaging.EncoderParameters(1)");
  L.push(
    "            $ep.Param[0] = New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality,50L)",
  );
  L.push("            $bmp.Save($ms2,$enc,$ep)");
  L.push("            $b64 = [Convert]::ToBase64String($ms2.ToArray())");
  L.push("            $g.Dispose(); $bmp.Dispose(); $ms2.Dispose()");
  L.push(
    '            Send-Msg $ws @{type="screen_frame";image="data:image/jpeg;base64,$b64";width=$cw;height=$ch}',
  );
  L.push("            $script:lastCapTime = [DateTime]::UtcNow");
  L.push(
    '          } catch { Write-Host "[screen!] $_" -ForegroundColor DarkGray }',
  );
  L.push("        }");
  L.push("      }");
  L.push("    }");
  L.push(
    '  } catch { Write-Host "[-] Connection lost: $_" -ForegroundColor Red }',
  );
  L.push("  $script:screenCapture = $false");
  L.push("  try { $ws.Dispose() } catch {}");
  L.push(
    '  Write-Host "[...] Reconnect in 3s..." -ForegroundColor Yellow; Start-Sleep 3',
  );
  L.push("}");
  return L.join("\r\n");
}

// ==================== PS-AGENT PROXY (single-port access) ====================
function proxyToRelay(req, res, targetPath) {
  var parsed = new URL("http://127.0.0.1:" + RELAY_PORT + targetPath);
  var opts = {
    hostname: "127.0.0.1",
    port: RELAY_PORT,
    path: parsed.pathname + parsed.search,
    method: req.method,
    headers: Object.assign({}, req.headers, {
      host: "127.0.0.1:" + RELAY_PORT,
    }),
    timeout: 120000,
  };
  var proxy = http.request(opts, function (proxyRes) {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxy.on("error", function () {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "relay not reachable on port " + RELAY_PORT }),
    );
  });
  req.pipe(proxy, { end: true });
}

const server = http.createServer(function (req, res) {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    });
    res.end();
    return;
  }

  // ── 道 · /go — unified smart agent (auto ws/wss) — 需token ──
  if (req.method === "GET" && url.pathname === "/go") {
    if (!checkToken(req)) {
      denyToken(res);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(getUnifiedAgentScript(req));
    return;
  }
  // ── 道 · /dao/rtc — WebRTC REST fallback (WS 不可用时)
  //    POST /dao/rtc  { type:"offer"|"answer"|"ice-candidate", sdp/candidate }
  //    将 SDP/ICE 缓存, 对端 GET /dao/rtc?role=answer|offer 取走
  if (url.pathname === "/dao/rtc") {
    if (!checkToken(req)) {
      denyToken(res);
      return;
    }
    if (req.method === "POST") {
      readBody(req, function (body) {
        try {
          var msg = JSON.parse(body);
          if (!msg.type) {
            res.writeHead(400);
            res.end("missing type");
            return;
          }
          if (msg.type === "offer" || msg.type === "ice-candidate") {
            if (!_rtcPostBox.answer) _rtcPostBox.answer = [];
            _rtcPostBox.answer.push(msg);
            if (_rtcPostBox.answer.length > 20) _rtcPostBox.answer.shift();
          } else {
            if (!_rtcPostBox.offer) _rtcPostBox.offer = [];
            _rtcPostBox.offer.push(msg);
            if (_rtcPostBox.offer.length > 20) _rtcPostBox.offer.shift();
          }
          jsonReply(res, { ok: true });
        } catch (e) {
          res.writeHead(400);
          res.end("bad json");
        }
      });
      return;
    }
    if (req.method === "GET") {
      var forRole = url.searchParams.get("role") || "offer";
      var msgs = _rtcPostBox[forRole] || [];
      _rtcPostBox[forRole] = [];
      jsonReply(res, { messages: msgs });
      return;
    }
    res.writeHead(405);
    res.end("POST or GET only");
    return;
  }
  // ── 道 · /files — 文件传输 (RustDesk/MeshCentral 均有此功能)
  //    GET  /files?path=C:/Users  → 列目录
  //    GET  /files/get?path=...   → 下载文件
  //    POST /files/put?path=...   → 上传文件 (body = raw file content)
  if (url.pathname === "/files" && req.method === "GET") {
    if (!checkToken(req)) {
      denyToken(res);
      return;
    }
    var targetPath =
      url.searchParams.get("path") ||
      (process.platform === "win32" ? "C:\\" : "/");
    var fs = require("fs");
    try {
      var entries = fs.readdirSync(targetPath, { withFileTypes: true });
      var result = entries.slice(0, 200).map(function (e) {
        var stat = null;
        try {
          stat = fs.statSync(require("path").join(targetPath, e.name));
        } catch (x) {}
        return {
          name: e.name,
          type: e.isDirectory() ? "dir" : "file",
          size: stat ? stat.size : 0,
          mtime: stat ? stat.mtimeMs : 0,
        };
      });
      jsonReply(res, { path: targetPath, entries: result });
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  if (url.pathname === "/files/get" && req.method === "GET") {
    if (!checkToken(req)) {
      denyToken(res);
      return;
    }
    var filePath = url.searchParams.get("path");
    if (!filePath) {
      res.writeHead(400);
      res.end("missing path");
      return;
    }
    var fs = require("fs");
    try {
      var stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        res.writeHead(400);
        res.end("is directory");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition":
          'attachment; filename="' + require("path").basename(filePath) + '"',
        "Content-Length": stat.size,
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (e) {
      res.writeHead(404);
      res.end(e.message);
    }
    return;
  }
  if (url.pathname === "/files/put" && req.method === "POST") {
    if (!checkToken(req)) {
      denyToken(res);
      return;
    }
    var destPath = url.searchParams.get("path");
    if (!destPath) {
      res.writeHead(400);
      res.end("missing path");
      return;
    }
    var fs = require("fs");
    try {
      var dir = require("path").dirname(destPath);
      fs.mkdirSync(dir, { recursive: true });
      var ws = fs.createWriteStream(destPath);
      req.pipe(ws);
      ws.on("finish", function () {
        jsonReply(res, { ok: true, path: destPath });
      });
      ws.on("error", function (e) {
        res.writeHead(500);
        res.end(e.message);
      });
    } catch (e) {
      res.writeHead(500);
      res.end(e.message);
    }
    return;
  }
  // ── 道 · /dao/clipboard — 剪贴板同步 (RustDesk/MeshCentral 标配)
  //    GET  /dao/clipboard       → 读取远程剪贴板
  //    POST /dao/clipboard       → 写入远程剪贴板 { text: "..." }
  if (url.pathname === "/dao/clipboard") {
    if (!checkToken(req)) {
      denyToken(res);
      return;
    }
    if (req.method === "GET") {
      var clipCmd =
        process.platform === "win32"
          ? 'powershell -NoProfile -Command "Get-Clipboard -Raw"'
          : process.platform === "darwin"
            ? "pbpaste"
            : "xclip -selection clipboard -o";
      require("child_process").exec(
        clipCmd,
        { timeout: 5000, encoding: "utf-8" },
        function (err, stdout) {
          if (err) {
            jsonReply(res, { text: "", error: err.message });
            return;
          }
          jsonReply(res, { text: stdout || "" });
        },
      );
      return;
    }
    if (req.method === "POST") {
      readBody(req, function (body) {
        try {
          var msg = JSON.parse(body);
          var text = msg.text || "";
          if (process.platform === "win32") {
            var cp = require("child_process");
            var p = cp.spawn(
              "powershell",
              ["-NoProfile", "-Command", "Set-Clipboard -Value $input"],
              { stdio: ["pipe", "ignore", "ignore"] },
            );
            p.stdin.end(text);
            p.on("close", function () {
              jsonReply(res, { ok: true });
            });
            p.on("error", function (e) {
              jsonReply(res, { ok: false, error: e.message });
            });
          } else if (process.platform === "darwin") {
            var cp = require("child_process");
            var p = cp.spawn("pbcopy", [], {
              stdio: ["pipe", "ignore", "ignore"],
            });
            p.stdin.end(text);
            p.on("close", function () {
              jsonReply(res, { ok: true });
            });
          } else {
            var cp = require("child_process");
            var p = cp.spawn("xclip", ["-selection", "clipboard"], {
              stdio: ["pipe", "ignore", "ignore"],
            });
            p.stdin.end(text);
            p.on("close", function () {
              jsonReply(res, { ok: true });
            });
          }
        } catch (e) {
          res.writeHead(400);
          res.end("bad json");
        }
      });
      return;
    }
    res.writeHead(405);
    res.end("GET or POST only");
    return;
  }
  // ── 道 · /dao/discover — 五感之根: 身份 + LAN IP + 端口 + NAT 状态
  //    零 token 权限: 仅返回公开信息 (fingerprint/ips/port/publicUrl)
  //    供客户端从鉴旧 URL 即时知晓 hub 实际身份, 避免酵健廢教 URL
  if (req.method === "GET" && url.pathname === "/dao/discover") {
    var ips = getAllLanIPs();
    var natStatus = null;
    try {
      if (global.__daoNat && global.__daoNat.mapping)
        natStatus = global.__daoNat.mapping;
    } catch (e) {}
    jsonReply(res, {
      version: 1,
      fingerprint: _daoFingerprint,
      port: _listenPort,
      ips: ips,
      publicUrl: _publicUrl || "",
      reqHost: getReqHost(req),
      reqProto: getReqHttpProto(req),
      nat: natStatus,
      ts: Math.floor(Date.now() / 1000),
    });
    return;
  }
  // ── 道 · /pair — 一码配对 ──
  //   GET /pair?format=json|svg|ascii|png&ttl=600  (默认返 HTML 可视化页)
  //   需 token 权限 (用户已授权才能生成新配对链接)
  if (req.method === "GET" && url.pathname === "/pair") {
    if (!checkToken(req)) {
      denyToken(res);
      return;
    }
    var fmt = (url.searchParams.get("format") || "html").toLowerCase();
    var ttl = parseInt(url.searchParams.get("ttl") || "600", 10);
    if (!(ttl > 0)) ttl = 600;
    if (ttl > 86400) ttl = 86400;
    // 道生一 · QR 小则活: 生成 32 字节 pairId, 客户端 POST /pair/claim 兑换真 token
    //   这样 URI 里没有长 token (Ed25519 JWT 228 字符, 超 QR v10-L 容量)
    //   一次性 + 10 分钟 TTL + 到期自删 — 比直接塞 token 更安全
    var pairId = crypto.randomBytes(16).toString("hex");
    var longToken = _daoIdentity.createToken(ttl, { role: "pair" });
    var expiresAt = Math.floor(Date.now() / 1000) + ttl;
    _pairSessions.set(pairId, {
      token: longToken,
      expiresAt: Date.now() + ttl * 1000,
      used: false,
    });
    var ips = getAllLanIPs();
    var natMap = null;
    try {
      if (global.__daoNat && global.__daoNat.mapping)
        natMap = global.__daoNat.mapping;
    } catch (e) {}
    var pub = _publicUrl || getReqHost(req) || "";
    var daoUri = daoPair.buildPairUri({
      fingerprint: _daoFingerprint,
      token: pairId,
      port: _listenPort,
      ips: ips,
      publicUrl:
        pub.indexOf("://") >= 0
          ? pub
          : pub
            ? getReqHttpProto(req) + "://" + pub
            : "",
      externalIP: natMap ? natMap.externalIP : "",
      externalPort: natMap ? natMap.externalPort : 0,
      expiresAt: expiresAt,
    });
    // 道法自然 · 浏览器友好 QR: 扫码直接跳浏览器落地页 (手机无需装 App)
    //   格式: <proto>://<host>:<port>/c#<pairId>.<fp>
    //   落地页 JS 自动 claim + TOFU 记忆 + 跳 /sense
    var proto = getReqHttpProto(req);
    var host = "";
    if (pub) {
      host = pub.indexOf("://") >= 0 ? pub.split("://")[1] : pub;
      host = host.replace(/\/$/, "");
    } else {
      host = (ips[0] || "127.0.0.1") + ":" + _listenPort;
    }
    var webUri = proto + "://" + host + "/c#" + pairId + "." + _daoFingerprint;
    if (fmt === "json") {
      jsonReply(res, {
        uri: webUri,
        webUri: webUri,
        daoUri: daoUri,
        pairId: pairId,
        fingerprint: _daoFingerprint,
        port: _listenPort,
        ips: ips,
        publicUrl: pub,
        nat: natMap,
        expiresAt: expiresAt,
        ttlSec: ttl,
        claimUrl: "/pair/claim",
      });
      return;
    }
    // QR 编码浏览器 URL (用户扫码直接打开手机默认浏览器 → /c 落地页自动 claim)
    var uri = webUri;
    var qr;
    try {
      qr = daoPair.qrFromText(uri, "L");
    } catch (e) {
      jsonReply(res, { error: "qr encode failed: " + e.message }, 500);
      return;
    }
    if (fmt === "svg") {
      var svg = daoPair.renderSvg(qr, { scale: 8, border: 4 });
      res.writeHead(200, {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(svg);
      return;
    }
    if (fmt === "png") {
      var png = daoPair.renderPng(qr, { scale: 8, border: 4 });
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Length": png.length,
      });
      res.end(png);
      return;
    }
    if (fmt === "ascii") {
      var ascii = daoPair.renderAscii(qr, { border: 2 });
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(ascii + "\n\nURI:\n" + uri + "\n\nExpires in " + ttl + "s\n");
      return;
    }
    // default: HTML 可视化页
    var svgInline = daoPair.renderSvg(qr, { scale: 8, border: 4 });
    var expireTxt = new Date(
      (Math.floor(Date.now() / 1000) + ttl) * 1000,
    ).toISOString();
    // 从本次请求抽取 token (query 或 Authorization), 传递到子链接
    var myTok = url.searchParams.get("token") || "";
    if (!myTok) {
      var auth = (req.headers || {}).authorization || "";
      if (auth.startsWith("Bearer ")) myTok = auth.slice(7);
    }
    var tokQS = myTok ? "&token=" + encodeURIComponent(myTok) : "";
    var html =
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>道 · 配对</title>' +
      "<style>body{background:#0b0b0b;color:#eee;font-family:monospace;margin:0;padding:40px;display:flex;flex-direction:column;align-items:center;gap:20px}" +
      ".qr{background:#fff;padding:12px;border-radius:12px;box-shadow:0 8px 48px rgba(0,0,0,.5)}" +
      ".uri{word-break:break-all;max-width:90vw;background:#111;padding:16px;border-radius:8px;border:1px solid #333;font-size:12px;line-height:1.6}" +
      ".meta{color:#888;font-size:12px;text-align:center}" +
      "h1{font-weight:300;letter-spacing:.2em;margin:0}" +
      ".fp{color:#4af}</style></head><body>" +
      "<h1>道 &nbsp;·&nbsp; 一码配对</h1>" +
      '<div class="qr">' +
      svgInline +
      "</div>" +
      '<div class="uri">' +
      uri.replace(/&/g, "&amp;").replace(/</g, "&lt;") +
      "</div>" +
      '<div class="meta">指纹 <span class="fp">' +
      (_daoFingerprint || "?") +
      "</span> &nbsp;·&nbsp; " +
      "TTL " +
      ttl +
      "s &nbsp;·&nbsp; 失效 " +
      expireTxt +
      "</div>" +
      '<div class="meta">扫一扫 = 认身份 + 拿令牌 + 知坐标 &nbsp;·&nbsp; ' +
      '打印全文本: <a style="color:#4af" href="/pair?format=ascii' +
      tokQS +
      '" target="_blank">ASCII</a> ' +
      '&nbsp;·&nbsp; PNG: <a style="color:#4af" href="/pair?format=png' +
      tokQS +
      '" target="_blank">下载</a></div>' +
      "</body></html>";
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    res.end(html);
    return;
  }
  // ── 道 · /c — PWA 落地页 ──
  //   QR 扫码跳 /c#<base64url(pairId,fp,port,ips,pu,exp)>
  //   浏览器打开 → JS 解析 hash → POST /pair/claim 换 token → TOFU 写 localStorage → 跳 /sense?token=X
  //   再次访问 /c: 从 localStorage 读 token, 指纹匹配则直接跳 /sense, 无需再扫
  //   荃者所以在鱼 · 得鱼而忘荃: 扫一次永久在, 用户忘记扫码这件事
  if (req.method === "GET" && url.pathname === "/c") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(getClaimLandingPage());
    return;
  }
  // ── 道 · /manifest.webmanifest — PWA 可安装清单 ──
  if (req.method === "GET" && url.pathname === "/manifest.webmanifest") {
    res.writeHead(200, {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
    res.end(
      JSON.stringify({
        name: "道 · 远程中枢",
        short_name: "道",
        description: "Ed25519 端到端 · 扫码即入 · 永不忘忆",
        start_url: "/c",
        scope: "/",
        display: "standalone",
        background_color: "#0b0b0b",
        theme_color: "#0b0b0b",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      }),
    );
    return;
  }
  // ── 道 · /icon.svg — PWA 图标 (极简太极) ──
  if (req.method === "GET" && url.pathname === "/icon.svg") {
    var icon =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
      '<rect width="512" height="512" fill="#0b0b0b"/>' +
      '<circle cx="256" cy="256" r="200" fill="none" stroke="#eee" stroke-width="8"/>' +
      '<path d="M256 56 A200 200 0 0 1 256 456 A100 100 0 0 1 256 256 A100 100 0 0 0 256 56 Z" fill="#eee"/>' +
      '<circle cx="256" cy="156" r="28" fill="#0b0b0b"/>' +
      '<circle cx="256" cy="356" r="28" fill="#eee"/>' +
      "</svg>";
    res.writeHead(200, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    });
    res.end(icon);
    return;
  }
  // ── 道 · /pair/claim — 一次性兑换: pairId → Ed25519 长 token ──
  //   POST /pair/claim   body: { pairId } or ?pairId=...
  //   成功: { ok, token, fingerprint, expiresAt, ttlSec } (token 只有此时下发一次)
  //   失败: 404/410 (不存在/已用/到期)
  //   零 token 权限: 本身就是身份验证的入口, 但有 pairId 未知性保护
  //   并有速率限制 + 一次性使用
  if (req.method === "POST" && url.pathname === "/pair/claim") {
    var clientIP = (
      (req.socket || req.connection || {}).remoteAddress || ""
    ).replace(/^::ffff:/, "");
    if (!_authLimiter.check(clientIP)) {
      jsonReply(res, { ok: false, error: "rate_limited" }, 429);
      return;
    }
    readBody(req, function (body) {
      var pid = "";
      try {
        if (body) {
          var m = JSON.parse(body);
          pid = (m && m.pairId) || "";
        }
      } catch (e) {}
      if (!pid) pid = url.searchParams.get("pairId") || "";
      if (!pid || !/^[0-9a-f]{32}$/.test(pid)) {
        jsonReply(res, { ok: false, error: "bad_pair_id" }, 400);
        return;
      }
      var sess = _pairSessions.get(pid);
      if (!sess) {
        jsonReply(res, { ok: false, error: "not_found_or_used" }, 404);
        return;
      }
      if (sess.used) {
        _pairSessions.delete(pid);
        jsonReply(res, { ok: false, error: "already_claimed" }, 410);
        return;
      }
      if (sess.expiresAt < Date.now()) {
        _pairSessions.delete(pid);
        jsonReply(res, { ok: false, error: "expired" }, 410);
        return;
      }
      // 一次性: 成功即删 — 瞬遇即逝
      sess.used = true;
      _pairSessions.delete(pid);
      var expSec = Math.floor(sess.expiresAt / 1000);
      jsonReply(res, {
        ok: true,
        token: sess.token,
        fingerprint: _daoFingerprint,
        port: _listenPort,
        ips: getAllLanIPs(),
        publicUrl: _publicUrl || "",
        expiresAt: expSec,
        ttlSec: expSec - Math.floor(Date.now() / 1000),
      });
    });
    return;
  }
  // ── 道 · /status — system status JSON ──
  if (req.method === "GET" && url.pathname === "/status") {
    var screenObj = {};
    _screenSources.forEach(function (v, k) {
      screenObj[k] = v;
    });
    jsonReply(res, {
      version: "dao-v7",
      publicUrl: _publicUrl,
      tunnel: isSecure(),
      dao: {
        fingerprint: _daoFingerprint,
        bestInput: _daoBestInput,
        bestCodec: _daoBestCodec,
        adbPath: _daoAdbPath,
      },
      hub: {
        port: PORT,
        sense: senseData.connected,
        agents: agentSockets.size,
        screenViewers: _screenClients.size,
      },
      relay: { port: RELAY_PORT, url: bridge.relayUrl },
      agents: getAgentList(),
      screen: { sources: screenObj, best: getBestScreenSource() },
      remoteTools: _remoteTools,
      sunlogin: _sunloginBridge.ready
        ? {
            version: _sunloginBridge.deviceInfo.version,
            hostname: _sunloginBridge.deviceInfo.hostname,
            running: _sunloginBridge.processStatus.running,
            plugins: _sunloginBridge.capabilities.plugins.length,
            features: _sunloginBridge.getFullStatus().features,
          }
        : null,
    });
    return;
  }
  // ── 万法之资: /tools — 远程工具注册表 — 适配一切, 自动发现 ──
  if (req.method === "GET" && url.pathname === "/tools") {
    // 道法自然: 返回道核发现的一切已安装远程工具 + 实时状态
    var tools = _remoteTools.map(function (t) {
      var src = t.port ? _screenSources.get(t.id) : null;
      return {
        id: t.id,
        name: t.name,
        path: t.path,
        running: t.running,
        port: t.port,
        api: t.api,
        online: src ? src.status === "online" : false,
      };
    });
    jsonReply(res, { ok: true, tools: tools, count: tools.length });
    return;
  }
  // ── 一键调用: /tools/launch — 自动打开用户已安装的投屏工具 ──
  if (req.method === "POST" && url.pathname === "/tools/launch") {
    if (!checkToken(req)) {
      denyToken(res);
      return;
    }
    readBody(req, function (body) {
      try {
        var m = JSON.parse(body);
        var toolId = m.id || "";
        var tool = _remoteTools.find(function (t) {
          return t.id === toolId;
        });
        if (!tool || !tool.path) {
          jsonReply(res, {
            ok: false,
            error: "工具未找到或无可执行路径: " + toolId,
          });
          return;
        }
        // 万法归宗: 优先通过Agent远程启动, 无Agent则本地启动
        var defAgent = getDefaultAgent();
        if (defAgent) {
          execOnAgent(
            'Start-Process "' + tool.path.replace(/\\/g, "\\\\") + '"',
            8000,
          )
            .then(function (r) {
              jsonReply(res, {
                ok: true,
                tool: tool.name,
                via: "agent",
                output: r.output,
              });
            })
            .catch(function (e) {
              jsonReply(res, { ok: false, tool: tool.name, error: e.message });
            });
        } else {
          // 无Agent: 本地启动
          try {
            require("child_process")
              .spawn(tool.path, [], {
                detached: true,
                stdio: "ignore",
                windowsHide: false,
              })
              .unref();
            jsonReply(res, { ok: true, tool: tool.name, via: "local" });
          } catch (e) {
            jsonReply(res, { ok: false, tool: tool.name, error: e.message });
          }
        }
      } catch (e) {
        jsonReply(res, { error: "bad json" }, 400);
      }
    });
    return;
  }
  // ── /tools/auto — 无为而无不为: 自动启动最优远程工具 ──
  if (req.method === "POST" && url.pathname === "/tools/auto") {
    if (!checkToken(req)) {
      denyToken(res);
      return;
    }
    // 道法自然: 先检查是否已有投屏源在线, 有则无需启动
    var best = getBestScreenSource();
    if (best) {
      jsonReply(res, {
        ok: true,
        action: "none",
        reason: "已有投屏源在线: " + best.name,
        best: best,
      });
      return;
    }
    // 无投屏源 → 自动启动第一个可用工具
    var launchable = _remoteTools.find(function (t) {
      return t.path;
    });
    if (!launchable) {
      jsonReply(res, { ok: false, error: "未发现任何已安装的远程工具" });
      return;
    }
    var defAgent = getDefaultAgent();
    if (defAgent) {
      execOnAgent(
        'Start-Process "' + launchable.path.replace(/\\/g, "\\\\") + '"',
        8000,
      )
        .then(function (r) {
          jsonReply(res, {
            ok: true,
            action: "launched",
            tool: launchable.name,
            via: "agent",
          });
        })
        .catch(function (e) {
          jsonReply(res, {
            ok: false,
            tool: launchable.name,
            error: e.message,
          });
        });
    } else {
      try {
        require("child_process")
          .spawn(launchable.path, [], {
            detached: true,
            stdio: "ignore",
            windowsHide: false,
          })
          .unref();
        jsonReply(res, {
          ok: true,
          action: "launched",
          tool: launchable.name,
          via: "local",
        });
      } catch (e) {
        jsonReply(res, { ok: false, tool: launchable.name, error: e.message });
      }
    }
    return;
  }
  // ── ps-agent proxy: /relay/* → localhost:RELAY_PORT/* ──
  if (url.pathname.startsWith("/relay/") || url.pathname === "/relay") {
    var relayPath = url.pathname.replace(/^\/relay/, "") || "/";
    if (url.search) relayPath += url.search;
    proxyToRelay(req, res, relayPath);
    return;
  }

  // ── 投屏链路: /screen/* — 万法之资, 适配一切 ──
  if (url.pathname === "/screen/sources") {
    discoverScreenSources().then(function (found) {
      var sources = {};
      _screenSources.forEach(function (v, k) {
        sources[k] = v;
      });
      jsonReply(res, {
        ok: true,
        available: found,
        sources: sources,
        best: getBestScreenSource(),
        remoteTools: _remoteTools,
      });
    });
    return;
  }
  if (url.pathname === "/screen/capture") {
    var mode = url.searchParams.get("mode") || "auto";
    var serial = url.searchParams.get("serial") || "";
    var hostname = url.searchParams.get("hostname") || "";
    // 万法之资: 按优先级尝试截屏 — ghost > scrcpy > adb_hub > dao > sunlogin > agent
    var ghostSrc = _screenSources.get("ghost");
    var daoSrc = _screenSources.get("dao");
    var adbSrc = _screenSources.get("adb_hub");
    var sunSrc = _screenSources.get("sunlogin");
    if (
      mode === "ghost" ||
      (mode === "auto" && ghostSrc && ghostSrc.status === "online")
    ) {
      if (!ghostSrc || ghostSrc.status !== "online") {
        jsonReply(res, { ok: false, error: "ghost_shell offline" });
        return;
      }
      // ghost_shell: GET /capture → raw JPEG image, proxy directly
      proxyToScreen(req, res, ghostSrc.url + "/capture");
    } else if (
      mode === "scrcpy" ||
      (mode === "auto" &&
        _screenSources.has("scrcpy") &&
        _screenSources.get("scrcpy").status === "online")
    ) {
      captureScreenViaScrcpy(serial)
        .then(function (r) {
          jsonReply(res, r);
        })
        .catch(function (e) {
          jsonReply(res, { ok: false, error: e.message });
        });
    } else if (
      mode === "adb_hub" ||
      (mode === "auto" && adbSrc && adbSrc.status === "online")
    ) {
      // adb_hub: GET /api/adb/screencap → PNG image
      proxyToScreen(
        req,
        res,
        adbSrc.url +
          "/api/adb/screencap?device=" +
          serial +
          "&token=" +
          ADB_HUB_TOKEN,
      );
    } else if (
      mode === "dao" ||
      (mode === "auto" && daoSrc && daoSrc.status === "online")
    ) {
      // dao-remote: GET /capture → JPEG image
      proxyToScreen(req, res, daoSrc.url + "/capture");
    } else if (mode === "sunlogin") {
      // 向日葵 v15 无本地流式 API — 作为启动器通过 /tools/launch 调用
      jsonReply(res, {
        ok: false,
        error: "sunlogin 为 P2P 启动器, 无本地流源",
        hint: "POST /tools/launch?id=sunlogin 启动主控界面",
      });
    } else if (mode === "agent" || mode === "auto") {
      captureScreenViaAgent(hostname)
        .then(function (r) {
          jsonReply(res, {
            ok: r.ok,
            image: "data:image/jpeg;base64," + (r.output || "").trim(),
            ms: r.ms,
            source: "agent-screencap",
          });
        })
        .catch(function (e) {
          jsonReply(res, { ok: false, error: e.message });
        });
    } else {
      jsonReply(res, { ok: false, error: "no capture source" });
    }
    return;
  }
  // MJPEG/stream直通: /screen/stream → 代理到最佳投屏服务
  if (url.pathname === "/screen/stream") {
    var src = getBestScreenSource();
    if (src && src.name === "ghost") {
      // 道法自然: ghost_shell支持MJPEG实时流, 直接代理
      proxyToScreen(req, res, src.url + "/stream/mjpeg");
    } else if (src && src.name === "dao") {
      proxyToScreen(req, res, src.url + "/capture");
    } else if (src && src.name === "mjpeg") {
      proxyToScreen(req, res, src.url + "/stream/mjpeg");
    } else if (src && src.name === "scrcpy") {
      jsonReply(res, {
        ok: false,
        hint: "scrcpy uses native protocol, use /screen/capture for snapshots or connect scrcpy directly",
        scrcpy: src.url,
      });
    } else if (src && src.name === "adb_hub") {
      proxyToScreen(
        req,
        res,
        src.url + "/api/adb/screencap?token=" + ADB_HUB_TOKEN,
      );
    } else {
      jsonReply(res, { ok: false, error: "no streaming source online" });
    }
    return;
  }
  // scrcpy代理: /screen/scrcpy/* → 代理到scrcpy Hub
  if (url.pathname.startsWith("/screen/scrcpy/")) {
    var scrcpySrc = _screenSources.get("scrcpy");
    if (scrcpySrc && scrcpySrc.status === "online") {
      var targetPath =
        url.pathname.replace("/screen/scrcpy", "") + (url.search || "");
      proxyToScreen(req, res, scrcpySrc.url + targetPath);
    } else {
      jsonReply(res, { ok: false, error: "scrcpy hub offline" }, 502);
    }
    return;
  }
  // ghost_shell代理: /screen/ghost/* → 代理到ghost_shell
  if (url.pathname.startsWith("/screen/ghost/")) {
    var ghostProxy = _screenSources.get("ghost");
    if (ghostProxy && ghostProxy.status === "online") {
      var ghostPath =
        url.pathname.replace("/screen/ghost", "") + (url.search || "");
      proxyToScreen(req, res, ghostProxy.url + ghostPath);
    } else {
      jsonReply(res, { ok: false, error: "ghost_shell offline" }, 502);
    }
    return;
  }
  // adb_hub代理: /screen/adb/* → 代理到adb_hub
  if (url.pathname.startsWith("/screen/adb/")) {
    var adbProxy = _screenSources.get("adb_hub");
    if (adbProxy && adbProxy.status === "online") {
      var adbPath =
        url.pathname.replace("/screen/adb", "/api/adb") + (url.search || "");
      if (!adbPath.includes("token="))
        adbPath +=
          (adbPath.includes("?") ? "&" : "?") + "token=" + ADB_HUB_TOKEN;
      proxyToScreen(req, res, adbProxy.url + adbPath);
    } else {
      jsonReply(res, { ok: false, error: "adb_hub offline" }, 502);
    }
    return;
  }
  // dao-remote代理: /screen/dao/* → 代理到dao-remote
  if (url.pathname.startsWith("/screen/dao/")) {
    var daoProxy = _screenSources.get("dao");
    if (daoProxy && daoProxy.status === "online") {
      var daoPath =
        url.pathname.replace("/screen/dao", "") + (url.search || "");
      proxyToScreen(req, res, daoProxy.url + daoPath);
    } else {
      jsonReply(res, { ok: false, error: "dao-remote offline" }, 502);
    }
    return;
  }
  // 向日葵: 分类正确 — 启动器, 非流源. v15 无本地 HTTP API.
  if (url.pathname.startsWith("/screen/sunlogin/")) {
    jsonReply(
      res,
      {
        ok: false,
        error: "sunlogin 为 P2P 启动器, 无本地流式 API",
        hint: "POST /tools/launch?id=sunlogin 启动主控界面",
      },
      404,
    );
    return;
  }
  // ═══ 万法之资: 向日葵全功能API — /sunlogin/* ═══
  if (url.pathname.startsWith("/sunlogin")) {
    // /sunlogin/status — 向日葵完整状态 (设备+进程+能力+功能)
    if (url.pathname === "/sunlogin/status" || url.pathname === "/sunlogin") {
      var slStatus = _sunloginBridge.getFullStatus();
      jsonReply(res, slStatus);
      return;
    }
    // /sunlogin/device — 本设备信息
    if (url.pathname === "/sunlogin/device") {
      jsonReply(res, {
        ok: true,
        device: _sunloginBridge.deviceInfo,
      });
      return;
    }
    // /sunlogin/plugins — 插件列表
    if (url.pathname === "/sunlogin/plugins") {
      jsonReply(res, {
        ok: true,
        capabilities: _sunloginBridge.capabilities,
      });
      return;
    }
    // /sunlogin/process — 进程状态 (实时刷新)
    if (url.pathname === "/sunlogin/process") {
      jsonReply(res, {
        ok: true,
        process: _sunloginBridge.refreshProcess(),
      });
      return;
    }
    // /sunlogin/devices — 云端设备列表 (调用Oray API)
    if (url.pathname === "/sunlogin/devices") {
      _sunloginBridge
        .fetchDevices()
        .then(function (r) {
          jsonReply(res, { ok: true, result: r });
        })
        .catch(function (e) {
          jsonReply(res, { ok: false, error: e.message });
        });
      return;
    }
    // /sunlogin/launch — 启动向日葵功能
    if (url.pathname === "/sunlogin/launch") {
      if (req.method === "POST") {
        readBody(req, function (body) {
          try {
            var params = JSON.parse(body);
            var result = _sunloginBridge.launch(
              params.action || "open",
              params,
            );
            jsonReply(res, result);
          } catch (e) {
            jsonReply(res, { ok: false, error: e.message });
          }
        });
      } else {
        var action = url.searchParams.get("action") || "open";
        var result = _sunloginBridge.launch(action, {
          deviceId: url.searchParams.get("id"),
        });
        jsonReply(res, result);
      }
      return;
    }
    // /sunlogin/config — 配置摘要 (不含敏感信息)
    if (url.pathname === "/sunlogin/config") {
      var cfg = _sunloginBridge.config || {};
      jsonReply(res, {
        ok: true,
        desktop: cfg.desktop || {},
        security: {
          useCustomPassword: (cfg.security || {}).usecustompassword === "1",
          useWindowsUser: (cfg.security || {}).usewindowuser === "1",
        },
        forward: {
          channels: (_sunloginBridge.deviceInfo || {}).portForwarding || [],
        },
      });
      return;
    }
    // 未知路由
    jsonReply(
      res,
      {
        ok: false,
        error: "unknown sunlogin endpoint",
        endpoints: [
          "/sunlogin/status",
          "/sunlogin/device",
          "/sunlogin/plugins",
          "/sunlogin/process",
          "/sunlogin/devices",
          "/sunlogin/launch",
          "/sunlogin/config",
        ],
      },
      404,
    );
    return;
  }
  // ── /api/health — 道生一: Hub自身健康探针 ──
  if (req.method === "GET" && url.pathname === "/api/health") {
    jsonReply(res, {
      ok: true,
      service: "dao-remote-hub",
      version: "8.0",
      uptime: process.uptime(),
      agents: agentSockets.size,
      sense: senseData.connected,
      screenViewers: _screenClients.size,
    });
    return;
  }
  // ── 反向控制: /input/* — 触控/按键/文本, 适配一切 ──
  if (url.pathname.startsWith("/input/")) {
    if (!checkToken(req)) {
      denyToken(res);
      return;
    }
    var action = url.pathname.replace("/input/", "");
    if (req.method === "POST") {
      readBody(req, function (body) {
        try {
          var params = JSON.parse(body);
          sendInputToDevice(action, params, params.serial)
            .then(function (r) {
              jsonReply(res, { ok: true, action: action, result: r });
            })
            .catch(function (e) {
              jsonReply(res, { ok: false, action: action, error: e.message });
            });
        } catch (e) {
          jsonReply(res, { error: "bad json" }, 400);
        }
      });
    } else if (req.method === "GET") {
      // GET shortcuts: /input/home, /input/back, /input/screenshot
      sendInputToDevice(action, {
        serial: url.searchParams.get("serial") || "",
      })
        .then(function (r) {
          jsonReply(res, { ok: true, action: action, result: r });
        })
        .catch(function (e) {
          jsonReply(res, { ok: false, action: action, error: e.message });
        });
    } else {
      jsonReply(res, { error: "method not allowed" }, 405);
    }
    return;
  }

  // ── 道 · /marble — WorldLabs 3D世界 Gaussian Splatting Viewer ──
  if (req.method === "GET" && url.pathname === "/marble") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    var reqHost = getReqHost(req);
    res.end(require("./marble_page.js")(reqHost, MASTER_TOKEN));
    return;
  }

  // ── 道 · /marble/api/* — WorldLabs API proxy (万法之资,探囊取物) ──
  // Proxies to https://api.worldlabs.ai/marble/v1/* with server-side API key
  if (url.pathname.startsWith("/marble/api/")) {
    if (!checkToken(req)) {
      denyToken(res);
      return;
    }
    var wltKey = process.env.WLT_API_KEY || "";
    if (!wltKey) {
      jsonReply(
        res,
        {
          error:
            "WLT_API_KEY not configured. Set env var WLT_API_KEY to your WorldLabs API key.",
        },
        500,
      );
      return;
    }
    var apiPath = url.pathname.replace("/marble/api/", "");
    var apiUrl = "https://api.worldlabs.ai/marble/v1/" + apiPath;
    readBody(req, function (body) {
      var fetchOpts = {
        method: req.method,
        headers: {
          "WLT-Api-Key": wltKey,
          "Content-Type": "application/json",
        },
      };
      if (body && req.method !== "GET") fetchOpts.body = body;
      fetch(apiUrl, fetchOpts)
        .then(function (r) {
          return r.json().then(function (j) {
            return { status: r.status, body: j };
          });
        })
        .then(function (r) {
          jsonReply(res, r.body, r.status);
        })
        .catch(function (e) {
          jsonReply(res, { error: e.message }, 502);
        });
    });
    return;
  }

  if (
    req.method === "GET" &&
    (url.pathname === "/" || url.pathname === "/sense")
  ) {
    // 安全补缺: 远程访问 / 或 /sense 必须带令牌, 否则导向 /c 引导配对
    //   本机 127.0.0.1/::1 天然免鉴权 (checkToken 内建豁免)
    //   若远程无 token: 不返回含 MASTER_TOKEN 的页面 (防泄露), 而是重定向到配对页
    if (!checkToken(req)) {
      res.writeHead(302, {
        Location: "/c",
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(getSensePage(req));
    return;
  }
  if (req.method === "GET" && url.pathname === "/agent.ps1") {
    if (!checkToken(req)) {
      denyToken(res);
      return;
    }
    // 道法自然: /agent.ps1 统一指向 /go (Unified Agent v7.0 含投屏+控制)
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(getUnifiedAgentScript(req));
    return;
  }
  // ── 安全通道: /brain/* 统一token验证 ──
  if (url.pathname.startsWith("/brain/")) {
    if (!checkToken(req)) {
      denyToken(res);
      return;
    }
  }
  if (req.method === "GET" && url.pathname === "/brain/state") {
    jsonReply(res, {
      sense: senseData,
      agents: getAgentList(),
      agent: getDefaultAgentData(),
      pending: pendingCommands.size,
      history: commandHistory.length,
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/brain/results") {
    jsonReply(res, senseData.diagnostics || []);
    return;
  }
  if (req.method === "GET" && url.pathname === "/brain/terminal") {
    const n = parseInt(url.searchParams.get("n")) || 20;
    jsonReply(res, commandHistory.slice(-n));
    return;
  }
  if (req.method === "POST" && url.pathname === "/brain/say") {
    readBody(req, function (body) {
      try {
        const m = JSON.parse(body);
        if (senseSocket && senseSocket.readyState === 1) {
          senseSocket.send(
            JSON.stringify({
              type: "say",
              level: m.level || "system",
              text: m.text,
            }),
          );
          jsonReply(res, { ok: true, delivered: true });
        } else {
          messageQueue.push(m);
          jsonReply(res, { ok: true, queued: true });
        }
      } catch (e) {
        jsonReply(res, { error: "bad json" }, 400);
      }
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/brain/command") {
    readBody(req, function (body) {
      try {
        const m = JSON.parse(body);
        if (senseSocket && senseSocket.readyState === 1) {
          senseSocket.send(
            JSON.stringify({
              type: "command",
              title: m.title,
              cmd: m.cmd,
              steps: m.steps || "",
            }),
          );
          jsonReply(res, { ok: true });
        } else {
          jsonReply(res, { ok: false, error: "sense not connected" });
        }
      } catch (e) {
        jsonReply(res, { error: "bad json" }, 400);
      }
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/brain/messages") {
    const msgs = global.userMessages || [];
    const clear = url.searchParams.get("clear") !== "false";
    if (clear) global.userMessages = [];
    jsonReply(res, { ok: true, count: msgs.length, messages: msgs });
    return;
  }
  if (req.method === "POST" && url.pathname === "/brain/exec") {
    readBody(req, function (body) {
      try {
        const m = JSON.parse(body);
        execOnAgent(m.cmd, m.timeout || 30000, m.hostname)
          .then(function (r) {
            commandHistory.push({
              cmd: m.cmd,
              output: r.output,
              ok: r.ok,
              ms: r.ms,
              time: new Date().toISOString(),
            });
            if (commandHistory.length > MAX_HISTORY)
              commandHistory = commandHistory.slice(-MAX_HISTORY);
            forwardTerminal(null, m.cmd, r.output, r.ok);
            jsonReply(res, { ok: r.ok, output: r.output, ms: r.ms });
          })
          .catch(function (e) {
            jsonReply(res, { ok: false, error: e.message });
          });
      } catch (e) {
        jsonReply(res, { error: "bad json" }, 400);
      }
    });
    return;
  }
  // ── 万法归宗: Relay桥接 ──
  if (req.method === "GET" && url.pathname === "/brain/relay") {
    bridge.findRelay(true).then(function (relayUrl) {
      if (relayUrl) {
        bridge
          .getAgents()
          .then(function (data) {
            jsonReply(res, {
              ok: true,
              relay: relayUrl,
              agents: data.agents || [],
            });
          })
          .catch(function (e) {
            jsonReply(res, {
              ok: true,
              relay: relayUrl,
              agents: [],
              error: e.message,
            });
          });
      } else {
        jsonReply(res, { ok: false, relay: null, agents: [] });
      }
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/brain/guardian") {
    readBody(req, function (body) {
      try {
        const m = JSON.parse(body);
        const hostname =
          m.hostname || (getDefaultAgent() || {}).hostname || "unknown";
        const action = m.action || "diagnose";
        bridge
          .runGuardianViaRelay(hostname, action)
          .then(function (r) {
            jsonReply(res, {
              ok: !r.error,
              hostname: hostname,
              action: action,
              output: r.stdout || r.error,
            });
          })
          .catch(function (e) {
            jsonReply(res, { ok: false, error: e.message });
          });
      } catch (e) {
        jsonReply(res, { error: "bad json" }, 400);
      }
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/brain/sysinfo") {
    readBody(req, function (body) {
      try {
        var m = JSON.parse(body);
        var targetH = m.hostname;
        var targetWs = null;
        if (targetH && agentSockets.has(targetH)) {
          targetWs = agentSockets.get(targetH);
        } else {
          var d = getDefaultAgent();
          if (d) {
            targetWs = d.ws;
            targetH = d.hostname;
          }
        }
        if (targetWs && targetWs.readyState === 1) {
          targetWs.send(JSON.stringify({ type: "get_sysinfo" }));
          var w = 0;
          var ck = setInterval(function () {
            w += 500;
            var ad = agentDataMap.get(targetH) || {};
            if (
              ad.sysinfo &&
              ad.lastUpdate &&
              Date.now() - new Date(ad.lastUpdate).getTime() < 15000
            ) {
              clearInterval(ck);
              jsonReply(res, { ok: true, hostname: targetH, data: ad.sysinfo });
            } else if (w > 10000) {
              clearInterval(ck);
              jsonReply(res, { ok: false, error: "timeout" });
            }
          }, 500);
        } else {
          jsonReply(res, { ok: false, error: "agent not connected" });
        }
      } catch (e) {
        jsonReply(res, { error: "bad json" }, 400);
      }
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/brain/auto") {
    if (agentSockets.size === 0) {
      jsonReply(res, { ok: false, error: "agent not connected" });
      return;
    }
    const diagSteps = [
      { name: "hostname", cmd: "hostname" },
      {
        name: "user",
        cmd: '$env:USERNAME + " | Admin=" + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
      },
      {
        name: "os",
        cmd: '(Get-CimInstance Win32_OperatingSystem).Caption + " " + (Get-CimInstance Win32_OperatingSystem).Version',
      },
      {
        name: "uptime",
        cmd: '[math]::Round((New-TimeSpan -Start (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalHours, 1).ToString() + " hours"',
      },
      {
        name: "cpu_mem",
        cmd: '$c=(Get-CimInstance Win32_Processor|Select -First 1).Name; $o=Get-CimInstance Win32_OperatingSystem; "$c | RAM: $([math]::Round($o.TotalVisibleMemorySize/1MB,1))GB (free $([math]::Round($o.FreePhysicalMemory/1MB,1))GB)"',
      },
      {
        name: "disk",
        cmd: 'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { "$($_.DeviceID) $([math]::Round($_.FreeSpace/1GB,1))/$([math]::Round($_.Size/1GB,1))GB" }',
      },
      {
        name: "network_adapters",
        cmd: 'Get-NetAdapter | Where Status -eq Up | ForEach-Object { "$($_.Name): $($_.InterfaceDescription) ($($_.LinkSpeed))" }',
      },
      {
        name: "dns_config",
        cmd: "Get-DnsClientServerAddress -AddressFamily IPv4 | Where ServerAddresses | ForEach-Object { \"$($_.InterfaceAlias): $($_.ServerAddresses -join ',')\" }",
      },
      { name: "proxy_check", cmd: "netsh winhttp show proxy" },
      {
        name: "env_proxy",
        cmd: '"HTTP_PROXY=" + $env:HTTP_PROXY + " | HTTPS_PROXY=" + $env:HTTPS_PROXY + " | ALL_PROXY=" + $env:ALL_PROXY',
      },
      {
        name: "hosts_windsurf",
        cmd: '$h=Get-Content "$env:SystemRoot\\System32\\drivers\\etc\\hosts" -EA SilentlyContinue | Where-Object {$_ -match "windsurf|codeium"}; if($h){$h}else{"(clean)"}',
      },
      {
        name: "dns_windsurf",
        cmd: 'Resolve-DnsName windsurf.com -Type A -EA SilentlyContinue | Select -First 1 | ForEach-Object { "$($_.Name) -> $($_.IPAddress)" }',
      },
      {
        name: "dns_github",
        cmd: 'Resolve-DnsName github.com -Type A -EA SilentlyContinue | Select -First 1 | ForEach-Object { "$($_.Name) -> $($_.IPAddress)" }',
      },
      {
        name: "ping_windsurf",
        cmd: 'Test-NetConnection windsurf.com -Port 443 -WarningAction SilentlyContinue | ForEach-Object { "TCP443=$($_.TcpTestSucceeded) latency=$($_.PingReplyDetails.RoundtripTime)ms" }',
      },
      {
        name: "windsurf_process",
        cmd: 'Get-Process Windsurf -EA SilentlyContinue | ForEach-Object { "PID=$($_.Id) Mem=$([math]::Round($_.WorkingSet64/1MB))MB CPU=$([math]::Round($_.CPU,1))s" }; if(-not (Get-Process Windsurf -EA SilentlyContinue)){"(not running)"}',
      },
      {
        name: "windsurf_path",
        cmd: '$searchPaths=@("$env:LOCALAPPDATA\\Programs\\Windsurf","$env:ProgramFiles\\Windsurf","${env:ProgramFiles(x86)}\\Windsurf"); foreach($sp in (Get-PSDrive -PSProvider FileSystem -EA SilentlyContinue)){$rp=$sp.Root+"Windsurf"; if($searchPaths -notcontains $rp){$searchPaths+=$rp}}; $found=$null; foreach($p in $searchPaths){$f=Get-ChildItem $p -Filter "Windsurf.exe" -Recurse -EA SilentlyContinue|Select -First 1; if($f){$found=$f.FullName;break}}; if($found){$found}else{"(not found)"}',
      },
      {
        name: "firewall_windsurf",
        cmd: 'Get-NetFirewallRule -DisplayName "*Windsurf*","*Codeium*" -EA SilentlyContinue | Select DisplayName,Direction,Action | Format-Table -AutoSize | Out-String; if(-not (Get-NetFirewallRule -DisplayName "*Windsurf*","*Codeium*" -EA SilentlyContinue)){"(no rules)"}',
      },
    ];
    (async function () {
      const results = [];
      notifySense("say", {
        level: "system",
        text: "<b>自动诊断启动</b> — " + diagSteps.length + " 项检查...",
      });
      for (let i = 0; i < diagSteps.length; i++) {
        const step = diagSteps[i];
        try {
          const r = await execOnAgent(step.cmd, 15000);
          results.push({
            name: step.name,
            ok: r.ok,
            output: (r.output || "").trim(),
            ms: r.ms,
          });
          console.log(
            "[auto] " + (i + 1) + "/" + diagSteps.length,
            step.name,
            "->",
            (r.output || "").substring(0, 60).replace(/\n/g, " "),
          );
        } catch (e) {
          results.push({
            name: step.name,
            ok: false,
            output: e.message,
            ms: 0,
          });
        }
      }
      const analysis = analyzeAutoResults(results);
      notifySense("say", { level: analysis.level, text: analysis.summary });
      if (analysis.fixes.length > 0) {
        notifySense("say", {
          level: "system",
          text:
            "<b>建议修复:</b><br>" +
            analysis.fixes
              .map(function (f, i) {
                return i + 1 + ". " + f;
              })
              .join("<br>"),
        });
      }
      jsonReply(res, { ok: true, results: results, analysis: analysis });
    })();
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

// ==================== WEBSOCKET ====================
const wss = new WebSocketServer({ server });
wss.on("error", function () {}); // HTTP server error already handled — prevent WSS re-emit crash

wss.on("connection", function (ws, req) {
  const path = req.url || "";

  // ---- SENSE (Browser) ---- 安全通道验证
  if (path.startsWith("/ws/sense")) {
    if (!checkToken(req)) {
      console.log(
        "[sense] rejected (bad token) from:",
        req.socket.remoteAddress,
      );
      ws.close(4001, "unauthorized");
      return;
    }
    console.log("[sense] connected");
    senseSocket = ws;
    senseData.connected = true;
    senseData.lastUpdate = new Date().toISOString();
    while (messageQueue.length > 0) {
      const m = messageQueue.shift();
      ws.send(
        JSON.stringify({
          type: "say",
          level: m.level || "system",
          text: m.text,
        }),
      );
    }
    var defAd = getDefaultAgentData();
    notifySense("agent_status", {
      connected: agentSockets.size > 0,
      hostname: defAd.hostname,
      user: defAd.user,
      os: defAd.os,
      isAdmin: defAd.isAdmin,
      agents: getAgentList(),
    });

    ws.on("message", function (data) {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "hello") {
          senseData.ua = msg.ua;
          senseData.lastUpdate = new Date().toISOString();
          console.log("[sense] ua:", (msg.ua || "").substring(0, 50));
        }
        if (msg.type === "test_result") {
          console.log("[sense]", msg.name, msg.status, msg.detail || "");
        }
        if (msg.type === "diagnostics_complete") {
          console.log("[sense] diag complete:", msg.results.length);
          senseData.diagnostics = msg.results;
          senseData.lastUpdate = new Date().toISOString();
          const a = analyzeDiagnostics(msg.results);
          console.log("[brain]", a.level, a.summary.replace(/<[^>]*>/g, ""));
          ws.send(
            JSON.stringify({ type: "say", level: a.level, text: a.summary }),
          );
          if (a.fixCmd) {
            ws.send(
              JSON.stringify({
                type: "command",
                title: "定制修复方案",
                cmd: a.fixCmd,
                steps:
                  "<b>1.</b> 右键开始→终端(管理员)<br><b>2.</b> 复制命令<br><b>3.</b> 粘贴→回车<br><b>4.</b> 重启电脑",
              }),
            );
          }
        }
        if (msg.type === "user_message") {
          console.log("[sense] USER MSG:", msg.text);
          if (!global.userMessages) global.userMessages = [];
          global.userMessages.push({
            text: msg.text,
            time: msg.time || new Date().toISOString(),
          });
          ws.send(
            JSON.stringify({
              type: "say",
              level: "system",
              text: "<b>大脑已收到</b> — 消息已记录，等待处理。",
            }),
          );
        }
        if (msg.type === "user_exec") {
          var defA = getDefaultAgent();
          if (defA) {
            const id = crypto.randomUUID();
            pendingCommands.set(id, {
              resolve: function (r) {
                forwardTerminal(id, msg.cmd, r.output, r.ok);
                commandHistory.push({
                  cmd: msg.cmd,
                  output: r.output,
                  ok: r.ok,
                  ms: r.ms,
                  time: new Date().toISOString(),
                });
                if (commandHistory.length > MAX_HISTORY)
                  commandHistory = commandHistory.slice(-MAX_HISTORY);
              },
              reject: function () {
                forwardTerminal(id, msg.cmd, "Timeout", false);
              },
              timer: setTimeout(function () {
                var p = pendingCommands.get(id);
                if (p) {
                  pendingCommands.delete(id);
                  p.reject(new Error("timeout"));
                }
              }, 60000),
              cmd: msg.cmd,
            });
            defA.ws.send(
              JSON.stringify({ type: "exec", id: id, cmd: msg.cmd }),
            );
          } else {
            ws.send(
              JSON.stringify({
                type: "terminal",
                cmd: msg.cmd,
                output: "Error: Agent未连接",
                ok: false,
              }),
            );
          }
        }
        if (msg.type === "request_sysinfo") {
          agentSockets.forEach(function (aw) {
            if (aw.readyState === 1)
              aw.send(JSON.stringify({ type: "get_sysinfo" }));
          });
        }
        // 投屏链路: 转发截屏启停命令到Agent
        if (
          msg.type === "start_screen_capture" ||
          msg.type === "stop_screen_capture"
        ) {
          agentSockets.forEach(function (aw) {
            if (aw.readyState === 1)
              aw.send(
                JSON.stringify({ type: msg.type, interval: msg.interval }),
              );
          });
        }
      } catch (e) {
        console.error("[sense] err:", e.message);
      }
    });
    ws.on("close", function () {
      console.log("[sense] disconnected");
      senseSocket = null;
      senseData.connected = false;
    });
    return;
  }

  // ---- SCREEN (Browser live view) ---- 投屏实时通道
  if (path.startsWith("/ws/screen")) {
    if (!checkToken(req)) {
      ws.close(4001, "unauthorized");
      return;
    }
    console.log("[screen-ws] viewer connected");
    _screenClients.add(ws);
    // 告知当前投屏源状态
    var sources = {};
    _screenSources.forEach(function (v, k) {
      sources[k] = v;
    });
    ws.send(
      JSON.stringify({
        type: "screen_sources",
        sources: sources,
        best: getBestScreenSource(),
      }),
    );
    ws.on("message", function (data) {
      try {
        var msg = JSON.parse(data);
        // 万法归宗: 浏览器请求截屏 → 按优先级遍历一切投屏源 → 广播给所有viewer
        if (msg.type === "request_capture") {
          captureScreenBest(msg.hostname, msg.serial)
            .then(function (r) {
              var frame = JSON.stringify({
                type: "screen_frame",
                image: r.image,
                time: Date.now(),
                source: r.source || "agent",
                width: r.width,
                height: r.height,
              });
              _screenClients.forEach(function (c) {
                if (c.readyState === 1) c.send(frame);
              });
            })
            .catch(function (e) {
              ws.send(
                JSON.stringify({ type: "screen_error", error: e.message }),
              );
            });
        }
        // 浏览器发送输入 → 转发到Agent或InputRoutes
        if (msg.type === "screen_input") {
          sendInputToDevice(msg.action, msg.params || {}, msg.serial)
            .then(function (r) {
              // 万法之资: 标注实际使用的输入源
              var via = "direct";
              var gs = _screenSources.get("ghost");
              var ds = _screenSources.get("dao");
              var ah = _screenSources.get("adb_hub");
              if (gs && gs.status === "online") via = "ghost_shell";
              else if (
                (
                  _screenSources.get("input") ||
                  _screenSources.get("mjpeg") ||
                  {}
                ).status === "online"
              )
                via = "input_routes";
              else if (ah && ah.status === "online") via = "adb_hub";
              else if (ds && ds.status === "online") via = "dao-remote";
              else via = "scrcpy";
              ws.send(
                JSON.stringify({
                  type: "input_result",
                  ok: true,
                  action: msg.action,
                  via: via,
                }),
              );
            })
            .catch(function (e) {
              // 万法之资: ADB兜底 — 适配一切, 无InputRoutes也能控制
              var adbCmd = adbFallbackCmd(msg.action, msg.params || {});
              if (adbCmd) {
                execOnAgent(adbCmd, 5000, msg.hostname)
                  .then(function () {
                    ws.send(
                      JSON.stringify({
                        type: "input_result",
                        ok: true,
                        action: msg.action,
                        via: "adb",
                      }),
                    );
                  })
                  .catch(function () {});
              }
            });
        }
      } catch (e) {}
    });
    ws.on("close", function () {
      _screenClients.delete(ws);
      console.log(
        "[screen-ws] viewer disconnected [" +
          _screenClients.size +
          " remaining]",
      );
    });
    return;
  }

  // ---- WebRTC Signaling (P2P upgrade) ---- 柔弱胜刚强: WS relay → WebRTC 直连
  // 仿 MeshCentral 架构: 先建 WS 通道, 交换 SDP/ICE, 成功后浏览器↔源 P2P 直连
  // 失败则 WS 通道继续工作 (优雅退化, 不如 RustDesk 的 Rust relay 快, 但零依赖)
  if (path.startsWith("/ws/rtc")) {
    if (!checkToken(req)) {
      ws.close(4001, "unauthorized");
      return;
    }
    // 从 query 取 role: "offer" (browser) 或 "answer" (screen source / ghost_shell)
    var rtcRole = "offer";
    try {
      var rtcUrl = new URL(req.url, "http://localhost");
      rtcRole = rtcUrl.searchParams.get("role") || "offer";
    } catch (e) {}
    console.log(
      "[rtc] " + rtcRole + " connected from " + req.socket.remoteAddress,
    );

    if (rtcRole === "answer") {
      // Screen source (ghost_shell / Android) 注册为 answerer
      _rtcAnswerers.add(ws);
      ws.on("close", function () {
        _rtcAnswerers.delete(ws);
        console.log(
          "[rtc] answerer disconnected [" + _rtcAnswerers.size + " remaining]",
        );
      });
    } else {
      // Browser 注册为 offerer
      _rtcOfferers.add(ws);
      ws.on("close", function () {
        _rtcOfferers.delete(ws);
        console.log(
          "[rtc] offerer disconnected [" + _rtcOfferers.size + " remaining]",
        );
      });
    }

    ws.on("message", function (data) {
      try {
        var msg = JSON.parse(data);
        // 转发 SDP offer/answer 和 ICE candidates
        if (msg.type === "offer" || msg.type === "ice-candidate") {
          // browser → all answerers (screen sources)
          _rtcAnswerers.forEach(function (a) {
            if (a.readyState === 1 && a !== ws) a.send(data.toString());
          });
        } else if (
          msg.type === "answer" ||
          msg.type === "ice-candidate-answer"
        ) {
          // screen source → all offerers (browsers)
          _rtcOfferers.forEach(function (o) {
            if (o.readyState === 1 && o !== ws) o.send(data.toString());
          });
        }
      } catch (e) {}
    });
    return;
  }

  // ---- AGENT (PowerShell) ---- 安全通道 + 多Agent
  if (path.startsWith("/ws/agent")) {
    if (!checkToken(req)) {
      console.log(
        "[agent] rejected (bad token) from:",
        req.socket.remoteAddress,
      );
      ws.close(4001, "unauthorized");
      return;
    }
    console.log("[agent] connected from:", req.socket.remoteAddress);
    var agentHostname = null;
    setTimeout(function () {
      if (ws.readyState === 1) ws.send('{"type":"get_sysinfo"}');
    }, 2000);

    ws.on("message", function (data) {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "hello") {
          const si = msg.sysinfo || {};
          agentHostname = si.hostname || "agent-" + req.socket.remoteAddress;
          // 注册到多Agent Map — 同hostname自动替换旧连接
          var oldWs = agentSockets.get(agentHostname);
          if (oldWs && oldWs !== ws && oldWs.readyState === 1) {
            console.log(
              "[agent] " + agentHostname + " reconnected, closing old",
            );
            oldWs.close(4000, "replaced");
          }
          agentSockets.set(agentHostname, ws);
          var ad = agentDataMap.get(agentHostname) || {};
          ad.hostname = si.hostname;
          ad.user = si.user;
          ad.os = si.os;
          ad.isAdmin = si.isAdmin;
          ad.lastUpdate = new Date().toISOString();
          if (ad.pingTimer) clearInterval(ad.pingTimer);
          ad.pingTimer = setInterval(function () {
            if (ws.readyState === 1) ws.send('{"type":"ping"}');
          }, 30000);
          agentDataMap.set(agentHostname, ad);
          console.log(
            "[agent]",
            si.hostname,
            si.user,
            "admin=" + si.isAdmin,
            "[" + agentSockets.size + " online]",
          );
          notifySense("agent_status", {
            connected: true,
            hostname: si.hostname,
            user: si.user,
            os: si.os,
            isAdmin: si.isAdmin,
            agents: getAgentList(),
          });
          notifySense("say", {
            level: "alert-ok",
            text:
              "<b>Agent已连接</b> — " +
              (si.hostname || "?") +
              " / " +
              (si.user || "?") +
              (si.isAdmin ? " (管理员)" : "") +
              " [" +
              agentSockets.size +
              "台在线]",
          });
          startHostsGuard();
        }
        if (msg.type === "cmd_result") {
          const p = pendingCommands.get(msg.id);
          if (p) {
            clearTimeout(p.timer);
            pendingCommands.delete(msg.id);
            p.resolve({ ok: msg.ok, output: msg.output, ms: msg.ms });
          }
          console.log(
            "[agent] result:",
            msg.ok ? "OK" : "FAIL",
            (msg.output || "").substring(0, 80),
          );
        }
        if (msg.type === "sysinfo") {
          if (agentHostname) {
            var ad = agentDataMap.get(agentHostname) || {};
            ad.sysinfo = msg;
            ad.lastUpdate = new Date().toISOString();
            agentDataMap.set(agentHostname, ad);
          }
          console.log("[agent] sysinfo from " + agentHostname);
          notifySense("sysinfo", msg);
        }
        if (msg.type === "pong") {
          if (agentHostname) {
            var ad = agentDataMap.get(agentHostname) || {};
            ad.lastPong = new Date().toISOString();
            agentDataMap.set(agentHostname, ad);
          }
        }
        // 投屏链路: Agent推送屏幕帧 → 广播给所有screen viewer
        if (msg.type === "screen_frame") {
          var frame = JSON.stringify({
            type: "screen_frame",
            image: msg.image,
            time: Date.now(),
            source: agentHostname || "agent",
            width: msg.width,
            height: msg.height,
          });
          _screenClients.forEach(function (c) {
            if (c.readyState === 1) c.send(frame);
          });
        }
      } catch (e) {
        console.error("[agent] err:", e.message);
      }
    });
    ws.on("close", function () {
      console.log("[agent] disconnected: " + agentHostname);
      if (agentHostname) {
        // 道法自然: 仅当Map中存的是本socket时才删除 — 防止新连接被旧close覆盖
        if (agentSockets.get(agentHostname) === ws) {
          agentSockets.delete(agentHostname);
          var ad = agentDataMap.get(agentHostname) || {};
          if (ad.pingTimer) {
            clearInterval(ad.pingTimer);
            ad.pingTimer = null;
          }
        }
      }
      if (agentSockets.size === 0) stopHostsGuard();
      notifySense("agent_status", {
        connected: agentSockets.size > 0,
        agents: getAgentList(),
      });
      if (
        agentSockets.size === 0 ||
        !agentHostname ||
        !agentSockets.has(agentHostname)
      ) {
        notifySense("say", {
          level: "alert-warn",
          text:
            "<b>Agent已断开</b> — " +
            (agentHostname || "?") +
            " [" +
            agentSockets.size +
            "台在线]",
        });
      }
    });
    return;
  }
});

// ==================== START ====================
function setPublicUrl(url) {
  _publicUrl = url;
  console.log("[dao] PUBLIC_URL updated: " + url);
}

function start(port, _retryCount) {
  port = port || PORT;
  _retryCount = _retryCount || 0;
  server.on("error", function (err) {
    if (err.code === "EADDRINUSE") {
      server.removeAllListeners("error");
      if (_retryCount < 5) {
        var nextPort = port + 1;
        console.log(
          "[hub] Port " + port + " occupied, trying " + nextPort + "...",
        );
        start(nextPort, _retryCount + 1);
      } else {
        console.error(
          "[hub] All ports " + (port - 5) + "-" + port + " occupied!",
        );
        console.error("[hub] Use PORT=<free_port> node dao.js");
      }
    } else {
      console.error("[hub] Server error:", err.message);
    }
  });
  server.listen(port, "0.0.0.0", function () {
    // 道法自然: 实际绑定端口回写回模块 — EADDRINUSE 重试后配对/发现端点能拿到正确值
    _listenPort = port;
    var proto = httpProto();
    var tokenQ = MASTER_TOKEN ? "?token=" + MASTER_TOKEN : "";
    var lanIPs = getAllLanIPs();
    console.log("\n===== 道 · 远程中枢 [Ed25519端到端] v8.0 =====");
    if (_daoFingerprint) console.log("身份:  " + _daoFingerprint);
    var primaryHost = lanIPs[0] || "127.0.0.1";
    console.log("五感:  http://" + primaryHost + ":" + port);
    if (_publicUrl) {
      console.log(
        "Agent: irm " + proto + "://" + _publicUrl + "/go" + tokenQ + " | iex",
      );
    }
    var shownHost = (_publicUrl || "").replace(/:.*/, "");
    for (var li = 0; li < lanIPs.length; li++) {
      if (lanIPs[li] !== shownHost) {
        console.log(
          "       irm http://" +
            lanIPs[li] +
            ":" +
            port +
            "/go" +
            tokenQ +
            " | iex",
        );
      }
    }
    console.log("大脑:  http://" + primaryHost + ":" + port + "/brain/state");
    console.log("状态:  http://" + primaryHost + ":" + port + "/status");
    console.log("配对:  http://" + primaryHost + ":" + port + "/pair (QR)");
    console.log("发现:  http://" + primaryHost + ":" + port + "/dao/discover");
    console.log("Relay: http://" + primaryHost + ":" + port + "/relay/");
    if (_publicUrl) console.log("外网:  " + proto + "://" + _publicUrl);
    if (_daoBestInput) console.log("输入:  " + _daoBestInput);
    if (_daoBestCodec) console.log("编码:  " + _daoBestCodec);
    if (_remoteTools.length > 0) {
      console.log(
        "工具:  " +
          _remoteTools
            .map(function (t) {
              return t.name + (t.running ? "(运行中)" : "");
            })
            .join(", "),
      );
    }
    console.log("工具:  http://" + primaryHost + ":" + port + "/tools");
    console.log("文件:  http://" + primaryHost + ":" + port + "/files");
    console.log(
      "剪贴板: http://" + primaryHost + ":" + port + "/dao/clipboard",
    );
    console.log("WebRTC: ws://" + primaryHost + ":" + port + "/ws/rtc");
    console.log("道法:  软编码一切 · URL请求自知 · 唯变所适");
    console.log("=============================================\n");
    bridge.findRelay().then(function (url) {
      if (url) console.log("[bridge] PS Agent Relay: " + url);
      else
        console.log(
          "[bridge] PS Agent Relay: not found (will retry on demand)",
        );
    });
    // 道生一: 投屏链路自动发现
    discoverScreenSources().then(function (found) {
      if (found.length > 0) {
        console.log("[screen] 投屏链路在线: " + found.join(", "));
        _screenSources.forEach(function (v, k) {
          if (v.status === "online") console.log("  " + k + ": " + v.url);
        });
      } else {
        console.log("[screen] 无投屏服务在线 (Agent截屏仍可用)");
      }
    });
    // 定期重探: 反者道之动 — 服务可能随时上下线, 广播给所有viewer
    setInterval(function () {
      discoverScreenSources().then(function () {
        if (_screenClients.size > 0) {
          var sources = {};
          _screenSources.forEach(function (v, k) {
            sources[k] = v;
          });
          var msg = JSON.stringify({
            type: "screen_sources",
            sources: sources,
            best: getBestScreenSource(),
          });
          _screenClients.forEach(function (c) {
            if (c.readyState === 1) c.send(msg);
          });
        }
      });
    }, 30000);
  });
}

// Direct run: node server.js
if (require.main === module) {
  start();
}

module.exports = { start: start, setPublicUrl: setPublicUrl };
