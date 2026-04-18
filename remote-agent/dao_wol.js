// ╔══════════════════════════════════════════════════════════════╗
// ║  道 · Wake-on-LAN — 一气吹醒万物                             ║
// ║                                                              ║
// ║  柔弱胜刚强: 六字节 0xFF + MAC×16 = 102 字节魔法包            ║
// ║  无依赖 · 纯 Node dgram · 同网段任意网卡广播                  ║
// ╚══════════════════════════════════════════════════════════════╝

const dgram = require("dgram");
const os = require("os");

// 将 "AA:BB:CC:DD:EE:FF" / "AA-BB-..." / "AABBCCDDEEFF" 统一为 6 字节 Buffer
function parseMac(mac) {
  if (!mac) return null;
  var hex = String(mac).replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 12) return null;
  var buf = Buffer.alloc(6);
  for (var i = 0; i < 6; i++) {
    buf[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return buf;
}

function buildMagicPacket(mac) {
  var macBuf = parseMac(mac);
  if (!macBuf) throw new Error("invalid MAC: " + mac);
  var packet = Buffer.alloc(6 + 16 * 6);
  packet.fill(0xff, 0, 6);
  for (var i = 0; i < 16; i++) macBuf.copy(packet, 6 + i * 6);
  return packet;
}

// 返回所有 LAN IPv4 网段的广播地址 — 万法归宗: 不止 255.255.255.255, 还按网段算定向广播
function lanBroadcasts() {
  var out = [];
  var nets = os.networkInterfaces();
  for (var name of Object.keys(nets)) {
    for (var iface of nets[name]) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      var bc = ipv4Broadcast(iface.address, iface.netmask);
      if (bc && out.indexOf(bc) < 0) out.push(bc);
    }
  }
  // 兜底: 全网广播
  if (out.indexOf("255.255.255.255") < 0) out.push("255.255.255.255");
  return out;
}

function ipv4Broadcast(ip, mask) {
  try {
    var a = ip.split(".").map(Number);
    var m = mask.split(".").map(Number);
    if (a.length !== 4 || m.length !== 4) return null;
    var b = [0, 0, 0, 0];
    for (var i = 0; i < 4; i++) b[i] = (a[i] & m[i]) | (~m[i] & 0xff);
    return b.join(".");
  } catch (e) {
    return null;
  }
}

// 发送 WoL 魔法包 — 默认向本机所有 LAN 网段 + 0.255.255.255 广播, 端口 9 (备 7)
// opts.broadcast 可覆盖目标地址 (string 或 array), opts.ports 默认 [9, 7]
function wake(mac, opts) {
  opts = opts || {};
  var packet = buildMagicPacket(mac);
  var targets = opts.broadcast
    ? Array.isArray(opts.broadcast)
      ? opts.broadcast
      : [opts.broadcast]
    : lanBroadcasts();
  var ports = opts.ports || [9, 7];
  return new Promise(function (resolve, reject) {
    var sock = dgram.createSocket("udp4");
    var pending = 0;
    var errors = [];
    sock.on("error", function (e) {
      errors.push(e.message);
    });
    sock.bind(0, function () {
      try {
        sock.setBroadcast(true);
      } catch (e) {
        errors.push("setBroadcast: " + e.message);
      }
      for (var ti = 0; ti < targets.length; ti++) {
        for (var pi = 0; pi < ports.length; pi++) {
          pending++;
          sock.send(
            packet,
            0,
            packet.length,
            ports[pi],
            targets[ti],
            // eslint-disable-next-line no-loop-func
            function (err) {
              if (err) errors.push(err.message);
              if (--pending === 0) {
                sock.close();
                resolve({
                  ok: errors.length === 0,
                  targets: targets,
                  ports: ports,
                  bytes: packet.length,
                  errors: errors,
                });
              }
            },
          );
        }
      }
      if (pending === 0) {
        sock.close();
        resolve({ ok: false, targets: targets, ports: ports, errors: errors });
      }
    });
  });
}

module.exports = {
  wake: wake,
  parseMac: parseMac,
  buildMagicPacket: buildMagicPacket,
  lanBroadcasts: lanBroadcasts,
  ipv4Broadcast: ipv4Broadcast,
};
