// mDNS 查询器 — 向 224.0.0.251:5353 发 PTR 查询, 看谁响应
// node _test_mdns.js
"use strict";
const dgram = require("dgram");

function writeName(name) {
  var parts = name.replace(/\.$/, "").split(".");
  var total = 1;
  for (var i = 0; i < parts.length; i++) total += 1 + parts[i].length;
  var buf = Buffer.alloc(total);
  var off = 0;
  for (var j = 0; j < parts.length; j++) {
    var p = parts[j];
    buf.writeUInt8(p.length, off++);
    buf.write(p, off, p.length, "utf8");
    off += p.length;
  }
  buf.writeUInt8(0, off);
  return buf;
}
function buildQuery(name, type) {
  var hdr = Buffer.alloc(12);
  hdr.writeUInt16BE(Math.floor(Math.random() * 65535), 0);
  hdr.writeUInt16BE(0x0000, 2); // QR=0 (query)
  hdr.writeUInt16BE(1, 4); // qdcount=1
  var nm = writeName(name);
  var qfoot = Buffer.alloc(4);
  qfoot.writeUInt16BE(type, 0); // qtype
  qfoot.writeUInt16BE(1, 2); // qclass IN
  return Buffer.concat([hdr, nm, qfoot]);
}

function parseName(buf, offset) {
  var labels = [];
  var orig = offset;
  var jumped = false;
  var safety = 0;
  while (safety++ < 64) {
    if (offset >= buf.length) return null;
    var len = buf.readUInt8(offset);
    if (len === 0) {
      if (!jumped) orig = offset + 1;
      return { name: labels.join("."), nextOffset: orig };
    }
    if ((len & 0xc0) === 0xc0) {
      if (!jumped) orig = offset + 2;
      offset = ((len & 0x3f) << 8) | buf.readUInt8(offset + 1);
      jumped = true;
      continue;
    }
    labels.push(buf.slice(offset + 1, offset + 1 + len).toString("utf8"));
    offset += 1 + len;
  }
  return null;
}

var sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
var found = [];

sock.on("message", function (msg, rinfo) {
  if (msg.length < 12) return;
  var flags = msg.readUInt16BE(2);
  if ((flags & 0x8000) === 0) return; // 只要响应
  var ancount = msg.readUInt16BE(6);
  if (ancount === 0) return;

  // 跳过 qdcount questions
  var off = 12;
  var qdcount = msg.readUInt16BE(4);
  for (var q = 0; q < qdcount; q++) {
    var qr = parseName(msg, off);
    if (!qr) return;
    off = qr.nextOffset + 4;
  }
  // 解 answers
  for (var i = 0; i < ancount && off < msg.length; i++) {
    var nr = parseName(msg, off);
    if (!nr) break;
    off = nr.nextOffset;
    if (off + 10 > msg.length) break;
    var type = msg.readUInt16BE(off);
    var klass = msg.readUInt16BE(off + 2) & 0x7fff;
    var ttl = msg.readUInt32BE(off + 4);
    var rdlen = msg.readUInt16BE(off + 8);
    off += 10;
    var rdata = msg.slice(off, off + rdlen);
    off += rdlen;

    var typeStr =
      { 1: "A", 12: "PTR", 16: "TXT", 33: "SRV" }[type] || "T" + type;
    var rdataStr = "";
    if (type === 1 && rdlen === 4) {
      rdataStr = rdata[0] + "." + rdata[1] + "." + rdata[2] + "." + rdata[3];
    } else if (type === 12) {
      var pr = parseName(msg, off - rdlen);
      rdataStr = pr ? pr.name : "?";
    } else if (type === 33) {
      var prio = rdata.readUInt16BE(0);
      var weight = rdata.readUInt16BE(2);
      var port = rdata.readUInt16BE(4);
      var tr = parseName(msg, off - rdlen + 6);
      rdataStr =
        "prio=" +
        prio +
        " weight=" +
        weight +
        " port=" +
        port +
        " target=" +
        (tr ? tr.name : "?");
    } else if (type === 16) {
      var txtOut = [];
      var tp = 0;
      while (tp < rdlen) {
        var tl = rdata.readUInt8(tp);
        txtOut.push(rdata.slice(tp + 1, tp + 1 + tl).toString("utf8"));
        tp += 1 + tl;
      }
      rdataStr = txtOut.join(" | ");
    } else {
      rdataStr = rdata.toString("hex").slice(0, 32);
    }

    // 过滤只看 dao-* 的记录
    if (nr.name.indexOf("dao-") >= 0 || nr.name.indexOf("_dao._tcp") >= 0) {
      found.push({
        from: rinfo.address,
        name: nr.name,
        type: typeStr,
        ttl: ttl,
        rdata: rdataStr,
      });
    }
  }
});

sock.bind(5353, function () {
  try {
    sock.setMulticastTTL(255);
    sock.setMulticastLoopback(true);
    const os = require("os");
    var nets = os.networkInterfaces();
    Object.keys(nets).forEach(function (name) {
      (nets[name] || []).forEach(function (iface) {
        if (iface.family !== "IPv4" || iface.internal) return;
        try {
          sock.addMembership("224.0.0.251", iface.address);
        } catch (e) {}
      });
    });
  } catch (e) {
    console.log("[query!] multicast setup: " + e.message);
  }
  var q = buildQuery("_dao._tcp.local", 12);
  sock.send(q, 0, q.length, 5353, "224.0.0.251");
  console.log("[query] _dao._tcp.local PTR → 224.0.0.251:5353");
});

setTimeout(function () {
  console.log("\n[found " + found.length + " records in 2s]");
  for (var i = 0; i < found.length; i++) {
    var f = found[i];
    console.log(
      "  " +
        f.type.padEnd(4) +
        " " +
        f.name +
        " " +
        "→ " +
        f.rdata +
        " (ttl=" +
        f.ttl +
        "s from=" +
        f.from +
        ")",
    );
  }
  sock.close();
  process.exit(found.length > 0 ? 0 : 1);
}, 2000);
