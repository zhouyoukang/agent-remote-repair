// ═══════════════════════════════════════════════════════════════
//  道 · mDNS 自宣 (RFC 6762 + DNS-SD RFC 6763) — 纯 Node 零依赖
//  太上, 不知有之 — 同网段任意设备, 用 dao-<fp8>.local 即达
//
//  广播目标:
//    · A      dao-<fp8>.local. → 本机 LAN IP (逐接口)
//    · PTR    _dao._tcp.local. → dao-<fp8>._dao._tcp.local. (服务通告)
//    · PTR    _http._tcp.local. → dao-<fp8>._http._tcp.local. (浏览器兼容)
//    · SRV    dao-<fp8>._dao._tcp.local. port=<hubPort> target=dao-<fp8>.local.
//    · TXT    dao-<fp8>._dao._tcp.local. → "fp=...;v=1;path=/c"
//
//  客户端 (Bonjour/Avahi/Windows mDNS Resolver/Apple Rendezvous):
//    · http://dao-<fp8>.local:<port>/  → 打开 sense page
//    · Safari 可直接扫 Bonjour 设备列表
//
//  限制 (承认不完美, 道法自然):
//    · 不实现 label 压缩 (RFC 1035 §4.1.4): 编码大, 但解析都认
//    · 不实现 truly-unique 探测 (RFC 6762 §8.1): 假设 fp 足够独一
//    · Windows 10+/macOS 原生支持; Linux 需 avahi-daemon
// ═══════════════════════════════════════════════════════════════

"use strict";

const dgram = require("dgram");
const os = require("os");

const MDNS_ADDR_V4 = "224.0.0.251";
const MDNS_PORT = 5353;
const TTL_RR = 120; // 推荐 TTL (秒)
const TTL_ANNOUNCE_GAP = 1000; // initial announcement 间隔 (ms)
const REANNOUNCE_MS = 60 * 1000; // 每 60s 重播一次, 抗网络变化

// ─────────────────────────────────────────────────────────────
// DNS 消息编码 — 只支持我们用到的字段
// ─────────────────────────────────────────────────────────────
const TYPE_A = 1;
const TYPE_PTR = 12;
const TYPE_TXT = 16;
const TYPE_SRV = 33;
const CLASS_IN = 1;
const CLASS_IN_FLUSH = 0x8001; // cache-flush bit + IN
const FLAG_RESPONSE = 0x8400; // QR=1, AA=1

function writeName(name) {
  // "dao-xx.local" → <length><label><length><label><0>
  var parts = name.replace(/\.$/, "").split(".");
  var total = 1; // 末尾 \0
  for (var i = 0; i < parts.length; i++) total += 1 + parts[i].length;
  var buf = Buffer.alloc(total);
  var off = 0;
  for (var j = 0; j < parts.length; j++) {
    var p = parts[j];
    buf.writeUInt8(p.length, off);
    off++;
    buf.write(p, off, p.length, "utf8");
    off += p.length;
  }
  buf.writeUInt8(0, off);
  return buf;
}

function writeRR(name, type, klass, ttl, rdata) {
  var nameBuf = writeName(name);
  var hdr = Buffer.alloc(10);
  hdr.writeUInt16BE(type, 0);
  hdr.writeUInt16BE(klass, 2);
  hdr.writeUInt32BE(ttl, 4);
  hdr.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([nameBuf, hdr, rdata]);
}

function rdataA(ip4) {
  // "192.168.1.5" → 4 字节
  var buf = Buffer.alloc(4);
  var parts = ip4.split(".");
  for (var i = 0; i < 4; i++) buf.writeUInt8(parseInt(parts[i], 10), i);
  return buf;
}

function rdataPTR(targetName) {
  return writeName(targetName);
}

function rdataTXT(lines) {
  // 每行: <len><utf8 bytes>, 如 "fp=xxx"
  var chunks = [];
  for (var i = 0; i < lines.length; i++) {
    var s = lines[i];
    if (s.length > 255) s = s.slice(0, 255);
    var b = Buffer.alloc(1 + s.length);
    b.writeUInt8(s.length, 0);
    b.write(s, 1, s.length, "utf8");
    chunks.push(b);
  }
  if (chunks.length === 0) {
    var z = Buffer.alloc(1);
    z.writeUInt8(0, 0);
    return z;
  }
  return Buffer.concat(chunks);
}

function rdataSRV(priority, weight, port, target) {
  var targetBuf = writeName(target);
  var head = Buffer.alloc(6);
  head.writeUInt16BE(priority, 0);
  head.writeUInt16BE(weight, 2);
  head.writeUInt16BE(port, 4);
  return Buffer.concat([head, targetBuf]);
}

