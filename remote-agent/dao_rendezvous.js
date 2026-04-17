// ╔══════════════════════════════════════════════════════════════╗
// ║  道 · 约会 (dao_rendezvous.js) — 太上不知有之               ║
// ║                                                              ║
// ║  大音希声, 大象无形. Hub 在 LAN 上默默地一秒一声轻敲,        ║
// ║  有缘者即闻即至, 无缘者不知其存. 无需 URL, 无需域名,        ║
// ║  无需扫码 — 打开客户端即已相遇.                              ║
// ║                                                              ║
// ║  UDP 多播于 239.77.76.75:7777 (dao 的 "道" 码 + Lao Tzu 字)   ║
// ║  广播体 (JSON, < 512B, MTU 安全):                            ║
// ║    { v:1, fp:"<ed25519-fp>", p:<hubPort>,                    ║
// ║      s:"<sha256(fp+rel_token).8>",   ← 伪秘信标, 可选        ║
// ║      n:"<hostname>", t:<ts>, ips:[ "<lan>" ],                ║
// ║      pu:"<publicUrl|''>"                                     ║
// ║    }                                                         ║
// ║                                                              ║
// ║  道法自然: 无多播权限→自动退化为本网段 255.255.255.255 广播   ║
// ║  柔弱胜刚强: 任何错误均 swallow; Hub 宁退 LAN-only 不崩溃.   ║
// ╚══════════════════════════════════════════════════════════════╝

"use strict";

const dgram = require("dgram");
const os = require("os");
const crypto = require("crypto");

// 道的 unicode: 道=U+9053=0x9053=(37,80,83), 慎选同段未占用组: 239.77.76.75
const DAO_MCAST_ADDR = "239.77.76.75";
const DAO_MCAST_PORT = 7777; // 7×7×7×... 七七返道, 易记
const BEACON_INTERVAL_MS = 3000; // 3s 一拍, 轻而不扰
const BEACON_TTL = 4; // hop 限制, 避免跨网段泄漏
const MAX_MSG_BYTES = 480; // 留余量给 UDP header

function _ts() {
  return new Date().toTimeString().slice(0, 8);
}
function _log(msg) {
  console.log("[" + _ts() + "] [rendezvous] " + msg);
}
function _getLanIPs() {
  var ips = [];
  try {
    var nets = os.networkInterfaces();
    for (var name of Object.keys(nets)) {
      for (var iface of nets[name]) {
        if (iface.family === "IPv4" && !iface.internal) ips.push(iface.address);
      }
    }
  } catch (e) {}
  return ips;
}

// ═══════════════════════════════════════════════════════════════
//  Beacon — Hub 端: 周期广播自身坐标
// ═══════════════════════════════════════════════════════════════

class DaoRendezvousBeacon {
  constructor(opts) {
    opts = opts || {};
    this._fp = opts.fingerprint || "";
    this._port = opts.port || 0;
    this._publicUrl = opts.publicUrl || "";
    this._hostname = opts.hostname || os.hostname();
    this._sigil = opts.sigil || ""; // 可选伪秘信标 — sha256(fp+relToken).slice(0,8)
    this._extra = opts.extra || {}; // 任意附加字段 (小心 MTU)
    this._socket = null;
    this._timer = null;
    this._broadcastFallback = false;
    this._mcastLocalIface = null;
  }

  setPublicUrl(url) {
    this._publicUrl = url || "";
  }
  setPort(port) {
    this._port = port || 0;
  }
  setSigil(sigil) {
    this._sigil = sigil || "";
  }

  _buildMessage() {
    var ips = _getLanIPs();
    var msg = {
      v: 1,
      fp: this._fp,
      p: this._port,
      s: this._sigil || undefined,
      n: this._hostname,
      t: Math.floor(Date.now() / 1000),
      ips: ips,
      pu: this._publicUrl || undefined,
    };
    // 合并 extra (覆盖不掉核心字段)
    for (var k of Object.keys(this._extra)) {
      if (msg[k] === undefined) msg[k] = this._extra[k];
    }
    var buf = Buffer.from(JSON.stringify(msg), "utf-8");
    if (buf.length > MAX_MSG_BYTES) {
      // 紧缩: 去掉 extra & ips 保底
      delete msg.ips;
      for (var k of Object.keys(this._extra)) delete msg[k];
      buf = Buffer.from(JSON.stringify(msg), "utf-8");
    }
    return buf;
  }

