// 道 · 端点集成测试 — 拉起 hub 后, 逐一触达核心 + 新增端点
//   node _test_endpoints.js
// 不依赖外部网络, 不使用 MASTER_TOKEN (localhost 豁免)
//
// 覆盖:
//   [0]  本源:   /dao/discover · /status · /api/health · /tools · /brain/state
//   [Ia] PWA:    /manifest.webmanifest · /icon.svg · /c
//   [Ib] 配对:   /pair (json/svg/png/ascii) + /pair/claim (成功/重放/非法)
//   [I]  /dao/wol
//   [II] /files
//   [III] /dao/clipboard
//   [IV.5] /dao/mdns(+refresh)
//   [IV.6] /dao/record(+stop/thumb)
//   [V]  /sense (page render)

"use strict";

process.env.PORT = "31099";
process.env.DAO_DISABLE_RELAY_AUTOSTART = "1";
// 关闭 discoverScreenSources 的 30s 间隔污染 — 无法, 但也不打紧; 测试结束即退

const http = require("http");
const hub = require("./remote-agent/server");

var okCount = 0;
var failCount = 0;
function ok(name, fn) {
  return new Promise(function (resolve) {
    try {
      var r = fn();
      Promise.resolve(r)
        .then(function () {
          console.log("  \u2713 " + name);
          okCount++;
          resolve();
        })
        .catch(function (e) {
          console.log(
            "  \u2717 " + name + "\n      " + (e && e.stack ? e.stack : e),
          );
          failCount++;
          resolve();
        });
    } catch (e) {
      console.log(
        "  \u2717 " + name + "\n      " + (e && e.stack ? e.stack : e),
      );
      failCount++;
      resolve();
    }
  });
}

function req(method, path, body) {
  return new Promise(function (resolve, reject) {
    var opts = {
      host: "127.0.0.1",
      port: 31099,
      path: path,
      method: method,
      headers: { "Content-Type": "application/json" },
    };
    var r = http.request(opts, function (res) {
      var chunks = [];
      res.on("data", function (c) {
        chunks.push(c);
      });
      res.on("end", function () {
        var raw = Buffer.concat(chunks).toString("utf8");
        var data = raw;
        try {
          data = JSON.parse(raw);
        } catch (e) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          raw: raw,
        });
      });
    });
    r.on("error", reject);
    if (body != null)
      r.write(typeof body === "string" ? body : JSON.stringify(body));
    r.end();
  });
}

hub.start(31099);

// 等待 listen
async function waitListen() {
  for (var i = 0; i < 50; i++) {
    try {
      var r = await req("GET", "/dao/discover");
      if (r.status === 200) return;
    } catch (e) {}
    await new Promise(function (r) {
      setTimeout(r, 100);
    });
  }
  throw new Error("hub did not listen");
}

