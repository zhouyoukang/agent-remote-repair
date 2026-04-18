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
const EventEmitter = require("events");

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
// 响应消息解码 — PTR/SRV/TXT/A 四型足矣覆盖 DNS-SD 浏览
// ─────────────────────────────────────────────────────────────
function parseRdataA(buf, offset, rdLen) {
  if (rdLen < 4 || offset + 4 > buf.length) return null;
  return (
    buf.readUInt8(offset) +
    "." +
    buf.readUInt8(offset + 1) +
    "." +
    buf.readUInt8(offset + 2) +
    "." +
    buf.readUInt8(offset + 3)
  );
}

function parseRdataPTR(buf, offset) {
  var r = parseName(buf, offset);
  return r ? r.name : null;
}

function parseRdataSRV(buf, offset, rdLen) {
  if (rdLen < 7 || offset + 6 > buf.length) return null;
  var priority = buf.readUInt16BE(offset);
  var weight = buf.readUInt16BE(offset + 2);
  var port = buf.readUInt16BE(offset + 4);
  var t = parseName(buf, offset + 6);
  return {
    priority: priority,
    weight: weight,
    port: port,
    target: t ? t.name : "",
  };
}

function parseRdataTXT(buf, offset, rdLen) {
  var out = {};
  var end = offset + rdLen;
  var o = offset;
  while (o < end && o < buf.length) {
    var len = buf.readUInt8(o);
    o += 1;
    if (len === 0 || o + len > end) break;
    var str = buf.slice(o, o + len).toString("utf8");
    var eq = str.indexOf("=");
    if (eq >= 0) {
      out[str.slice(0, eq).toLowerCase()] = str.slice(eq + 1);
    } else {
      out[str.toLowerCase()] = true;
    }
    o += len;
  }
  return out;
}

// 解析一个 resource record section, 消费 count 个记录
// 返回 { records: [{name,type,class,ttl,parsed}], offset }
function parseRecords(buf, count, offset) {
  var out = [];
  for (var i = 0; i < count; i++) {
    if (offset >= buf.length) break;
    var nameR = parseName(buf, offset);
    if (!nameR) break;
    offset = nameR.nextOffset;
    if (offset + 10 > buf.length) break;
    var type = buf.readUInt16BE(offset);
    var klass = buf.readUInt16BE(offset + 2) & 0x7fff; // 去掉 cache-flush bit
    var ttl = buf.readUInt32BE(offset + 4);
    var rdLen = buf.readUInt16BE(offset + 8);
    offset += 10;
    if (offset + rdLen > buf.length) break;
    var parsed = null;
    switch (type) {
      case TYPE_A:
        parsed = parseRdataA(buf, offset, rdLen);
        break;
      case TYPE_PTR:
        parsed = parseRdataPTR(buf, offset);
        break;
      case TYPE_SRV:
        parsed = parseRdataSRV(buf, offset, rdLen);
        break;
      case TYPE_TXT:
        parsed = parseRdataTXT(buf, offset, rdLen);
        break;
      default:
        parsed = null;
    }
    out.push({
      name: nameR.name,
      type: type,
      class: klass,
      ttl: ttl,
      parsed: parsed,
    });
    offset += rdLen;
  }
  return { records: out, offset: offset };
}

// 解析整个响应消息 — 返回所有 answers/authority/additional 记录的合集
function parseResponse(buf) {
  if (buf.length < 12) return null;
  var flags = buf.readUInt16BE(2);
  if ((flags & 0x8000) === 0) return null; // 只认响应
  var qdcount = buf.readUInt16BE(4);
  var ancount = buf.readUInt16BE(6);
  var nscount = buf.readUInt16BE(8);
  var arcount = buf.readUInt16BE(10);
  var off = 12;
  // 跳过 question section (有些响应会 echo 问题)
  for (var i = 0; i < qdcount && off < buf.length; i++) {
    var n = parseName(buf, off);
    if (!n) return null;
    off = n.nextOffset + 4; // type(2) + class(2)
  }
  var records = [];
  var r1 = parseRecords(buf, ancount, off);
  records = records.concat(r1.records);
  var r2 = parseRecords(buf, nscount, r1.offset);
  records = records.concat(r2.records);
  var r3 = parseRecords(buf, arcount, r2.offset);
  records = records.concat(r3.records);
  return { flags: flags, records: records };
}