  _send(msg) {
    if (!this._socket) return;
    var self = this;
    var ifaceIPs = _getLanIPs();
    // 万法归宗: 每块网卡各送一份多播, 避免默认路由挑错 (多网卡/虚拟网卡场景)
    // 道法自然: 无网卡信息也至少走默认路由一次
    var targets = ifaceIPs.length ? ifaceIPs : [null];
    var multicastFailed = false;
    if (!this._broadcastFallback) {
      for (var i = 0; i < targets.length; i++) {
        var ifip = targets[i];
        try {
          if (ifip) self._socket.setMulticastInterface(ifip);
        } catch (e) {}
        (function (capturedIfip) {
          self._socket.send(
            msg,
            0,
            msg.length,
            DAO_MCAST_PORT,
            DAO_MCAST_ADDR,
            function (err) {
              if (err && !self._broadcastFallback) {
                // 任一网卡多播失败即退化全体广播, 避免半通不通
                self._broadcastFallback = true;
                _log(
                  "多播不可用 (iface=" +
                    (capturedIfip || "default") +
                    "), 退化广播: " +
                    err.code,
                );
                try {
                  self._socket.setBroadcast(true);
                } catch (e) {}
              }
            },
          );
        })(ifip);
      }
    }
    // 广播模式 (或多播降级): 同时向每个子网广播 255.255.255.255
    if (this._broadcastFallback) {
      for (var j = 0; j < targets.length; j++) {
        var ifip2 = targets[j];
        try {
          if (ifip2) self._socket.setMulticastInterface(ifip2);
        } catch (e) {}
        try {
          self._socket.send(
            msg,
            0,
            msg.length,
            DAO_MCAST_PORT,
            "255.255.255.255",
            function () {},
          );
        } catch (e) {}
      }
    }
  }