function buildResponse(answers) {
  // RFC 6762: transaction id=0, flags=0x8400 (response+AA), qcount=0, ancount=N
  var hdr = Buffer.alloc(12);
  hdr.writeUInt16BE(0, 0); // id
  hdr.writeUInt16BE(FLAG_RESPONSE, 2); // flags
  hdr.writeUInt16BE(0, 4); // qdcount
  hdr.writeUInt16BE(answers.length, 6); // ancount
  hdr.writeUInt16BE(0, 8); // nscount
  hdr.writeUInt16BE(0, 10); // arcount
  return Buffer.concat([hdr].concat(answers));
}

// ─────────────────────────────────────────────────────────────
// DNS 消息解码 — 提取 query name 和 type, 判断是否要响应
// ─────────────────────────────────────────────────────────────
function parseName(buf, offset) {
  var labels = [];
  var origOffset = offset;
  var jumped = false;
  var safety = 0;
  while (safety++ < 128) {
    if (offset >= buf.length) return null;
    var len = buf.readUInt8(offset);
    if (len === 0) {
      if (!jumped) origOffset = offset + 1;
      return { name: labels.join("."), nextOffset: origOffset };
    }
    if ((len & 0xc0) === 0xc0) {
      // 压缩指针
      if (offset + 1 >= buf.length) return null;
      if (!jumped) origOffset = offset + 2;
      offset = ((len & 0x3f) << 8) | buf.readUInt8(offset + 1);
      jumped = true;
      continue;
    }
    if (offset + 1 + len > buf.length) return null;
    labels.push(buf.slice(offset + 1, offset + 1 + len).toString("utf8"));
    offset += 1 + len;
  }
  return null;
}