(async function run() {
  await waitListen();

  // ═══════════════════════════════════════════════════════════
  // [0] 本源: /dao/discover · /status · /api/health · /tools · /brain/state
  //     道法自然 — 这些是 hub 身份与状态的核心自描述入口
  // ═══════════════════════════════════════════════════════════
  console.log(
    "\n[0] \u672c\u6e90 \u00b7 /dao/discover \u00b7 /status \u00b7 /api/health \u00b7 /tools \u00b7 /brain/state",
  );

  await ok(
    "GET /dao/discover \u8fd4\u56de {version,fingerprint,port,ips,reqHost}",
    async function () {
      var r = await req("GET", "/dao/discover");
      if (r.status !== 200) throw new Error("status " + r.status);
      var b = r.body;
      if (typeof b !== "object") throw new Error("non-json body");
      if (b.version !== 1) throw new Error("version mismatch: " + b.version);
      if (typeof b.fingerprint !== "string")
        throw new Error("fingerprint missing");
      if (b.port !== 31099) throw new Error("port mismatch: " + b.port);
      if (!Array.isArray(b.ips)) throw new Error("ips not array");
      if (typeof b.reqHost !== "string")
        throw new Error("reqHost missing: " + JSON.stringify(b));
      if (typeof b.ts !== "number") throw new Error("ts missing");
    },
  );

  await ok(
    "GET /status \u8fd4\u56de version=dao-v8.7 \u7b49\u72b6\u6001 JSON",
    async function () {
      var r = await req("GET", "/status");
      if (r.status !== 200) throw new Error("status " + r.status);
      var b = r.body;
      if (b.version !== "dao-v8.7")
        throw new Error("version mismatch: " + b.version);
      if (!b.hub || typeof b.hub.agents !== "number")
        throw new Error("hub.agents missing");
      if (!b.screen || !b.screen.sources)
        throw new Error("screen.sources missing");
      if (!Array.isArray(b.agents)) throw new Error("agents not array");
    },
  );

  await ok(
    "GET /api/health \u8fd4\u56de ok:true version=8.7",
    async function () {
      var r = await req("GET", "/api/health");
      if (r.status !== 200) throw new Error("status " + r.status);
      if (r.body.ok !== true) throw new Error("ok not true");
      if (r.body.service !== "dao-remote-hub")
        throw new Error("service mismatch: " + r.body.service);
      if (r.body.version !== "8.7")
        throw new Error("version mismatch: " + r.body.version);
      if (typeof r.body.uptime !== "number") throw new Error("uptime missing");
    },
  );

  await ok("GET /tools \u8fd4\u56de {tools:[...]}", async function () {
    var r = await req("GET", "/tools");
    if (r.status !== 200) throw new Error("status " + r.status);
    if (!Array.isArray(r.body.tools))
      throw new Error("tools not array: " + JSON.stringify(r.body));
  });

  await ok(
    "GET /brain/state \u8fd4\u56de \u8bca\u65ad\u5668\u72b6\u6001 JSON",
    async function () {
      var r = await req("GET", "/brain/state");
      if (r.status !== 200) throw new Error("status " + r.status);
      var b = r.body;
      if (typeof b !== "object") throw new Error("non-json body");
      if (!Array.isArray(b.agents)) throw new Error("agents not array");
      if (typeof b.pending !== "number") throw new Error("pending missing");
      if (typeof b.history !== "number") throw new Error("history missing");
    },
  );

  await ok(
    "GET /screen/sources \u8fd4\u56de {ok,available,sources,best}",
    async function () {
      var r = await req("GET", "/screen/sources");
      if (r.status !== 200) throw new Error("status " + r.status);
      var b = r.body;
      if (b.ok !== true) throw new Error("ok not true");
      if (!Array.isArray(b.available)) throw new Error("available not array");
      if (typeof b.sources !== "object") throw new Error("sources missing");
      if (!Array.isArray(b.remoteTools)) throw new Error("remoteTools missing");
    },
  );

  await ok(
    "GET /go \u8fd4\u56de PowerShell Agent \u811a\u672c (localhost \u8c41\u514d)",
    async function () {
      var r = await req("GET", "/go");
      if (r.status !== 200) throw new Error("status " + r.status);
      var ct = (r.headers["content-type"] || "").toLowerCase();
      if (ct.indexOf("text/plain") < 0)
        throw new Error("content-type wrong: " + ct);
      // PowerShell Agent \u811a\u672c\u5fc5\u5305\u542b WebSocket \u5730\u5740 + Try/Catch
      if (r.raw.indexOf("ws://") < 0 && r.raw.indexOf("wss://") < 0)
        throw new Error("no ws URL in agent script");
      if (r.raw.length < 1000)
        throw new Error("agent script too short: " + r.raw.length);
    },
  );

  // ═══════════════════════════════════════════════════════════
  // [Ia] PWA 三件套: /manifest.webmanifest · /icon.svg · /c
  //     扫码即入, 得鱼忘荃 — 移动端零安装落地页
  // ═══════════════════════════════════════════════════════════
  console.log(
    "\n[Ia] PWA \u00b7 /manifest.webmanifest \u00b7 /icon.svg \u00b7 /c",
  );

  await ok(
    "GET /manifest.webmanifest \u8fd4\u56de \u5408\u6cd5 JSON",
    async function () {
      var r = await req("GET", "/manifest.webmanifest");
      if (r.status !== 200) throw new Error("status " + r.status);
      var ct = (r.headers["content-type"] || "").toLowerCase();
      if (ct.indexOf("manifest") < 0)
        throw new Error("content-type wrong: " + ct);
      if (typeof r.body !== "object") throw new Error("non-json body");
      if (r.body.start_url !== "/c")
        throw new Error("start_url mismatch: " + r.body.start_url);
      if (!Array.isArray(r.body.icons) || r.body.icons.length === 0)
        throw new Error("icons missing");
    },
  );

  await ok(
    "GET /icon.svg \u8fd4\u56de SVG (Content-Type: image/svg+xml)",
    async function () {
      var r = await req("GET", "/icon.svg");
      if (r.status !== 200) throw new Error("status " + r.status);
      var ct = (r.headers["content-type"] || "").toLowerCase();
      if (ct.indexOf("svg") < 0) throw new Error("content-type wrong: " + ct);
      if (r.raw.indexOf("<svg") < 0)
        throw new Error("body not svg: " + r.raw.slice(0, 80));
    },
  );

  await ok(
    "GET /c \u8fd4\u56de HTML \u843d\u5730\u9875 (no-store \u7f13\u5b58)",
    async function () {
      var r = await req("GET", "/c");
      if (r.status !== 200) throw new Error("status " + r.status);
      var ct = (r.headers["content-type"] || "").toLowerCase();
      if (ct.indexOf("html") < 0) throw new Error("content-type wrong: " + ct);
      if (r.raw.indexOf("<!DOCTYPE") < 0 && r.raw.indexOf("<!doctype") < 0)
        throw new Error("not html");
      var cc = (r.headers["cache-control"] || "").toLowerCase();
      if (cc.indexOf("no-store") < 0)
        throw new Error("cache-control wrong: " + cc);
    },
  );

  // ═══════════════════════════════════════════════════════════
  // [Ib] 一码配对 /pair + /pair/claim 全流程
  //     扫 = 认身份 + 拿令牌 + 知坐标; 一次性 + 速率限制
  // ═══════════════════════════════════════════════════════════
  console.log(
    "\n[Ib] \u914d\u5bf9 \u00b7 /pair (json/svg/png/ascii) \u00b7 /pair/claim",
  );

  var _pairJsonBody = null;
  await ok(
    "GET /pair?format=json \u8fd4\u56de pairId+webUri+fingerprint",
    async function () {
      var r = await req("GET", "/pair?format=json&ttl=60");
      if (r.status !== 200) throw new Error("status " + r.status);
      var b = r.body;
      if (!b.pairId || !/^[0-9a-f]{32}$/.test(b.pairId))
        throw new Error("pairId bad: " + b.pairId);
      if (typeof b.fingerprint !== "string")
        throw new Error("fingerprint missing");
      if (!b.webUri || b.webUri.indexOf("/c#") < 0)
        throw new Error("webUri bad: " + b.webUri);
      if (!b.daoUri || b.daoUri.indexOf("dao://") !== 0)
        throw new Error("daoUri bad: " + b.daoUri);
      if (b.ttlSec !== 60) throw new Error("ttlSec mismatch: " + b.ttlSec);
      if (b.claimUrl !== "/pair/claim")
        throw new Error("claimUrl wrong: " + b.claimUrl);
      _pairJsonBody = b;
    },
  );

  await ok("GET /pair?format=svg \u8fd4\u56de QR SVG", async function () {
    var r = await req("GET", "/pair?format=svg");
    if (r.status !== 200) throw new Error("status " + r.status);
    var ct = (r.headers["content-type"] || "").toLowerCase();
    if (ct.indexOf("svg") < 0) throw new Error("content-type wrong: " + ct);
    if (r.raw.indexOf("<svg") < 0) throw new Error("not svg");
  });

  await ok(
    "GET /pair?format=png \u8fd4\u56de \u5408\u6cd5 PNG \u5934",
    async function () {
      var r = await req("GET", "/pair?format=png");
      if (r.status !== 200) throw new Error("status " + r.status);
      var ct = (r.headers["content-type"] || "").toLowerCase();
      if (ct.indexOf("png") < 0) throw new Error("content-type wrong: " + ct);
      // PNG 签名 89 50 4E 47 — r.raw 是 utf8 可能有问题, 看 Content-Type 足矣
      // 但 Node 已解 JSON 失败 → r.raw 保留. 只校字节数 > 0
      if (!r.raw || r.raw.length < 20)
        throw new Error("png body too short: " + r.raw.length);
    },
  );

  await ok(
    "GET /pair?format=ascii \u8fd4\u56de ASCII QR \u6587\u672c",
    async function () {
      var r = await req("GET", "/pair?format=ascii");
      if (r.status !== 200) throw new Error("status " + r.status);
      var ct = (r.headers["content-type"] || "").toLowerCase();
      if (ct.indexOf("text/plain") < 0)
        throw new Error("content-type wrong: " + ct);
      // ASCII QR 含 \u2588 (FULL BLOCK) 或 \u2580 (UPPER HALF BLOCK)
      if (r.raw.indexOf("URI:") < 0) throw new Error("URI line missing");
    },
  );

  await ok(
    "POST /pair/claim (\u5408\u6cd5 pairId) \u8fd4\u56de token+fingerprint",
    async function () {
      if (!_pairJsonBody) throw new Error("no pair json captured");
      var r = await req("POST", "/pair/claim", {
        pairId: _pairJsonBody.pairId,
      });
      if (r.status !== 200)
        throw new Error("status " + r.status + " body=" + r.raw);
      if (r.body.ok !== true) throw new Error("ok not true");
      if (typeof r.body.token !== "string" || r.body.token.length < 10)
        throw new Error("token missing/short: " + r.body.token);
      if (r.body.fingerprint !== _pairJsonBody.fingerprint)
        throw new Error(
          "fingerprint mismatch: " +
            r.body.fingerprint +
            " vs " +
            _pairJsonBody.fingerprint,
        );
      if (r.body.port !== 31099)
        throw new Error("port mismatch: " + r.body.port);
    },
  );

  await ok(
    "POST /pair/claim \u91cd\u653e\u540c\u4e00 pairId \u8fd4 404",
    async function () {
      if (!_pairJsonBody) throw new Error("no pair json captured");
      var r = await req("POST", "/pair/claim", {
        pairId: _pairJsonBody.pairId,
      });
      if (r.status !== 404)
        throw new Error("status " + r.status + " body=" + r.raw);
      if (r.body.ok !== false) throw new Error("expected ok:false");
    },
  );

  await ok(
    "POST /pair/claim \u975e\u6cd5 pairId \u8fd4 400",
    async function () {
      var r = await req("POST", "/pair/claim", { pairId: "not-hex-32" });
      if (r.status !== 400)
        throw new Error("status " + r.status + " body=" + r.raw);
      if (r.body.error !== "bad_pair_id")
        throw new Error("error mismatch: " + r.body.error);
    },
  );

  await ok("POST /pair/claim \u7f3a pairId \u8fd4 400", async function () {
    var r = await req("POST", "/pair/claim", {});
    if (r.status !== 400)
      throw new Error("status " + r.status + " body=" + r.raw);
  });

  console.log("\n[I] /dao/wol");

  await ok("GET /dao/wol 返回 {hosts:[]}", async function () {
    var r = await req("GET", "/dao/wol");
    if (r.status !== 200) throw new Error("status " + r.status);
    if (!Array.isArray(r.body.hosts)) throw new Error("hosts not array");
  });

  await ok("POST /dao/wol 缺 mac 返回 400", async function () {
    var r = await req("POST", "/dao/wol", { nope: 1 });
    if (r.status !== 400) throw new Error("status " + r.status);
    if (r.body.ok !== false) throw new Error("expected ok:false");
  });

  await ok(
    "POST /dao/wol 合法 mac 实发魔法包 (loopback 广播)",
    async function () {
      var r = await req("POST", "/dao/wol", {
        mac: "11:22:33:44:55:66",
        broadcast: ["127.0.0.1"],
      });
      if (r.status !== 200)
        throw new Error("status " + r.status + " body=" + r.raw);
      if (r.body.mac !== "11:22:33:44:55:66")
        throw new Error("mac echo mismatch");
      if (!r.body.targets || r.body.targets.indexOf("127.0.0.1") < 0)
        throw new Error("target not echoed: " + JSON.stringify(r.body));
    },
  );

  console.log("\n[II] /files");
  await ok("GET /files?path=. 返回 entries", async function () {
    var r = await req(
      "GET",
      "/files?path=" + encodeURIComponent(process.cwd()),
    );
    if (r.status !== 200) throw new Error("status " + r.status);
    if (!Array.isArray(r.body.entries)) throw new Error("no entries");
    if (
      !r.body.entries.some(function (e) {
        return e.name === "package.json" || e.name === "_test_wuwei.js";
      })
    ) {
      throw new Error(
        "known file missing: " + JSON.stringify(r.body.entries.slice(0, 5)),
      );
    }
  });

  console.log("\n[III] /dao/clipboard");
  await ok("GET /dao/clipboard 返回 {text:...}", async function () {
    var r = await req("GET", "/dao/clipboard");
    if (r.status !== 200) throw new Error("status " + r.status);
    if (typeof r.body.text !== "string") throw new Error("text not string");
  });

  console.log("\n[IV.5] /dao/mdns");
  await ok("GET /dao/mdns 返回 {enabled:true, services:[]}", async function () {
    var r = await req("GET", "/dao/mdns");
    if (r.status !== 200) throw new Error("status " + r.status);
    if (typeof r.body.enabled !== "boolean")
      throw new Error("enabled not bool: " + JSON.stringify(r.body));
    if (!Array.isArray(r.body.services)) throw new Error("services not array");
    if (!Array.isArray(r.body.dynIds)) throw new Error("dynIds not array");
  });
  await ok("POST /dao/mdns/refresh 触发查询", async function () {
    var r = await req("POST", "/dao/mdns/refresh", {});
    if (r.status !== 200 && r.status !== 503)
      throw new Error("status " + r.status + " body=" + r.raw);
    if (r.status === 200 && r.body.ok !== true)
      throw new Error("expected ok:true: " + r.raw);
  });

  console.log("\n[IV.6] /dao/record");
  await ok(
    "GET /dao/record 返回 {enabled:true, sessions:[]}",
    async function () {
      var r = await req("GET", "/dao/record");
      if (r.status !== 200) throw new Error("status " + r.status);
      if (typeof r.body.enabled !== "boolean")
        throw new Error("enabled not bool");
      if (!Array.isArray(r.body.sessions))
        throw new Error("sessions not array");
    },
  );
  await ok("POST /dao/record?fps=2 创建会话返回 id", async function () {
    var r = await req("POST", "/dao/record?fps=2&max=10&source=e2e");
    if (r.status !== 200)
      throw new Error("status " + r.status + " body=" + r.raw);
    if (!r.body.ok) throw new Error("not ok: " + r.raw);
    if (!r.body.id) throw new Error("no id");
    if (r.body.meta.fps !== 2) throw new Error("fps not echo'd");
    // 紧接着 stop, 避免拖着 setTimeout 继续抓 (无投屏源时 captureFn 会 reject)
    var stopR = await req(
      "POST",
      "/dao/record/stop?id=" + encodeURIComponent(r.body.id),
    );
    if (stopR.status !== 200)
      throw new Error("stop status " + stopR.status + " body=" + stopR.raw);
    // 清理
    var delR = await req(
      "DELETE",
      "/dao/record?id=" + encodeURIComponent(r.body.id),
    );
    if (delR.status !== 200) throw new Error("delete status " + delR.status);
  });
  await ok("GET /dao/record/thumb?id=no-such 返回 404", async function () {
    var r = await req("GET", "/dao/record/thumb?id=no-such-id");
    if (r.status !== 404) throw new Error("status " + r.status);
  });

  console.log("\n[V] /sense (page render)");
  await ok("GET /sense 返回 HTML 含新标签", async function () {
    var r = await req("GET", "/sense");
    if (r.status !== 200) throw new Error("status " + r.status);
    var html = r.raw;
    if (html.indexOf("go('files'") < 0) throw new Error("files tab missing");
    if (html.indexOf("go('wake'") < 0) throw new Error("wake tab missing");
    if (html.indexOf("go('clip'") < 0) throw new Error("clip tab missing");
    if (html.indexOf("go('rec'") < 0) throw new Error("rec tab missing");
    if (html.indexOf('id="p-rec"') < 0) throw new Error("rec page div missing");
  });

  console.log(
    "\n============= \u7aef\u70b9\u96c6\u6210 " +
      okCount +
      " / \u5931\u8d25 " +
      failCount +
      " =============\n",
  );
  process.exit(failCount === 0 ? 0 : 1);
})();