  start() {
    if (this._socket) return;
    var self = this;
    var sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    sock.on("error", function (err) {
      _log("socket 错误: " + err.message + " (退化 LAN-only)");
      try {
        sock.close();
      } catch (e) {}
      self._socket = null;
      if (self._timer) {
        clearInterval(self._timer);
        self._timer = null;
      }
    });
    sock.bind(0, function () {
      try {
        sock.setBroadcast(true);
      } catch (e) {}
      try {
        sock.setMulticastTTL(BEACON_TTL);
      } catch (e) {}
      try {
        sock.setMulticastLoopback(true); // 允许同机客户端看见自身
      } catch (e) {}
      // 注: 不调用 addMembership — beacon 只发不收
      self._socket = sock;
      _log(
        "广播就绪: " +
          DAO_MCAST_ADDR +
          ":" +
          DAO_MCAST_PORT +
          " (fp=" +
          self._fp.slice(0, 8) +
          ", port=" +
          self._port +
          ")",
      );
      // 立即一发, 然后周期
      self._send(self._buildMessage());
      self._timer = setInterval(function () {
        try {
          self._send(self._buildMessage());
        } catch (e) {}
      }, BEACON_INTERVAL_MS);
      // timer 不阻塞 Node 退出
      if (self._timer.unref) self._timer.unref();
    });
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this._socket) {
      try {
        this._socket.close();
      } catch (e) {}
      this._socket = null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  Discovery — 客户端 / Hub 彼此探测
//  道可道 非常少: listen() 唯一 API, 拿到 { fp,p,ips,pu,... } 即连
// ═══════════════════════════════════════════════════════════════

class DaoRendezvousDiscovery {
  constructor(opts) {
    opts = opts || {};
    this._onBeacon = opts.onBeacon || function () {};
    this._filterFp = opts.fingerprint || null; // 只关心指定身份 (可选)
    this._filterSigil = opts.sigil || null; // 伪秘信标过滤 (可选)
    this._socket = null;
    this._seen = new Map(); // fp → lastSeen, 防抖
  }

  _emit(msg, rinfo) {
    if (!msg || !msg.fp) return;
    if (this._filterFp && msg.fp !== this._filterFp) return;
    if (this._filterSigil && msg.s && msg.s !== this._filterSigil) return;
    // 去重: 同 fp 3 秒内只报一次
    var key = msg.fp + ":" + (msg.p || 0);
    var now = Date.now();
    var last = this._seen.get(key) || 0;
    if (now - last < BEACON_INTERVAL_MS - 500) return;
    this._seen.set(key, now);
    // 补充 rinfo.address 至 ips 最前 (最实可达)
    var ips = Array.isArray(msg.ips) ? msg.ips.slice() : [];
    if (rinfo && rinfo.address && ips.indexOf(rinfo.address) < 0) {
      ips.unshift(rinfo.address);
    }
    try {
      this._onBeacon(
        {
          fingerprint: msg.fp,
          port: msg.p,
          hostname: msg.n,
          publicUrl: msg.pu || "",
          ips: ips,
          sigil: msg.s || "",
          ts: msg.t || Math.floor(now / 1000),
          raw: msg,
        },
        rinfo,
      );
    } catch (e) {}
  }

  start() {
    if (this._socket) return;
    var self = this;
    var sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    sock.on("error", function (err) {
      _log("discovery 错误: " + err.message);
      try {
        sock.close();
      } catch (e) {}
      self._socket = null;
    });
    sock.on("message", function (buf, rinfo) {
      try {
        // 只处理合理大小的包
        if (!buf || buf.length < 6 || buf.length > MAX_MSG_BYTES + 32) return;
        var txt = buf.toString("utf-8");
        if (!txt.startsWith("{")) return;
        var msg = JSON.parse(txt);
        self._emit(msg, rinfo);
      } catch (e) {}
    });
    sock.bind(DAO_MCAST_PORT, function () {
      // 加入多播组 — 每个 LAN 接口各加入一次 (道法自然, 不限网卡)
      var ifaces = os.networkInterfaces();
      var joined = 0;
      for (var name of Object.keys(ifaces)) {
        for (var iface of ifaces[name]) {
          if (iface.family !== "IPv4" || iface.internal) continue;
          try {
            sock.addMembership(DAO_MCAST_ADDR, iface.address);
            joined++;
          } catch (e) {}
        }
      }
      // 全无网卡也能收 255.255.255.255 广播 (bind 0.0.0.0 默认收)
      try {
        sock.setBroadcast(true);
      } catch (e) {}
      self._socket = sock;
      _log("监听就绪: :" + DAO_MCAST_PORT + " (" + joined + " 网卡加入多播组)");
    });
  }

  stop() {
    if (this._socket) {
      try {
        this._socket.close();
      } catch (e) {}
      this._socket = null;
    }
    this._seen.clear();
  }

  // 一次性发现 — 在 timeoutMs 内收集到的所有唯一 beacon
  static once(timeoutMs, filter) {
    timeoutMs = timeoutMs || 4000;
    filter = filter || {};
    return new Promise(function (resolve) {
      var found = new Map();
      var disc = new DaoRendezvousDiscovery({
        fingerprint: filter.fingerprint,
        sigil: filter.sigil,
        onBeacon: function (b) {
          found.set(b.fingerprint + ":" + b.port, b);
        },
      });
      disc.start();
      setTimeout(function () {
        disc.stop();
        resolve(Array.from(found.values()));
      }, timeoutMs);
    });
  }
}

// ═══════════════════════════════════════════════════════════════
//  Utility — 根据身份签一个公开 sigil (供 beacon 与 discovery 彼此认)
//  非秘密, 只是 "谁在说话". 真正的认证走 /pair 端到端密钥交换.
// ═══════════════════════════════════════════════════════════════

function deriveSigil(fingerprint, salt) {
  salt = salt || "dao-rendezvous/v1";
  return crypto
    .createHash("sha256")
    .update(String(fingerprint) + "|" + salt)
    .digest("hex")
    .slice(0, 8);
}

module.exports = {
  DaoRendezvousBeacon: DaoRendezvousBeacon,
  DaoRendezvousDiscovery: DaoRendezvousDiscovery,
  deriveSigil: deriveSigil,
  DAO_MCAST_ADDR: DAO_MCAST_ADDR,
  DAO_MCAST_PORT: DAO_MCAST_PORT,
  BEACON_INTERVAL_MS: BEACON_INTERVAL_MS,
};
