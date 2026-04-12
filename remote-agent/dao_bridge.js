// ╔══════════════════════════════════════════════════════════╗
// ║  道 · 万法归宗 Bridge  (dao_bridge.js)                   ║
// ║  连接 WebSocket Agent Hub ↔ PS Agent Relay               ║
// ║  不变应万变: 自动发现, 动态LAN探测, 公网兜底              ║
// ║                                                          ║
// ║  道核驱动: Token由DaoKernel签发, 端口由道核动态分配       ║
// ║  去芜留菁: 移除硬编码默认值, 一切从运行时环境读取         ║
// ╚══════════════════════════════════════════════════════════╝

const http = require("http");
const https = require("https");
const os = require("os");

// 道法自然: 端口/Token由dao.js注入环境, 不再硬编码默认值
const RELAY_PORT = parseInt(process.env.RELAY_PORT || "9910", 10);
const RELAY_TOKEN = process.env.PS_AGENT_MASTER_TOKEN || "";
const PUBLIC_RELAY = process.env.PUBLIC_RELAY || "";
const PROBE_OCTETS = (process.env.PROBE_OCTETS || "1")
  .split(",")
  .map(function (s) {
    return s.trim();
  });

let _cachedRelayUrl = null;
let _lastProbe = 0;
const CACHE_TTL = 60000; // 60s relay cache

// ═══════════════════════════════════════════════════════════
// Network Discovery (Node.js equivalent of genesis)
// ═══════════════════════════════════════════════════════════

function getLocalSubnets() {
  var subnets = [];
  var ifaces = os.networkInterfaces();
  for (var name of Object.keys(ifaces)) {
    for (var iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        var parts = iface.address.split(".");
        var sub = parts.slice(0, 3).join(".") + ".";
        if (subnets.indexOf(sub) < 0) subnets.push(sub);
      }
    }
  }
  return subnets;
}

function buildFastCandidates() {
  var candidates = [];
  // 1. Cached
  if (_cachedRelayUrl) candidates.push(_cachedRelayUrl);
  // 2. Localhost
  candidates.push("http://127.0.0.1:" + RELAY_PORT);
  // 3. LAN subnets × configured octets (fast path)
  var subnets = getLocalSubnets();
  for (var sub of subnets) {
    for (var oct of PROBE_OCTETS) {
      var ip = sub + oct;
      var url = "http://" + ip + ":" + RELAY_PORT;
      if (candidates.indexOf(url) < 0) candidates.push(url);
    }
  }
  return candidates;
}

function buildSubnetCandidates() {
  // Full subnet parallel scan — discover any Relay on the LAN
  var candidates = [];
  var subnets = getLocalSubnets();
  for (var sub of subnets) {
    for (var i = 1; i <= 254; i++) {
      var url = "http://" + sub + i + ":" + RELAY_PORT;
      candidates.push(url);
    }
  }
  // Public (only if configured)
  if (PUBLIC_RELAY) candidates.push(PUBLIC_RELAY);
  return candidates;
}

// ═══════════════════════════════════════════════════════════
// HTTP Helpers
// ═══════════════════════════════════════════════════════════

