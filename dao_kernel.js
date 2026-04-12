// ╔══════════════════════════════════════════════════════════════╗
// ║  道核 · Dao Kernel v1.0 — 万物皆动 · 万物皆柔              ║
// ║                                                              ║
// ║  道可道，非常道。名可名，非常名。                              ║
// ║  无，名天地之始；有，名万物之母。                              ║
// ║                                                              ║
// ║  Core Principle: NOTHING is fixed. EVERYTHING emerges.       ║
// ║  Every port, token, key, room, URL — derived from entropy.   ║
// ║  No configuration files. No hard-coded constants.            ║
// ║                                                              ║
// ║  Architecture:                                               ║
// ║    无极 (Wuji)    → DaoEntropy    : 密码学熵源                ║
// ║    太极 (Taiji)   → DaoIdentity   : 每设备密钥对              ║
// ║    两仪 (Liangyi) → DaoDiscovery  : 网络/ADB/隧道发现        ║
// ║    四象 (Sixiang) → DaoCapability : 运行时能力检测            ║
// ║    八卦 (Bagua)   → DaoSession    : 每连接独立鉴权            ║
// ║    万物 (Wanwu)   → DaoKernel     : 统一内核                 ║
// ╚══════════════════════════════════════════════════════════════╝

const crypto = require("crypto");
const os = require("os");
const fs = require("fs");
const path = require("path");
const net = require("net");
const { execSync } = require("child_process");

const IS_WIN = process.platform === "win32";

