// 道 · 无为之测 — 不启动任何 socket, 只验证模块可加载 + 核心 API 正确
// node _test_wuwei.js

"use strict";

const assert = require("assert");
const path = require("path");
const os = require("os");

var okCount = 0;
var failCount = 0;
var pending = []; // 异步测试 Promise 队列 — 在总结前统一 await

function ok(name, fn) {
  try {
    var r = fn();
    if (r && typeof r.then === "function") {
      pending.push(
        r.then(
          function () {
            console.log("  \u2713 " + name);
            okCount++;
          },
          function (e) {
            console.log(
              "  \u2717 " + name + "\n      " + (e && e.stack ? e.stack : e),
            );
            failCount++;
          },
        ),
      );
      return;
    }
    console.log("  \u2713 " + name);
    okCount++;
  } catch (e) {
    console.log("  \u2717 " + name + "\n      " + (e && e.stack ? e.stack : e));
    failCount++;
  }
}

console.log("\n[1] dao_kernel \u00b7 DaoIdentity.serviceToken");
const { DaoKernel, DaoIdentity } = require("./dao_kernel");
// 注: 这里临时改 HOME 到 tmp 目录, 防止污染用户身份
var tmpDir = path.join(os.tmpdir(), "dao-test-" + Date.now());
var id = new DaoIdentity(tmpDir);

ok("serviceToken 生成 32 位 hex", function () {
  var t = id.serviceToken("adb_hub");
  assert.strictEqual(typeof t, "string");
  assert.strictEqual(t.length, 32);
  assert.ok(/^[0-9a-f]{32}$/.test(t), "not hex: " + t);
});

ok("serviceToken 跨调用确定性 (Ed25519 RFC 8032)", function () {
  var a = id.serviceToken("adb_hub");
  var b = id.serviceToken("adb_hub");
  assert.strictEqual(a, b);
});

ok("serviceToken 不同服务得不同令牌", function () {
  var a = id.serviceToken("adb_hub");
  var b = id.serviceToken("relay");
  assert.notStrictEqual(a, b);
});

ok("serviceToken 自定义长度", function () {
  var t = id.serviceToken("x", 16);
  assert.strictEqual(t.length, 16);
});

ok("serviceToken 无 service 抛异常", function () {
  assert.throws(function () {
    id.serviceToken("");
  });
});

console.log("\n[2] dao_pair \u00b7 URI + QR encoding");
const daoPair = require("./remote-agent/dao_pair");

ok("buildPairUri 正确封装", function () {
  var uri = daoPair.buildPairUri({
    fingerprint: "abc123",
    token: "token.here",
    port: 3002,
    ips: ["192.168.1.5", "10.0.0.1"],
    publicUrl: "https://a.trycloudflare.com",
  });
  assert.ok(uri.startsWith("dao://abc123/token.here?"));
  assert.ok(uri.indexOf("v=1") >= 0);
  assert.ok(uri.indexOf("p=3002") >= 0);
  assert.ok(uri.indexOf(encodeURIComponent("192.168.1.5,10.0.0.1")) >= 0);
});

ok("parsePairUri 往返", function () {
  var uri = daoPair.buildPairUri({
    fingerprint: "fp",
    token: "tk",
    port: 3002,
    ips: ["1.2.3.4"],
    publicUrl: "https://x.y/z",
    expiresAt: 1234567,
  });
  var p = daoPair.parsePairUri(uri);
  assert.strictEqual(p.fingerprint, "fp");
  assert.strictEqual(p.token, "tk");
  assert.strictEqual(p.port, 3002);
  assert.deepStrictEqual(p.ips, ["1.2.3.4"]);
  assert.strictEqual(p.publicUrl, "https://x.y/z");
  assert.strictEqual(p.expiresAt, 1234567);
});

ok("parsePairUri 非法返回 null", function () {
  assert.strictEqual(daoPair.parsePairUri(""), null);
  assert.strictEqual(daoPair.parsePairUri("http://a.b"), null);
});

ok("qrFromText 字节模式编码 (ECC-L)", function () {
  var sample = "dao://abcdef0123456789/" + "x".repeat(40) + "?v=1&p=3002";
  var qr = daoPair.qrFromText(sample, "L");
  assert.ok(qr && qr.matrix);
  assert.ok(qr.size >= 21 && qr.size <= 57); // v1-v10
  // 三个 finder 图案: 左上/右上/左下 各 7x7 方块
  // 简易验证: 角落中心点是 dark
  assert.strictEqual(qr.matrix[3][3], 1);
  assert.strictEqual(qr.matrix[3][qr.size - 4], 1);
  assert.strictEqual(qr.matrix[qr.size - 4][3], 1);
});

ok("renderAscii 输出非空", function () {
  var qr = daoPair.qrFromText("hello", "L");
  var txt = daoPair.renderAscii(qr);
  assert.ok(typeof txt === "string");
  assert.ok(txt.length > 0);
  assert.ok(txt.indexOf("\u2588") >= 0 || txt.indexOf("\u2580") >= 0);
});