function httpProbe(url, timeout) {
  timeout = timeout || 2000;
  return new Promise(function (resolve) {
    var mod = url.startsWith("https") ? https : http;
    try {
      var req = mod.get(
        url + "/api/health",
        { timeout: timeout },
        function (res) {
          var data = "";
          res.on("data", function (c) {
            data += c;
          });
          res.on("end", function () {
            try {
              var j = JSON.parse(data);
              resolve(j.status === "ok" ? j : null);
            } catch (e) {
              resolve(null);
            }
          });
        },
      );
      req.on("error", function () {
        resolve(null);
      });
      req.on("timeout", function () {
        req.destroy();
        resolve(null);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function httpRequest(method, fullUrl, body, timeout) {
  timeout = timeout || 30000;
  return new Promise(function (resolve, reject) {
    var parsed = new URL(fullUrl);
    var mod = parsed.protocol === "https:" ? https : http;
    var opts = {
      method: method,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: {
        Authorization: "Bearer " + RELAY_TOKEN,
        "Content-Type": "application/json",
      },
      timeout: timeout,
    };
    var req = mod.request(opts, function (res) {
      var data = "";
      res.on("data", function (c) {
        data += c;
      });
      res.on("end", function () {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", function () {
      req.destroy();
      reject(new Error("timeout"));
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════
// Relay Discovery
// ═══════════════════════════════════════════════════════════

async function findRelay(force) {
  if (!force && _cachedRelayUrl && Date.now() - _lastProbe < CACHE_TTL) {
    return _cachedRelayUrl;
  }
  // Phase 1: Fast sequential (cached + localhost + known octets)
  var fast = buildFastCandidates();
  for (var url of fast) {
    var result = await httpProbe(url, 2000);
    if (result) {
      _cachedRelayUrl = url;
      _lastProbe = Date.now();
      console.log(
        "[bridge] Relay found (fast):",
        url,
        "(" + result.agents_online + " agents)",
      );
      return url;
    }
  }
  // Phase 2: Parallel subnet-wide race — first responder wins
  var subnet = buildSubnetCandidates();
  if (subnet.length > 0) {
    console.log(
      "[bridge] Fast path missed, scanning " + subnet.length + " candidates...",
    );
    var found = await new Promise(function (resolve) {
      var done = false;
      var pending = subnet.length;
      for (var i = 0; i < subnet.length; i++) {
        (function (u) {
          httpProbe(u, 3000).then(function (r) {
            if (r && !done) {
              done = true;
              resolve(u);
            }
            if (--pending <= 0 && !done) {
              done = true;
              resolve(null);
            }
          });
        })(subnet[i]);
      }
    });
    if (found) {
      _cachedRelayUrl = found;
      _lastProbe = Date.now();
      console.log("[bridge] Relay found (scan):", found);
      return found;
    }
  }
  _cachedRelayUrl = null;
  console.log("[bridge] No relay found");
  return null;
}

// ═══════════════════════════════════════════════════════════
// Relay API Wrappers
// ═══════════════════════════════════════════════════════════

async function relayRequest(method, path, body, timeout) {
  var url = await findRelay();
  if (!url) throw new Error("relay not found");
  return httpRequest(method, url + path, body, timeout);
}

async function getAgents() {
  return relayRequest("GET", "/api/agents");
}

async function execOnRelay(hostname, cmd, timeout) {
  timeout = timeout || 30;
  return relayRequest(
    "POST",
    "/api/exec-sync",
    {
      agent_id: hostname,
      cmd: cmd,
      timeout: timeout,
    },
    (timeout + 10) * 1000,
  );
}

async function getRelayHealth() {
  return relayRequest("GET", "/api/health");
}

// ═══════════════════════════════════════════════════════════
// Desktop Guardian Integration
// ═══════════════════════════════════════════════════════════

async function runGuardianViaRelay(hostname, action) {
  // Execute desktop_guardian.ps1 on a remote machine via the relay
  action = action || "diagnose";
  var guardianPath = require("path")
    .resolve(__dirname, "..", "desktop_guardian.ps1")
    .replace(/\\/g, "\\\\");
  var guardianCmd = [
    '$gp = "' + guardianPath + '"',
    "if (Test-Path $gp) { & $gp -Action " + action + " }",
    'else { "desktop_guardian.ps1 not found at $gp" }',
  ].join("; ");
  return execOnRelay(hostname, guardianCmd, 120);
}

// ═══════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════

module.exports = {
  findRelay: findRelay,
  getAgents: getAgents,
  execOnRelay: execOnRelay,
  getRelayHealth: getRelayHealth,
  runGuardianViaRelay: runGuardianViaRelay,
  getLocalSubnets: getLocalSubnets,
  get relayUrl() {
    return _cachedRelayUrl;
  },
  RELAY_TOKEN: RELAY_TOKEN,
};
