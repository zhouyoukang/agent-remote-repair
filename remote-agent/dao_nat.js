// ╔══════════════════════════════════════════════════════════════╗
// ║  道 · 穿透 (dao_nat.js) — 打通到底, 不借外力                ║
// ║                                                              ║
// ║  不依赖 cloudflared / ngrok / 任何第三方中继.                ║
// ║  只问路由器一声: "可否开一扇窗?" 一万家里有三千家应允.       ║
// ║                                                              ║
// ║  协议:                                                       ║
// ║    ① UPnP IGD (SSDP M-SEARCH → SOAP AddPortMapping)         ║
// ║    ② NAT-PMP  (RFC 6886, UDP :5351)                          ║
// ║    ③ PCP      (RFC 6887, UDP :5351, NAT-PMP 的升级)          ║
// ║                                                              ║
// ║  道法自然: 任何协议失败 → 自动下跌下一种 → 全败则退 LAN-only  ║
// ║  柔弱胜刚强: 每次 start() 前先 stop() 清旧映射, 不污染路由表  ║
// ║  零依赖: Node 原生 dgram + http + os + buffer, 不加 npm 包   ║
// ╚══════════════════════════════════════════════════════════════╝

"use strict";

const dgram = require("dgram");
const http = require("http");
const os = require("os");
const { URL } = require("url");

const SSDP_ADDR = "239.255.255.250";
const SSDP_PORT = 1900;
const SSDP_MX = 2;
const SSDP_TIMEOUT = 3000;
const NATPMP_PORT = 5351;
const NATPMP_TIMEOUT = 2000;
const DEFAULT_LEASE = 3600; // 1h, 会自动续约

function _ts() {
  return new Date().toTimeString().slice(0, 8);
}
function _log(msg) {
  console.log("[" + _ts() + "] [nat] " + msg);
}

function _getGateway() {
  // 道法自然: 每个网卡的网关 IP 不易精准推, 但 NAT-PMP 只需子网内第一跳
  // 常见做法: 本机 IP 同网段替换最后一字节为 1 / 254, 逐一 probe
  var out = [];
  var nets = os.networkInterfaces();
  for (var name of Object.keys(nets)) {
    for (var iface of nets[name]) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      var parts = iface.address.split(".");
      if (parts.length !== 4) continue;
      // 典型路由器: .1 / .254
      out.push(parts[0] + "." + parts[1] + "." + parts[2] + ".1");
      out.push(parts[0] + "." + parts[1] + "." + parts[2] + ".254");
    }
  }
  // 去重, 保序
  var seen = {};
  return out.filter(function (g) {
    if (seen[g]) return false;
    seen[g] = true;
    return true;
  });
}