ok("renderSvg 产生 <svg>", function () {
  var qr = daoPair.qrFromText("hello", "L");
  var svg = daoPair.renderSvg(qr, { scale: 4, border: 2 });
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.indexOf("</svg>") > 0);
});

ok("renderPng 产生合法 PNG (magic + IHDR + IEND)", function () {
  var qr = daoPair.qrFromText("hello", "L");
  var png = daoPair.renderPng(qr, { scale: 4, border: 2 });
  assert.ok(Buffer.isBuffer(png));
  // PNG signature
  assert.strictEqual(png[0], 0x89);
  assert.strictEqual(png[1], 0x50);
  assert.strictEqual(png[2], 0x4e);
  assert.strictEqual(png[3], 0x47);
  // 末尾 12 字节 = IEND chunk: [len:4=0][type:4="IEND"][crc:4]
  var tail = png.subarray(png.length - 8, png.length - 4);
  assert.strictEqual(tail.toString(), "IEND");
});

console.log("\n[3] dao_rendezvous \u00b7 beacon / discovery API shape");
const {
  DaoRendezvousBeacon,
  DaoRendezvousDiscovery,
  deriveSigil,
  DAO_MCAST_ADDR,
  DAO_MCAST_PORT,
} = require("./remote-agent/dao_rendezvous");

ok("常量暴露正确", function () {
  assert.strictEqual(DAO_MCAST_ADDR, "239.77.76.75");
  assert.strictEqual(DAO_MCAST_PORT, 7777);
});

ok("deriveSigil 确定性 8 位 hex", function () {
  var s1 = deriveSigil("fingerprint-x");
  var s2 = deriveSigil("fingerprint-x");
  var s3 = deriveSigil("fingerprint-y");
  assert.strictEqual(s1, s2);
  assert.notStrictEqual(s1, s3);
  assert.strictEqual(s1.length, 8);
});

ok("Beacon 可构造 + setter 不抛", function () {
  var b = new DaoRendezvousBeacon({
    fingerprint: "fp1",
    port: 3002,
    publicUrl: "",
    sigil: "00000000",
  });
  b.setPublicUrl("https://x.y/z");
  b.setPort(4000);
  b.setSigil("11111111");
  // 不 start, 不污染 socket
});

ok("Discovery 可构造 + 不 start 时 stop 安全", function () {
  var d = new DaoRendezvousDiscovery({});
  d.stop();
});

console.log(
  "\n[4] dao_nat \u00b7 API shape (\u4e0d\u5b9e\u9645\u8c03\u7f51\u7edc)",
);
const { DaoNat } = require("./remote-agent/dao_nat");
ok("DaoNat 可构造 + mapping 初值 null", function () {
  var n = new DaoNat();
  assert.strictEqual(n.mapping, null);
});

ok("DaoNat.stop() 无映射时安全", async function () {
  var n = new DaoNat();
  await n.stop();
});

console.log("\n[4b] dao_mdns \u00b7 DNS \u6d88\u606f\u7f16\u89e3\u7801");
const { DaoMdns, MDNS_ADDR_V4, MDNS_PORT } = require("./remote-agent/dao_mdns");
ok("常量正确", function () {
  assert.strictEqual(MDNS_ADDR_V4, "224.0.0.251");
  assert.strictEqual(MDNS_PORT, 5353);
});
ok("DaoMdns 构造 · hostName 派生", function () {
  var m = new DaoMdns({
    fingerprint: "abcdef0123456789deadbeef",
    port: 3002,
  });
  assert.strictEqual(m.fp8, "abcdef01");
  assert.strictEqual(m.hostName, "dao-abcdef01.local");
  assert.strictEqual(m.svcName, "dao-abcdef01._dao._tcp.local");
});
ok("DaoMdns.stop() 无 socket 时安全", function () {
  var m = new DaoMdns({ fingerprint: "x", port: 1234 });
  m.stop();
});

console.log("\n[4c] dao_wol \u00b7 Wake-on-LAN \u9b54\u6cd5\u5305");
const daoWol = require("./remote-agent/dao_wol");
ok("parseMac 多种分隔符", function () {
  assert.deepStrictEqual(
    daoWol.parseMac("AA:BB:CC:DD:EE:FF"),
    Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]),
  );
  assert.deepStrictEqual(
    daoWol.parseMac("aa-bb-cc-dd-ee-ff"),
    Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]),
  );
  assert.deepStrictEqual(
    daoWol.parseMac("AABBCCDDEEFF"),
    Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]),
  );
});
ok("parseMac 非法返回 null", function () {
  assert.strictEqual(daoWol.parseMac(""), null);
  assert.strictEqual(daoWol.parseMac("AA:BB"), null);
  assert.strictEqual(daoWol.parseMac("ZZ:BB:CC:DD:EE:FF"), null);
});
ok("buildMagicPacket 102 字节 · 头 6×0xFF + MAC×16", function () {
  var p = daoWol.buildMagicPacket("11:22:33:44:55:66");
  assert.strictEqual(p.length, 102);
  assert.strictEqual(p.slice(0, 6).toString("hex"), "ffffffffffff");
  for (var i = 0; i < 16; i++) {
    assert.strictEqual(
      p.slice(6 + i * 6, 12 + i * 6).toString("hex"),
      "112233445566",
      "MAC repetition #" + i,
    );
  }
});
ok("ipv4Broadcast 经典 /24", function () {
  assert.strictEqual(
    daoWol.ipv4Broadcast("192.168.1.42", "255.255.255.0"),
    "192.168.1.255",
  );
  assert.strictEqual(
    daoWol.ipv4Broadcast("10.0.0.5", "255.0.0.0"),
    "10.255.255.255",
  );
});
ok("lanBroadcasts \u5305\u542b 255.255.255.255 \u5154\u5e95", function () {
  var list = daoWol.lanBroadcasts();
  assert.ok(Array.isArray(list));
  assert.ok(list.indexOf("255.255.255.255") >= 0);
});