function parseQuestions(buf) {
  if (buf.length < 12) return [];
  var flags = buf.readUInt16BE(2);
  if ((flags & 0x8000) !== 0) return []; // 跳过响应包
  var qdcount = buf.readUInt16BE(4);
  if (qdcount === 0) return [];
  var off = 12;
  var out = [];
  for (var i = 0; i < qdcount && off < buf.length; i++) {
    var r = parseName(buf, off);
    if (!r) break;
    off = r.nextOffset;
    if (off + 4 > buf.length) break;
    var qtype = buf.readUInt16BE(off);
    var qclass = buf.readUInt16BE(off + 2);
    off += 4;
    out.push({ name: r.name.toLowerCase(), type: qtype, class: qclass });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 主入口 · DaoMdns
// ─────────────────────────────────────────────────────────────
class DaoMdns {
  constructor(opts) {
    opts = opts || {};
    this.fingerprint = opts.fingerprint || "";
    this.port = opts.port || 3002;
    this.path = opts.path || "/c"; // PWA 落地路径 — 扫到即入
    this.fp8 = this.fingerprint.slice(0, 8);
    this.hostName = "dao-" + this.fp8 + ".local";
    this.svcName = "dao-" + this.fp8 + "._dao._tcp.local";
    this.httpSvcName = "dao-" + this.fp8 + "._http._tcp.local";
    this.sock = null;
    this.timer = null;
    this.ips = [];
    this._log =
      opts.log ||
      function (m) {
        console.log("[mdns] " + m);
      };
  }

  _collectIPs() {
    var nets = os.networkInterfaces();
    var out = [];
    Object.keys(nets).forEach(function (name) {
      (nets[name] || []).forEach(function (iface) {
        if (iface.family !== "IPv4" || iface.internal) return;
        // 排除 Docker/VPN 桥常见前缀
        if (
          iface.address.startsWith("169.254.") ||
          iface.address.startsWith("172.17.") // Docker default bridge
        ) {
          return;
        }
        out.push(iface.address);
      });
    });
    return out;
  }

  _buildAnswers() {
    var ips = this._ips;
    var self = this;
    var answers = [];

    // A 记录: dao-<fp8>.local → 每个 LAN IP
    ips.forEach(function (ip) {
      answers.push(
        writeRR(self.hostName, TYPE_A, CLASS_IN_FLUSH, TTL_RR, rdataA(ip)),
      );
    });

    // SRV 记录: dao-<fp8>._dao._tcp.local → hostName:port
    answers.push(
      writeRR(
        self.svcName,
        TYPE_SRV,
        CLASS_IN_FLUSH,
        TTL_RR,
        rdataSRV(0, 0, self.port, self.hostName),
      ),
    );

    // TXT 记录: fp=..., v=1, path=/c
    answers.push(
      writeRR(
        self.svcName,
        TYPE_TXT,
        CLASS_IN_FLUSH,
        TTL_RR,
        rdataTXT([
          "fp=" + self.fingerprint,
          "v=1",
          "path=" + self.path,
          "port=" + self.port,
        ]),
      ),
    );

    // PTR 记录: _dao._tcp.local → dao-<fp8>._dao._tcp.local (服务指针)
    answers.push(
      writeRR(
        "_dao._tcp.local",
        TYPE_PTR,
        CLASS_IN,
        TTL_RR,
        rdataPTR(self.svcName),
      ),
    );

    // HTTP 服务兼容广告: _http._tcp.local → dao-<fp8>._http._tcp.local
    answers.push(
      writeRR(
        self.httpSvcName,
        TYPE_SRV,
        CLASS_IN_FLUSH,
        TTL_RR,
        rdataSRV(0, 0, self.port, self.hostName),
      ),
    );
    answers.push(
      writeRR(
        self.httpSvcName,
        TYPE_TXT,
        CLASS_IN_FLUSH,
        TTL_RR,
        rdataTXT(["path=" + self.path, "fp=" + self.fingerprint]),
      ),
    );
    answers.push(
      writeRR(
        "_http._tcp.local",
        TYPE_PTR,
        CLASS_IN,
        TTL_RR,
        rdataPTR(self.httpSvcName),
      ),
    );

    return answers;
  }

  _announce() {
    if (!this.sock) return;
    this._ips = this._collectIPs();
    if (this._ips.length === 0) return;
    var msg = buildResponse(this._buildAnswers());
    var self = this;
    this.sock.send(msg, 0, msg.length, MDNS_PORT, MDNS_ADDR_V4, function (err) {
      if (err && self._log) self._log("announce err: " + err.message);
    });
  }

  _goodbye() {
    // RFC 6762 §10.1: 临终广播 TTL=0 令缓存方立即清理
    if (!this.sock) return;
    var self = this;
    var ips = this._ips || [];
    var answers = [];
    ips.forEach(function (ip) {
      answers.push(
        writeRR(self.hostName, TYPE_A, CLASS_IN_FLUSH, 0, rdataA(ip)),
      );
    });
    answers.push(
      writeRR(
        self.svcName,
        TYPE_SRV,
        CLASS_IN_FLUSH,
        0,
        rdataSRV(0, 0, self.port, self.hostName),
      ),
    );
    answers.push(
      writeRR(
        "_dao._tcp.local",
        TYPE_PTR,
        CLASS_IN,
        0,
        rdataPTR(self.svcName),
      ),
    );
    try {
      var msg = buildResponse(answers);
      this.sock.send(msg, 0, msg.length, MDNS_PORT, MDNS_ADDR_V4);
    } catch (e) {}
  }

  _onQuery(msg, rinfo) {
    var questions;
    try {
      questions = parseQuestions(msg);
    } catch (e) {
      return;
    }
    if (!questions.length) return;
    var ourNames = [
      this.hostName.toLowerCase(),
      this.svcName.toLowerCase(),
      this.httpSvcName.toLowerCase(),
      "_dao._tcp.local",
      "_http._tcp.local",
    ];
    var relevant = false;
    for (var i = 0; i < questions.length; i++) {
      if (ourNames.indexOf(questions[i].name) >= 0) {
        relevant = true;
        break;
      }
    }
    if (!relevant) return;
    // 对所有相关 query 一次性回全答案 (太上不知有之: 多说无益, 一次给全)
    this._announce();
  }

  start() {
    if (this.sock) return;
    var self = this;
    var sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.sock = sock;

    sock.on("error", function (err) {
      self._log("socket err: " + err.message + " (继续运行)");
    });

    sock.on("message", function (msg, rinfo) {
      self._onQuery(msg, rinfo);
    });

    sock.bind(MDNS_PORT, function () {
      try {
        sock.setMulticastTTL(255);
        sock.setMulticastLoopback(true);
        // 逐个活跃接口加入组播
        var nets = os.networkInterfaces();
        Object.keys(nets).forEach(function (name) {
          (nets[name] || []).forEach(function (iface) {
            if (iface.family !== "IPv4" || iface.internal) return;
            try {
              sock.addMembership(MDNS_ADDR_V4, iface.address);
            } catch (e) {
              // 某些接口 (VPN/虚拟) 不支持, 忽略
            }
          });
        });
        self._log(
          "启用 · http://" + self.hostName + ":" + self.port + self.path,
        );
        // initial announcements (RFC 6762 §8.3: 2次, 间隔 1s)
        self._announce();
        setTimeout(function () {
          self._announce();
        }, TTL_ANNOUNCE_GAP);
        // 周期重播
        self.timer = setInterval(function () {
          self._announce();
        }, REANNOUNCE_MS);
        if (self.timer && typeof self.timer.unref === "function") {
          self.timer.unref();
        }
      } catch (e) {
        self._log("bind 后初始化失败: " + e.message);
      }
    });
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      this._goodbye();
    } catch (e) {}
    if (this.sock) {
      try {
        this.sock.close();
      } catch (e) {}
      this.sock = null;
    }
  }

  setPort(port) {
    this.port = port;
  }
}

module.exports = {
  DaoMdns,
  MDNS_ADDR_V4,
  MDNS_PORT,
};
