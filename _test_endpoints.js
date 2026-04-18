// 道 · 端点集成测试 — 拉起 hub 后, 逐一触达 v8.3 新增端点
//   node _test_endpoints.js
// 不依赖外部网络, 不使用 MASTER_TOKEN (localhost 豁免)

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