console.log("\n[4e] dao_service \u00b7 \u5f00\u673a\u81ea\u542f\u5b88\u62a4");
const daoService = require("./dao_service");
ok("API \u5b8c\u5907 \u00b7 install/uninstall/status/TASK_NAME", function () {
  assert.strictEqual(typeof daoService.install, "function");
  assert.strictEqual(typeof daoService.uninstall, "function");
  assert.strictEqual(typeof daoService.status, "function");
  assert.strictEqual(typeof daoService.TASK_NAME, "string");
  assert.ok(daoService.TASK_NAME.length > 0);
});
ok("_nodeExe / _daoScript \u8fd4\u7edd\u5bf9\u8def\u5f84", function () {
  var ne = daoService._nodeExe();
  var ds = daoService._daoScript();
  assert.ok(path.isAbsolute(ne), "node not absolute: " + ne);
  assert.ok(path.isAbsolute(ds), "dao not absolute: " + ds);
  assert.ok(/dao\.js$/i.test(ds), "dao script wrong: " + ds);
});
ok(
  "status() \u672a\u5b89\u88c5\u65f6\u8fd4 installed:false",
  async function () {
    var r = await daoService.status({
      taskName: "DaoNeverExists_" + Date.now(),
    });
    if (process.platform === "win32") {
      assert.strictEqual(r.installed, false);
    } else {
      assert.strictEqual(r.installed, false);
      assert.strictEqual(r.error, "unsupported_platform");
    }
  },
);

console.log("\n[4d] page.js \u6e32\u67d3 \u00b7 \u4e09\u65b0\u9875");
const makePage = require("./remote-agent/page.js");
ok(
  "\u65e0\u4ee4\u724c\u6e32\u67d3 \u5305\u542b\u6587\u4ef6/\u526a\u8d34\u677f/\u5524\u9192\u6807\u7b7e",
  function () {
    var html = makePage("127.0.0.1:3002", "");
    assert.ok(html.length > 10000, "html too short: " + html.length);
    assert.ok(html.indexOf("go('files'") > 0, "files tab missing");
    assert.ok(html.indexOf("go('clip'") > 0, "clip tab missing");
    assert.ok(html.indexOf("go('wake'") > 0, "wake tab missing");
    assert.ok(html.indexOf('id="p-files"') > 0, "files page div missing");
    assert.ok(html.indexOf('id="p-clip"') > 0, "clip page div missing");
    assert.ok(html.indexOf('id="p-wake"') > 0, "wake page div missing");
    assert.ok(html.indexOf("/dao/wol") > 0, "WoL endpoint not wired");
    assert.ok(html.indexOf("/dao/clipboard") > 0, "clipboard not wired");
    assert.ok(html.indexOf("/files/put") > 0, "upload not wired");
    assert.ok(html.indexOf('var TK=""') > 0, "empty token var mismatch");
  },
);
ok(
  "\u6709\u4ee4\u724c\u6e32\u67d3 token \u6b63\u786e\u5d4c\u5165",
  function () {
    var html = makePage("example.ts.net", "deadbeef");
    assert.ok(html.indexOf('var TK="deadbeef"') > 0, "token not embedded");
    assert.ok(html.indexOf("undefined") < 0, "undefined leaked");
  },
);

console.log("\n[5] createPairing \u4e0e kernel \u62fc\u6b63");
ok("createPairing 返回 { uri, token, ips, ... }", function () {
  var kernel = new DaoKernel(tmpDir);
  kernel.awaken();
  var pair = daoPair.createPairing(kernel, { ttlSec: 60 });
  assert.ok(pair.uri.startsWith("dao://"));
  assert.strictEqual(typeof pair.token, "string");
  assert.ok(pair.token.length > 0);
  assert.strictEqual(typeof pair.expiresAt, "number");
  var parsed = daoPair.parsePairUri(pair.uri);
  assert.strictEqual(parsed.fingerprint, kernel.identity.fingerprint);
  assert.strictEqual(parsed.token, pair.token);
});

Promise.all(pending).then(function () {
  console.log(
    "\n============= \u901a\u8fc7 " +
      okCount +
      " / \u5931\u8d25 " +
      failCount +
      " =============\n",
  );

  // 清理测试身份目录
  try {
    var fs = require("fs");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (e) {}

  process.exit(failCount === 0 ? 0 : 1);
});