function _ts() {
  return new Date().toTimeString().slice(0, 8);
}
function _log(msg) {
  console.log("[" + _ts() + "] " + msg);
}
function _sh(cmd, timeout) {
  try {
    return execSync(cmd, {
      timeout: timeout || 8000,
      windowsHide: true,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    return "";
  }
}

// ═══════════════════════════════════════════════════════════════
//  无极 · Wuji · Entropy — 万物之源，一切值从混沌中生
// ═══════════════════════════════════════════════════════════════

class DaoEntropy {
  static bytes(n) {
    return crypto.randomBytes(n || 32);
  }
  static hex(n) {
    return crypto.randomBytes(n || 16).toString("hex");
  }
  static base64url(n) {
    return crypto.randomBytes(n || 24).toString("base64url");
  }
  static pin(digits) {
    digits = digits || 6;
    var max = Math.pow(10, digits);
    var val = crypto.randomInt(max);
    return String(val).padStart(digits, "0");
  }
  static room() {
    return crypto.randomBytes(3).toString("hex");
  }
  static sessionId() {
    return crypto.randomBytes(16).toString("hex");
  }
  static port() {
    return new Promise(function (resolve, reject) {
      var srv = net.createServer();
      srv.listen(0, "127.0.0.1", function () {
        var port = srv.address().port;
        srv.close(function () {
          resolve(port);
        });
      });
      srv.on("error", reject);
    });
  }
  static tryPort(preferred) {
    // 道法自然: 尝试指定端口, 可用则返回, 否则返回0
    try {
      var srv = net.createServer();
      srv.listen(preferred, "127.0.0.1");
      var addr = srv.address();
      if (addr && addr.port === preferred) {
        srv.close();
        return preferred;
      }
      srv.close();
    } catch (e) {}
    return 0;
  }
  static portSync() {
    // 道法自然: 同步分配 — 绑定0号端口让OS选择，立即释放
    var srv = net.createServer();
    try {
      srv.listen(0, "127.0.0.1");
      var addr = srv.address();
      if (addr && addr.port) {
        var port = addr.port;
        srv.close();
        return port;
      }
    } catch (e) {}
    // Node.js v22+: listen() fully async — fallback to ephemeral range
    try {
      srv.close();
    } catch (e) {}
    return 49152 + Math.floor(Math.random() * 16000);
  }
}

// ═══════════════════════════════════════════════════════════════
//  太极 · Taiji · Identity — 每设备唯一密钥对，替代密码/PIN
// ═══════════════════════════════════════════════════════════════

class DaoIdentity {
  constructor(identityDir) {
    this._dir = identityDir || path.join(os.homedir(), ".dao-remote");
    this._keyFile = path.join(this._dir, "identity.json");
    this.fingerprint = "";
    this._seed = null;
    this._pub = null;
    this._loadOrGenerate();
  }

  _loadOrGenerate() {
    try {
      fs.mkdirSync(this._dir, { recursive: true });
    } catch (e) {}
    if (fs.existsSync(this._keyFile)) {
      try {
        var data = JSON.parse(fs.readFileSync(this._keyFile, "utf-8"));
        this._seed = Buffer.from(data.seed, "hex");
        this._pub = Buffer.from(data.public, "hex");
        this.fingerprint = data.fingerprint;
        return;
      } catch (e) {}
    }
    // Generate new identity from entropy
    this._seed = DaoEntropy.bytes(32);
    this._pub = crypto
      .createHash("sha256")
      .update(Buffer.concat([Buffer.from("dao-pub-v1:"), this._seed]))
      .digest();
    this.fingerprint = crypto
      .createHash("sha256")
      .update(this._pub)
      .digest("hex")
      .slice(0, 16);
    var payload = JSON.stringify(
      {
        seed: this._seed.toString("hex"),
        public: this._pub.toString("hex"),
        fingerprint: this.fingerprint,
        created: new Date().toISOString(),
        platform: process.platform,
        hostname: os.hostname(),
      },
      null,
      2,
    );
    fs.writeFileSync(this._keyFile, payload, "utf-8");
    _log("[太极] 新身份已生成: " + this.fingerprint);
  }

  sign(data) {
    return crypto.createHmac("sha256", this._seed).update(data).digest();
  }

  createToken(ttl, meta) {
    ttl = ttl || 3600;
    var payload = JSON.stringify(
      Object.assign(
        {
          fp: this.fingerprint,
          exp: Math.floor(Date.now() / 1000) + ttl,
          nonce: DaoEntropy.hex(8),
        },
        meta || {},
      ),
    );
    var payloadBuf = Buffer.from(payload, "utf-8");
    var sig = this.sign(payloadBuf).toString("hex").slice(0, 32);
    return payloadBuf.toString("hex") + "." + sig;
  }

  verifyToken(token) {
    try {
      var parts = token.split(".", 2);
      var payloadBuf = Buffer.from(parts[0], "hex");
      var expectedSig = this.sign(payloadBuf).toString("hex").slice(0, 32);
      if (
        !crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expectedSig))
      ) {
        return null;
      }
      var data = JSON.parse(payloadBuf.toString("utf-8"));
      if ((data.exp || 0) < Date.now() / 1000) return null;
      return data;
    } catch (e) {
      return null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  两仪 · Liangyi · Discovery — 探测一切，假设为零
// ═══════════════════════════════════════════════════════════════

class DaoDiscovery {
  constructor() {
    this.localIPs = [];
    this.hostname = os.hostname();
    this.tunnels = [];
    this.adbPath = "";
    this.adbDevices = [];
  }

  probeAll() {
    this._probeNetwork();
    this._probeTunnels();
    this._probeAdb();
    return {
      network: { ips: this.localIPs, hostname: this.hostname },
      tunnels: this.tunnels,
      adb: { path: this.adbPath, devices: this.adbDevices },
    };
  }

  _probeNetwork() {
    var ips = [];
    var nets = os.networkInterfaces();
    for (var name of Object.keys(nets)) {
      for (var iface of nets[name]) {
        if (iface.family === "IPv4" && !iface.internal) {
          ips.push(iface.address);
        }
      }
    }
    // 道法自然: 按可达性排序 — 真实LAN优先
    ips.sort(function (a, b) {
      return DaoDiscovery._ipScore(a) - DaoDiscovery._ipScore(b);
    });

    // 道法自然: 尝试路由表获取最佳出口IP (Windows)
    if (IS_WIN) {
      try {
        var out = _sh("route print 0.0.0.0", 3000);
        var lines = out.split("\n");
        for (var i = 0; i < lines.length; i++) {
          var parts = lines[i].trim().split(/\s+/);
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
              // 把路由表出口IP提到最前
              ips = ips.filter(function (ip) {
                return ip !== ifaceIP;
              });
              ips.unshift(ifaceIP);
              break;
            }
          }
        }
      } catch (e) {}
    }
    this.localIPs = ips;
  }

  static _ipScore(ip) {
    if (/^192\.168\./.test(ip)) return 0;
    if (/^10\./.test(ip)) return 2;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 3;
    return 1;
  }

  _probeTunnels() {
    var found = [];
    var names = ["cloudflared", "tailscale", "ngrok"];
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var exe = IS_WIN ? name + ".exe" : name;
      // which/where
      var whichCmd = IS_WIN ? "where " + exe + " 2>nul" : "which " + name;
      var result = _sh(whichCmd, 3000);
      if (result) {
        found.push(result.split("\n")[0].trim());
        continue;
      }
      // Check local directory
      var local = path.join(__dirname, exe);
      try {
        if (fs.existsSync(local) && fs.statSync(local).size > 100000) {
          found.push(local);
        }
      } catch (e) {}
    }
    this.tunnels = found;
  }

  _probeAdb() {
    var candidates = [];
    // which/where
    var whichCmd = IS_WIN ? "where adb.exe 2>nul" : "which adb";
    var result = _sh(whichCmd, 3000);
    if (result) candidates.push(result.split("\n")[0].trim());
    if (IS_WIN) {
      var sdk = path.join(
        process.env.LOCALAPPDATA || "",
        "Android",
        "Sdk",
        "platform-tools",
        "adb.exe",
      );
      candidates.push(sdk);
      candidates.push("C:\\platform-tools\\adb.exe");
      // 无界趣连 bundled ADB
      var ldPaths = [
        "D:\\leidian\\remote",
        "C:\\leidian\\remote",
        path.join(process.env.LOCALAPPDATA || "", "leidian", "remote"),
      ];
      for (var lp of ldPaths) {
        var ldAdb = path.join(lp, "adb.exe");
        try {
          if (fs.existsSync(ldAdb)) candidates.push(ldAdb);
        } catch (e) {}
      }
    }
    for (var c of candidates) {
      if (!c) continue;
      try {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) {
          this.adbPath = c;
          break;
        }
      } catch (e) {}
    }
    if (this.adbPath) {
      try {
        var out = _sh('"' + this.adbPath + '" devices', 5000);
        var lines = out.split("\n").slice(1);
        var seen = new Set(this.adbDevices);
        for (var line of lines) {
          var parts = line.trim().split("\t");
          if (
            parts.length === 2 &&
            parts[1] === "device" &&
            !seen.has(parts[0])
          ) {
            this.adbDevices.push(parts[0]);
            seen.add(parts[0]);
          }
        }
      } catch (e) {}
    }
  }

  findBinary(names, searchDirs) {
    for (var name of names) {
      var whichCmd = IS_WIN ? "where " + name + " 2>nul" : "which " + name;
      var result = _sh(whichCmd, 3000);
      if (result) return result.split("\n")[0].trim();
    }
    for (var d of searchDirs || []) {
      try {
        if (!fs.existsSync(d)) continue;
        for (var name of names) {
          var candidate = path.join(d, name);
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
          }
        }
      } catch (e) {}
    }
    return "";
  }

  getBestIP() {
    return this.localIPs.length > 0 ? this.localIPs[0] : null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  四象 · Sixiang · Capability — 运行时检测，替代一切假设
// ═══════════════════════════════════════════════════════════════

class DaoCapability {
  constructor() {
    this.platform = process.platform;
    this.screenCapture = [];
    this.inputMethod = [];
    this.audioCapture = [];
    this.videoCodec = ["jpeg"];
    this.tunnelMethod = [];
    this.adbDevices = [];
    // 柔弱胜刚强: 自适应参数，运行时调节
    this.adaptive = {
      maxFps: 30,
      minFps: 5,
      maxQuality: 90,
      minQuality: 20,
      maxBitrate: 4000000,
      minBitrate: 200000,
    };
  }

  probe(discovery) {
    this.adbDevices = discovery.adbDevices;
    this.tunnelMethod = discovery.tunnels.map(function (t) {
      return path.parse(t).name;
    });

    if (IS_WIN) {
      this.screenCapture = ["gdi"];
      this.inputMethod = ["sendinput"];
      try {
        var ver = os.release().split(".");
        if (parseInt(ver[0]) >= 10) this.screenCapture.unshift("dxgi");
      } catch (e) {}
      this.audioCapture = ["wasapi"];
    } else if (process.platform === "linux") {
      if (_sh("which pipewire", 2000)) this.screenCapture.push("pipewire");
      if (_sh("which xdotool", 2000)) this.inputMethod.push("xdotool");
      if (_sh("which pactl", 2000)) this.audioCapture.push("pulseaudio");
    }

    if (discovery.adbDevices.length > 0) {
      if (this.inputMethod.indexOf("adb") < 0) this.inputMethod.push("adb");
      if (this.videoCodec.indexOf("h264") < 0) this.videoCodec.unshift("h264");
    }

    // AirControl (scrcpy protocol) — the fastest input
    if (discovery.adbPath) {
      var acNames = IS_WIN ? ["ac_server.exe"] : ["ac_server"];
      var acDirs = [__dirname, path.join(__dirname, "bin")];
      if (IS_WIN) {
        acDirs.push("D:\\leidian\\remote", "C:\\leidian\\remote");
        acDirs.push(
          path.join(process.env.LOCALAPPDATA || "", "leidian", "remote"),
        );
      }
      var ac = discovery.findBinary(acNames, acDirs);
      if (ac) this.inputMethod.unshift("aircontrol:" + ac);
    }
  }

  bestCodec() {
    for (var pref of ["h264", "vp8", "jpeg"]) {
      if (this.videoCodec.indexOf(pref) >= 0) return pref;
    }
    return "jpeg";
  }

  bestInput() {
    for (var m of this.inputMethod) {
      if (m.startsWith("aircontrol:")) return m;
    }
    for (var pref of ["sendinput", "adb", "xdotool"]) {
      if (this.inputMethod.indexOf(pref) >= 0) return pref;
    }
    return "";
  }

  toDict() {
    return {
      platform: this.platform,
      screenCapture: this.screenCapture,
      inputMethod: this.inputMethod.map(function (m) {
        return m.split(":")[0];
      }),
      audioCapture: this.audioCapture,
      videoCodec: this.videoCodec,
      tunnelMethod: this.tunnelMethod,
      adbDevices: this.adbDevices,
      adaptive: this.adaptive,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
//  八卦 · Bagua · Session — 每连接独立鉴权，替代共享令牌
// ═══════════════════════════════════════════════════════════════

class DaoSession {
  constructor(identity) {
    this._identity = identity;
    this._sessions = new Map();
  }

  create(ttl, meta) {
    ttl = ttl || 86400;
    var sid = DaoEntropy.sessionId();
    this._sessions.set(sid, {
      created: Date.now(),
      ttl: ttl * 1000,
      meta: meta || {},
      connections: 0,
      maxConnections: 5,
      token: this._identity.createToken(ttl, meta),
    });
    return sid;
  }

  validate(sid) {
    var s = this._sessions.get(sid);
    if (!s) return false;
    if (Date.now() > s.created + s.ttl) {
      this._sessions.delete(sid);
      return false;
    }
    return true;
  }

  connect(sid) {
    if (!this.validate(sid)) return null;
    var s = this._sessions.get(sid);
    if (s.connections >= s.maxConnections) return null;
    s.connections++;
    return s.meta;
  }

  disconnect(sid) {
    var s = this._sessions.get(sid);
    if (s) s.connections = Math.max(0, s.connections - 1);
  }

  get(sid) {
    if (this.validate(sid)) return this._sessions.get(sid);
    return null;
  }

  listActive() {
    this.cleanup();
    var list = [];
    this._sessions.forEach(function (v, k) {
      list.push(Object.assign({ id: k }, v));
    });
    return list;
  }

  cleanup() {
    var now = Date.now();
    var expired = [];
    this._sessions.forEach(function (v, k) {
      if (now > v.created + v.ttl) expired.push(k);
    });
    for (var k of expired) this._sessions.delete(k);
  }
}

// ═══════════════════════════════════════════════════════════════
//  万物 · Wanwu · The Kernel — 道生一，一生二，二生三，三生万物
// ═══════════════════════════════════════════════════════════════

class DaoKernel {
  constructor(identityDir) {
    this.entropy = DaoEntropy;
    this.identity = new DaoIdentity(identityDir);
    this.discovery = new DaoDiscovery();
    this.capability = new DaoCapability();
    this.session = new DaoSession(this.identity);
    this._port = 0;
    this._publicUrl = "";
    this._awake = false;
    this._state = {};
    this._startTime = Date.now();
  }

  awaken() {
    _log("道核 · 觉醒 ════════════════════════════");
    _log("[无极] 熵源就绪");
    _log("[太极] 身份: " + this.identity.fingerprint);

    // 两仪 · 探测
    var disc = this.discovery.probeAll();
    _log("[两仪] 网络: " + (this.discovery.localIPs.join(", ") || "?"));
    _log(
      "[两仪] ADB: " +
        (this.discovery.adbPath || "未发现") +
        " | 设备: " +
        (this.discovery.adbDevices.length > 0
          ? this.discovery.adbDevices.join(",")
          : "无"),
    );
    _log(
      "[两仪] 隧道: " +
        (this.discovery.tunnels
          .map(function (t) {
            return path.parse(t).name;
          })
          .join(", ") || "无"),
    );

    // 四象 · 能力
    this.capability.probe(this.discovery);
    _log(
      "[四象] 采集: " +
        JSON.stringify(this.capability.screenCapture) +
        " | 输入: " +
        JSON.stringify(
          this.capability.inputMethod.map(function (m) {
            return m.split(":")[0];
          }),
        ),
    );
    _log(
      "[四象] 编码: " +
        JSON.stringify(this.capability.videoCodec) +
        " | 音频: " +
        JSON.stringify(this.capability.audioCapture),
    );

    // 分配端口: 默认3002(匹配文档), 由server.js EADDRINUSE自动重试
    // 道法自然: 不在此处同步检测(Node22 listen异步), 信任运行时适配
    this._port = 3002;
    _log("[万物] 端口: " + this._port + " (默认, 冲突时自动递增)");

    this._awake = true;
    this._startTime = Date.now();
    this._state = {
      fingerprint: this.identity.fingerprint,
      port: this._port,
      discovery: disc,
      capability: this.capability.toDict(),
      awakenedAt: new Date().toISOString(),
    };
    _log("道核 · 就绪 ════════════════════════════");
    return this._state;
  }

  get port() {
    if (!this._port) this._port = DaoEntropy.portSync();
    return this._port;
  }
  set port(v) {
    this._port = v;
  }

  get publicUrl() {
    return this._publicUrl;
  }
  set publicUrl(url) {
    this._publicUrl = (url || "").replace(/\/$/, "");
  }

  // 道法自然: 生成Token兼容旧系统 — 既是HMAC签名令牌, 也可作为共享密钥使用
  get masterToken() {
    return this.identity.createToken(86400 * 365, { role: "master" });
  }

  invite(ttl, device) {
    ttl = ttl || 86400;
    var meta = { type: "viewer", fingerprint: this.identity.fingerprint };
    if (device) meta.device = device;
    var sid = this.session.create(ttl, meta);
    var bestIP = this.discovery.getBestIP();
    var baseLocal = "http://" + (bestIP || "localhost") + ":" + this._port;
    var basePublic = this._publicUrl || "";
    return {
      session: sid,
      localUrl: baseLocal + "/v/" + sid,
      publicUrl: basePublic ? basePublic + "/v/" + sid : "",
      fingerprint: this.identity.fingerprint,
      ttl: ttl,
      expires: new Date(Date.now() + ttl * 1000).toLocaleString(),
    };
  }

  state() {
    return {
      ok: true,
      version: "dao-v1",
      fingerprint: this.identity.fingerprint,
      port: this._port,
      publicUrl: this._publicUrl,
      uptime: Math.floor((Date.now() - this._startTime) / 1000),
      sessions: this.session.listActive().length,
      capability: this.capability.toDict(),
      network: {
        ips: this.discovery.localIPs,
        hostname: this.discovery.hostname,
      },
    };
  }

  // 唯变所适: 检查认证 — 支持session token / master token / localhost豁免
  checkAuth(req) {
    // localhost豁免
    var ip = (req.socket || req.connection || {}).remoteAddress || "";
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
      return true;
    }
    // URL query token
    try {
      var u = new URL(req.url || "", "http://localhost");
      var token = u.searchParams.get("token");
      if (token && this.identity.verifyToken(token)) return true;
    } catch (e) {}
    // Authorization header
    var auth = (req.headers || {}).authorization || "";
    if (auth.startsWith("Bearer ")) {
      var tok = auth.slice(7);
      if (this.identity.verifyToken(tok)) return true;
    }
    return false;
  }

  // 请求自知: 从请求本身推导协议/主机 — 不预测, 不硬编码
  static reqProto(req) {
    if (
      ((req.headers || {})["x-forwarded-proto"] || "").toLowerCase() === "https"
    )
      return "https";
    if (req.socket && req.socket.encrypted) return "https";
    var host = (req.headers || {}).host || "";
    if (host && !/:\d+$/.test(host)) return "https";
    return "http";
  }

  static reqWsProto(req) {
    return DaoKernel.reqProto(req) === "https" ? "wss" : "ws";
  }

  static reqHost(req) {
    return (
      (req.headers || {})["x-forwarded-host"] ||
      (req.headers || {}).host ||
      "localhost"
    );
  }
}

module.exports = {
  DaoEntropy: DaoEntropy,
  DaoIdentity: DaoIdentity,
  DaoDiscovery: DaoDiscovery,
  DaoCapability: DaoCapability,
  DaoSession: DaoSession,
  DaoKernel: DaoKernel,
  _log: _log,
  _sh: _sh,
};