// 构造一个 PTR 查询消息 (发给 224.0.0.251:5353)
function buildQuery(serviceType, type) {
  var hdr = Buffer.alloc(12);
  hdr.writeUInt16BE(0, 0); // transaction id
  hdr.writeUInt16BE(0, 2); // flags: standard query
  hdr.writeUInt16BE(1, 4); // qdcount
  hdr.writeUInt16BE(0, 6); // ancount
  hdr.writeUInt16BE(0, 8); // nscount
  hdr.writeUInt16BE(0, 10); // arcount
  var nameBuf = writeName(serviceType);
  var q = Buffer.alloc(4);
  q.writeUInt16BE(type || TYPE_PTR, 0);
  q.writeUInt16BE(CLASS_IN, 2); // QM (multicast response); 若要 QU 单播响应则 |= 0x8000
  return Buffer.concat([hdr, nameBuf, q]);
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
      writeRR("_dao._tcp.local", TYPE_PTR, CLASS_IN, 0, rdataPTR(self.svcName)),
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

// ─────────────────────────────────────────────────────────────
// 主入口 · DaoMdnsBrowser — 扫描同网段 DNS-SD 服务, 事件驱动
//
// 用法:
//   var b = new DaoMdnsBrowser({ serviceTypes: ['_screenstream._tcp.local'] });
//   b.on('service', (info) => { /* info = {serviceType, instance, host, ip, port, txt} */ });
//   b.start();
//
// 生命事件:
//   'service' — 新服务发现 或 地址变化
//   'removed' — TTL 到期 (goodbye 广播)
// ─────────────────────────────────────────────────────────────
const STALE_MS = 5 * 60 * 1000; // 5min 未见即视为离线

class DaoMdnsBrowser extends EventEmitter {
  constructor(opts) {
    super();
    opts = opts || {};
    this.serviceTypes = (opts.serviceTypes || []).map(function (s) {
      return String(s).toLowerCase().replace(/\.$/, "");
    });
    this.queryInterval = opts.queryInterval || 30000;
    this.cache = new Map(); // instance(lower) → info
    this.sock = null;
    this.queryTimer = null;
    this.staleTimer = null;
    this._log =
      opts.log ||
      function (m) {
        console.log("[mdns-browser] " + m);
      };
  }

  _matchesServiceType(instanceName) {
    var low = instanceName.toLowerCase().replace(/\.$/, "");
    for (var i = 0; i < this.serviceTypes.length; i++) {
      var svc = this.serviceTypes[i];
      if (low === svc) return svc; // 也允许 PTR 自指
      if (low.endsWith("." + svc)) return svc;
    }
    return null;
  }

  _assembleFromRecords(records) {
    // 从一堆 record 里归并出 instance → {srv, txt}, 并回查 A 记录得到 ip
    var self = this;
    var instances = new Map(); // instanceLower → {instance, svcType, srv, txt, ttl}
    records.forEach(function (rec) {
      if (rec.type === TYPE_PTR && rec.parsed) {
        var svc = self._matchesServiceType(rec.name);
        if (!svc) return;
        var instKey = String(rec.parsed).toLowerCase();
        if (!instances.has(instKey)) {
          instances.set(instKey, {
            instance: rec.parsed,
            svcType: svc,
            srv: null,
            txt: null,
            ttl: rec.ttl,
          });
        }
      }
    });
    // 再扫一轮 SRV/TXT — 可能 PTR/SRV/TXT 共 instance 名, 也可能来自 additional
    records.forEach(function (rec) {
      var instKey = rec.name.toLowerCase();
      var hit = instances.get(instKey);
      // 若还没见 PTR, 但 SRV/TXT 名字匹配我们的服务类型后缀, 也收录
      if (!hit) {
        var svc2 = self._matchesServiceType(rec.name);
        if (svc2 && svc2 !== rec.name.toLowerCase()) {
          hit = {
            instance: rec.name,
            svcType: svc2,
            srv: null,
            txt: null,
            ttl: rec.ttl,
          };
          instances.set(instKey, hit);
        } else {
          return;
        }
      }
      if (rec.type === TYPE_SRV && rec.parsed) hit.srv = rec.parsed;
      else if (rec.type === TYPE_TXT && rec.parsed) hit.txt = rec.parsed;
      if (rec.ttl === 0) hit.ttl = 0; // goodbye
    });
    // 查 A 记录
    var hostA = new Map(); // host(lower) → ip
    records.forEach(function (rec) {
      if (rec.type === TYPE_A && rec.parsed) {
        hostA.set(rec.name.toLowerCase(), rec.parsed);
      }
    });
    var out = [];
    instances.forEach(function (v) {
      var ip = null;
      if (v.srv && v.srv.target) {
        ip = hostA.get(v.srv.target.toLowerCase()) || null;
      }
      out.push({
        instance: v.instance,
        serviceType: v.svcType,
        host: v.srv ? v.srv.target : "",
        ip: ip,
        port: v.srv ? v.srv.port : 0,
        txt: v.txt || {},
        ttl: v.ttl,
      });
    });
    return out;
  }

  _onMessage(msg) {
    var parsed;
    try {
      parsed = parseResponse(msg);
    } catch (e) {
      return;
    }
    if (!parsed) return;
    var services = this._assembleFromRecords(parsed.records);
    if (services.length === 0) return;
    var self = this;
    services.forEach(function (info) {
      var key = info.instance.toLowerCase();
      if (info.ttl === 0) {
        // 临终广播
        if (self.cache.has(key)) {
          self.cache.delete(key);
          self.emit("removed", info);
        }
        return;
      }
      // 不完整的 (缺 ip 或 port) 仍缓存, 让周期重查补齐
      info.lastSeen = Date.now();
      var prev = self.cache.get(key);
      self.cache.set(key, info);
      var changed =
        !prev ||
        prev.ip !== info.ip ||
        prev.port !== info.port ||
        prev.host !== info.host;
      if (changed && info.ip && info.port) {
        self.emit("service", info);
      }
    });
  }

  _query() {
    if (!this.sock) return;
    var self = this;
    this.serviceTypes.forEach(function (svc) {
      try {
        var msg = buildQuery(svc, TYPE_PTR);
        self.sock.send(msg, 0, msg.length, MDNS_PORT, MDNS_ADDR_V4);
      } catch (e) {
        self._log("query " + svc + " err: " + e.message);
      }
    });
  }

  _reapStale() {
    var now = Date.now();
    var self = this;
    var expired = [];
    this.cache.forEach(function (v, k) {
      if (now - (v.lastSeen || 0) > STALE_MS) expired.push([k, v]);
    });
    expired.forEach(function (pair) {
      self.cache.delete(pair[0]);
      self.emit("removed", pair[1]);
    });
  }

  start() {
    if (this.sock) return;
    var self = this;
    var sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.sock = sock;
    sock.on("error", function (err) {
      self._log("socket err: " + err.message + " (继续运行)");
    });
    sock.on("message", function (msg) {
      self._onMessage(msg);
    });
    sock.bind(MDNS_PORT, function () {
      try {
        sock.setMulticastTTL(255);
        sock.setMulticastLoopback(true); // 环回 (便于与本机 advertiser 联动)
        if (typeof sock.unref === "function") sock.unref(); // 不阻塞 event loop
        var nets = os.networkInterfaces();
        Object.keys(nets).forEach(function (name) {
          (nets[name] || []).forEach(function (iface) {
            if (iface.family !== "IPv4" || iface.internal) return;
            try {
              sock.addMembership(MDNS_ADDR_V4, iface.address);
            } catch (e) {}
          });
        });
        self._log(
          "扫描: [" +
            self.serviceTypes.join(", ") +
            "] 每 " +
            Math.round(self.queryInterval / 1000) +
            "s 一次",
        );
        self._query();
        self.queryTimer = setInterval(function () {
          self._query();
        }, self.queryInterval);
        if (self.queryTimer.unref) self.queryTimer.unref();
        self.staleTimer = setInterval(function () {
          self._reapStale();
        }, 60 * 1000);
        if (self.staleTimer.unref) self.staleTimer.unref();
      } catch (e) {
        self._log("bind 后初始化失败: " + e.message);
      }
    });
  }

  stop() {
    if (this.queryTimer) {
      clearInterval(this.queryTimer);
      this.queryTimer = null;
    }
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    if (this.sock) {
      try {
        this.sock.close();
      } catch (e) {}
      this.sock = null;
    }
    this.cache.clear();
  }

  services() {
    var out = [];
    this.cache.forEach(function (v) {
      out.push(v);
    });
    return out;
  }
}

module.exports = {
  DaoMdns,
  DaoMdnsBrowser,
  MDNS_ADDR_V4,
  MDNS_PORT,
  // 导出内部解码器 (便于测试 + 复用)
  _buildQuery: buildQuery,
  _parseResponse: parseResponse,
  _writeRR: writeRR,
  _writeName: writeName,
  _rdataA: rdataA,
  _rdataPTR: rdataPTR,
  _rdataSRV: rdataSRV,
  _rdataTXT: rdataTXT,
  _buildResponse: buildResponse,
  TYPE_A: TYPE_A,
  TYPE_PTR: TYPE_PTR,
  TYPE_SRV: TYPE_SRV,
  TYPE_TXT: TYPE_TXT,
  CLASS_IN: CLASS_IN,
};