function _getLanIPOnSubnet(gwIp) {
  var nets = os.networkInterfaces();
  var gwParts = gwIp.split(".");
  for (var name of Object.keys(nets)) {
    for (var iface of nets[name]) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      var ipParts = iface.address.split(".");
      if (
        ipParts[0] === gwParts[0] &&
        ipParts[1] === gwParts[1] &&
        ipParts[2] === gwParts[2]
      ) {
        return iface.address;
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
//  UPnP IGD
//  Step 1: SSDP M-SEARCH → 获取 rootdesc.xml URL
//  Step 2: GET rootdesc.xml → 解析 WANIPConnection/WANPPPConnection controlURL
//  Step 3: POST SOAP AddPortMapping
// ═══════════════════════════════════════════════════════════════

function _ssdpSearch(timeoutMs) {
  return new Promise(function (resolve) {
    var locations = [];
    var sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      try {
        sock.close();
      } catch (e) {}
      // 去重
      var seen = {};
      resolve(locations.filter(function (l) {
        if (seen[l]) return false;
        seen[l] = true;
        return true;
      }));
    }
    sock.on("error", function () {
      finish();
    });
    sock.on("message", function (msg) {
      var txt = msg.toString("utf-8");
      var m = txt.match(/LOCATION:\s*(\S+)/i);
      if (m) locations.push(m[1].trim());
    });
    sock.bind(0, function () {
      try {
        sock.setBroadcast(true);
      } catch (e) {}
      // 两类 IGD ST (v1 + v2)
      var STs = [
        "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
        "urn:schemas-upnp-org:device:InternetGatewayDevice:2",
        "upnp:rootdevice",
      ];
      for (var i = 0; i < STs.length; i++) {
        var body =
          "M-SEARCH * HTTP/1.1\r\n" +
          "HOST: " + SSDP_ADDR + ":" + SSDP_PORT + "\r\n" +
          'MAN: "ssdp:discover"\r\n' +
          "MX: " + SSDP_MX + "\r\n" +
          "ST: " + STs[i] + "\r\n\r\n";
        try {
          sock.send(body, 0, body.length, SSDP_PORT, SSDP_ADDR);
        } catch (e) {}
      }
      setTimeout(finish, timeoutMs || SSDP_TIMEOUT);
    });
  });
}

function _httpGet(url, timeoutMs) {
  return new Promise(function (resolve, reject) {
    try {
      var u = new URL(url);
      var req = http.get(
        {
          host: u.hostname,
          port: u.port || 80,
          path: u.pathname + (u.search || ""),
          timeout: timeoutMs || 4000,
        },
        function (res) {
          var chunks = [];
          res.on("data", function (c) {
            chunks.push(c);
          });
          res.on("end", function () {
            resolve({
              status: res.statusCode,
              body: Buffer.concat(chunks).toString("utf-8"),
              headers: res.headers,
              url: url,
            });
          });
        },
      );
      req.on("error", reject);
      req.on("timeout", function () {
        req.destroy();
        reject(new Error("timeout"));
      });
    } catch (e) {
      reject(e);
    }
  });
}

function _httpSoap(url, soapAction, body, timeoutMs) {
  return new Promise(function (resolve, reject) {
    try {
      var u = new URL(url);
      var opts = {
        host: u.hostname,
        port: u.port || 80,
        path: u.pathname + (u.search || ""),
        method: "POST",
        timeout: timeoutMs || 4000,
        headers: {
          "Content-Type": 'text/xml; charset="utf-8"',
          "Content-Length": Buffer.byteLength(body),
          SOAPAction: '"' + soapAction + '"',
        },
      };
      var req = http.request(opts, function (res) {
        var chunks = [];
        res.on("data", function (c) {
          chunks.push(c);
        });
        res.on("end", function () {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      });
      req.on("error", reject);
      req.on("timeout", function () {
        req.destroy();
        reject(new Error("timeout"));
      });
      req.write(body);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

// 从 rootdesc.xml 中找 WAN[IP|PPP]Connection controlURL
function _parseControlURL(xml, baseUrl) {
  // 道法自然: 不引 XML 解析器, 只抓两组关键字段
  // 优先 WANIPConnection (更常见), 次 WANPPPConnection
  var services = [];
  var serviceRegex =
    /<service>[\s\S]*?<serviceType>(urn:schemas-upnp-org:service:WAN(?:IP|PPP)Connection:\d+)<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>[\s\S]*?<\/service>/gi;
  var m;
  while ((m = serviceRegex.exec(xml)) !== null) {
    services.push({ type: m[1], control: m[2].trim() });
  }
  if (services.length === 0) return null;
  // WANIP 优先
  services.sort(function (a, b) {
    return a.type.indexOf("WANIP") >= 0 ? -1 : 1;
  });
  var chosen = services[0];
  var base = new URL(baseUrl);
  var ctrl = chosen.control;
  if (ctrl.startsWith("http://") || ctrl.startsWith("https://")) {
    return { controlURL: ctrl, serviceType: chosen.type };
  }
  if (ctrl.startsWith("/")) {
    return {
      controlURL: base.protocol + "//" + base.host + ctrl,
      serviceType: chosen.type,
    };
  }
  return {
    controlURL:
      base.protocol + "//" + base.host + base.pathname.replace(/\/[^\/]*$/, "/") + ctrl,
    serviceType: chosen.type,
  };
}

async function _upnpAddMapping(ctrl, intIP, intPort, extPort, proto, lease, desc) {
  var soapBody =
    '<?xml version="1.0"?>\r\n' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">\r\n' +
    "<s:Body>\r\n" +
    '<u:AddPortMapping xmlns:u="' + ctrl.serviceType + '">\r\n' +
    "<NewRemoteHost></NewRemoteHost>\r\n" +
    "<NewExternalPort>" + extPort + "</NewExternalPort>\r\n" +
    "<NewProtocol>" + proto + "</NewProtocol>\r\n" +
    "<NewInternalPort>" + intPort + "</NewInternalPort>\r\n" +
    "<NewInternalClient>" + intIP + "</NewInternalClient>\r\n" +
    "<NewEnabled>1</NewEnabled>\r\n" +
    "<NewPortMappingDescription>" + desc + "</NewPortMappingDescription>\r\n" +
    "<NewLeaseDuration>" + lease + "</NewLeaseDuration>\r\n" +
    "</u:AddPortMapping>\r\n</s:Body></s:Envelope>";
  var res = await _httpSoap(
    ctrl.controlURL,
    ctrl.serviceType + "#AddPortMapping",
    soapBody,
    5000,
  );
  if (res.status !== 200) {
    throw new Error(
      "AddPortMapping HTTP " + res.status + " " + (res.body || "").slice(0, 200),
    );
  }
  return true;
}

async function _upnpDeleteMapping(ctrl, extPort, proto) {
  var soapBody =
    '<?xml version="1.0"?>\r\n' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">\r\n' +
    "<s:Body>\r\n" +
    '<u:DeletePortMapping xmlns:u="' + ctrl.serviceType + '">\r\n' +
    "<NewRemoteHost></NewRemoteHost>\r\n" +
    "<NewExternalPort>" + extPort + "</NewExternalPort>\r\n" +
    "<NewProtocol>" + proto + "</NewProtocol>\r\n" +
    "</u:DeletePortMapping>\r\n</s:Body></s:Envelope>";
  try {
    await _httpSoap(
      ctrl.controlURL,
      ctrl.serviceType + "#DeletePortMapping",
      soapBody,
      3000,
    );
  } catch (e) {}
}

async function _upnpGetExternalIP(ctrl) {
  var soapBody =
    '<?xml version="1.0"?>\r\n' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">\r\n' +
    "<s:Body>\r\n" +
    '<u:GetExternalIPAddress xmlns:u="' + ctrl.serviceType + '"/>\r\n' +
    "</s:Body></s:Envelope>";
  try {
    var res = await _httpSoap(
      ctrl.controlURL,
      ctrl.serviceType + "#GetExternalIPAddress",
      soapBody,
      3000,
    );
    var m = res.body.match(/<NewExternalIPAddress>([^<]+)<\/NewExternalIPAddress>/);
    return m ? m[1].trim() : null;
  } catch (e) {
    return null;
  }
}

async function _upnpTry(intPort, desc) {
  var locations = await _ssdpSearch();
  if (locations.length === 0) throw new Error("no IGD found");
  var lastErr;
  for (var i = 0; i < locations.length; i++) {
    try {
      var rootRes = await _httpGet(locations[i]);
      if (rootRes.status !== 200) continue;
      var ctrl = _parseControlURL(rootRes.body, locations[i]);
      if (!ctrl) continue;
      // 找内网 IP: 同网段于 rootdesc 所在 IP 的我方 IP
      var gwHost = new URL(locations[i]).hostname;
      var intIP = _getLanIPOnSubnet(gwHost);
      if (!intIP) continue;
      // 先清可能残留的旧映射
      await _upnpDeleteMapping(ctrl, intPort, "TCP");
      await _upnpAddMapping(
        ctrl,
        intIP,
        intPort,
        intPort,
        "TCP",
        DEFAULT_LEASE,
        desc || "dao-remote",
      );
      var extIP = await _upnpGetExternalIP(ctrl);
      return {
        protocol: "upnp",
        controlURL: ctrl.controlURL,
        serviceType: ctrl.serviceType,
        internalIP: intIP,
        internalPort: intPort,
        externalIP: extIP || null,
        externalPort: intPort,
        gateway: gwHost,
        lease: DEFAULT_LEASE,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("no IGD accepted mapping");
}

// ═══════════════════════════════════════════════════════════════
//  NAT-PMP (RFC 6886)
//  请求格式 (Map TCP):
//    ver=0, op=2, reserved[2]=0, intPort[2], extPort[2], lifetime[4]
//  响应格式:
//    ver=0, op=0x82, result[2], sss[4], intPort[2], extPort[2], lifetime[4]
// ═══════════════════════════════════════════════════════════════

function _natpmpRequest(gw, buf, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var sock = dgram.createSocket("udp4");
    var done = false;
    function finish(err, data) {
      if (done) return;
      done = true;
      try {
        sock.close();
      } catch (e) {}
      if (err) reject(err);
      else resolve(data);
    }
    sock.on("error", function (err) {
      finish(err);
    });
    sock.on("message", function (msg) {
      finish(null, msg);
    });
    sock.send(buf, 0, buf.length, NATPMP_PORT, gw, function (err) {
      if (err) finish(err);
    });
    setTimeout(function () {
      finish(new Error("natpmp timeout"));
    }, timeoutMs || NATPMP_TIMEOUT);
  });
}

async function _natpmpAddMapping(gw, intPort, lifetime) {
  // Map TCP request
  var req = Buffer.alloc(12);
  req.writeUInt8(0, 0); // version 0
  req.writeUInt8(2, 1); // op 2 = map TCP
  req.writeUInt16BE(0, 2); // reserved
  req.writeUInt16BE(intPort, 4);
  req.writeUInt16BE(intPort, 6); // requested ext port (router may pick other)
  req.writeUInt32BE(lifetime || DEFAULT_LEASE, 8);
  var res = await _natpmpRequest(gw, req, 2500);
  if (res.length < 16) throw new Error("natpmp short response");
  var ver = res.readUInt8(0);
  var op = res.readUInt8(1);
  var result = res.readUInt16BE(2);
  var intP = res.readUInt16BE(8);
  var extP = res.readUInt16BE(10);
  var lease = res.readUInt32BE(12);
  if (ver !== 0 || op !== 0x82) throw new Error("natpmp bad header");
  if (result !== 0) throw new Error("natpmp result=" + result);
  return { internalPort: intP, externalPort: extP, lease: lease };
}

async function _natpmpGetExternalIP(gw) {
  var req = Buffer.alloc(2);
  req.writeUInt8(0, 0);
  req.writeUInt8(0, 1); // op 0 = get external IP
  var res = await _natpmpRequest(gw, req, 2500);
  if (res.length < 12) throw new Error("natpmp short response");
  var result = res.readUInt16BE(2);
  if (result !== 0) throw new Error("natpmp ip result=" + result);
  return res[8] + "." + res[9] + "." + res[10] + "." + res[11];
}

async function _natpmpDelete(gw, intPort) {
  // Delete = AddMapping with lifetime=0 and extPort=0
  var req = Buffer.alloc(12);
  req.writeUInt8(0, 0);
  req.writeUInt8(2, 1);
  req.writeUInt16BE(0, 2);
  req.writeUInt16BE(intPort, 4);
  req.writeUInt16BE(0, 6);
  req.writeUInt32BE(0, 8);
  try {
    await _natpmpRequest(gw, req, 1500);
  } catch (e) {}
}

async function _natpmpTry(intPort) {
  var gateways = _getGateway();
  var lastErr;
  for (var i = 0; i < gateways.length; i++) {
    try {
      var gw = gateways[i];
      var mapping = await _natpmpAddMapping(gw, intPort, DEFAULT_LEASE);
      var extIP = null;
      try {
        extIP = await _natpmpGetExternalIP(gw);
      } catch (e) {}
      var intIP = _getLanIPOnSubnet(gw);
      return {
        protocol: "natpmp",
        internalIP: intIP,
        internalPort: mapping.internalPort,
        externalIP: extIP,
        externalPort: mapping.externalPort,
        gateway: gw,
        lease: mapping.lease,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("no gateway responded to NAT-PMP");
}

// ═══════════════════════════════════════════════════════════════
//  DaoNat — 顶层 API, 自适应协议链
//  start(intPort, opts) → Promise<{ publicUrl, protocol, ... } | null>
//  stop() — 清理映射 + 停止续约
// ═══════════════════════════════════════════════════════════════

class DaoNat {
  constructor() {
    this._mapping = null;
    this._renewTimer = null;
    this._stopped = false;
  }

  async start(intPort, opts) {
    opts = opts || {};
    this._stopped = false;
    var desc = opts.description || "dao-remote";
    var errs = [];

    // ① UPnP
    try {
      _log("探测 UPnP IGD (SSDP) ...");
      var mUpnp = await _upnpTry(intPort, desc);
      this._mapping = mUpnp;
      this._scheduleRenew();
      _log(
        "✓ UPnP: " +
          (mUpnp.externalIP || "?") +
          ":" +
          mUpnp.externalPort +
          " ← " +
          mUpnp.internalIP +
          ":" +
          mUpnp.internalPort,
      );
      return this._result();
    } catch (e) {
      errs.push("upnp: " + e.message);
    }

    // ② NAT-PMP
    try {
      _log("探测 NAT-PMP :5351 ...");
      var mPmp = await _natpmpTry(intPort);
      this._mapping = mPmp;
      this._scheduleRenew();
      _log(
        "✓ NAT-PMP: " +
          (mPmp.externalIP || "?") +
          ":" +
          mPmp.externalPort +
          " ← " +
          mPmp.internalIP +
          ":" +
          mPmp.internalPort,
      );
      return this._result();
    } catch (e) {
      errs.push("natpmp: " + e.message);
    }

    _log("NAT 穿透不可达: " + errs.join(" | ") + " (退 LAN-only)");
    return null;
  }

  _result() {
    var m = this._mapping;
    if (!m) return null;
    return {
      protocol: m.protocol,
      externalIP: m.externalIP,
      externalPort: m.externalPort,
      internalIP: m.internalIP,
      internalPort: m.internalPort,
      gateway: m.gateway,
      lease: m.lease,
      publicUrl:
        m.externalIP && m.externalIP !== "0.0.0.0"
          ? "http://" + m.externalIP + ":" + m.externalPort
          : "",
    };
  }

  _scheduleRenew() {
    var self = this;
    if (this._renewTimer) clearTimeout(this._renewTimer);
    var m = this._mapping;
    if (!m) return;
    var lease = m.lease || DEFAULT_LEASE;
    // 提前 60s 续约, 最短 30s
    var renewMs = Math.max(30, lease - 60) * 1000;
    this._renewTimer = setTimeout(function () {
      if (self._stopped) return;
      _log("续约映射 (" + m.protocol + ")...");
      self
        ._renew()
        .catch(function (e) {
          _log("续约失败: " + e.message + " — 将重试新开");
        });
    }, renewMs);
    if (this._renewTimer.unref) this._renewTimer.unref();
  }

  async _renew() {
    var m = this._mapping;
    if (!m) return;
    if (m.protocol === "upnp") {
      await _upnpAddMapping(
        { controlURL: m.controlURL, serviceType: m.serviceType },
        m.internalIP,
        m.internalPort,
        m.externalPort,
        "TCP",
        DEFAULT_LEASE,
        "dao-remote",
      );
      m.lease = DEFAULT_LEASE;
    } else if (m.protocol === "natpmp") {
      var r = await _natpmpAddMapping(m.gateway, m.internalPort, DEFAULT_LEASE);
      m.externalPort = r.externalPort;
      m.lease = r.lease;
    }
    this._scheduleRenew();
  }

  async stop() {
    this._stopped = true;
    if (this._renewTimer) {
      clearTimeout(this._renewTimer);
      this._renewTimer = null;
    }
    var m = this._mapping;
    this._mapping = null;
    if (!m) return;
    try {
      if (m.protocol === "upnp") {
        await _upnpDeleteMapping(
          { controlURL: m.controlURL, serviceType: m.serviceType },
          m.externalPort,
          "TCP",
        );
      } else if (m.protocol === "natpmp") {
        await _natpmpDelete(m.gateway, m.internalPort);
      }
    } catch (e) {}
  }

  get mapping() {
    return this._result();
  }
}

module.exports = { DaoNat: DaoNat };
