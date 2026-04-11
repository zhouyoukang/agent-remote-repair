// ============================================================
// 道 · 万法归宗 Bridge  (dao_bridge.js)
// 连接 WebSocket Agent Hub ↔ PS Agent Relay
// 不变应万变: 自动发现Relay, 动态LAN探测, 公网兜底
//
// Usage:
//   const bridge = require('./dao_bridge');
//   await bridge.findRelay();        // → 'http://192.168.31.179:9910'
//   await bridge.getAgents();        // → [{hostname, status, ...}]
//   await bridge.execOnRelay('DESKTOP-MASTER', 'hostname');
// ============================================================

const http = require('http');
const https = require('https');
const os = require('os');

const RELAY_PORT  = 9910;
const RELAY_TOKEN = process.env.PS_AGENT_MASTER_TOKEN || 'dao-ps-agent-2026';
const PUBLIC_RELAY = 'https://aiotvr.xyz/ps-agent';
const PROBE_OCTETS = ['179', '141', '1'];  // known last-octets (laptop, desktop, gateway)

let _cachedRelayUrl = null;
let _lastProbe = 0;
const CACHE_TTL = 60000;  // 60s relay cache

// ═══════════════════════════════════════════════════════════
// Network Discovery (Node.js equivalent of genesis)
// ═══════════════════════════════════════════════════════════

function getLocalSubnets() {
  var subnets = [];
  var ifaces = os.networkInterfaces();
  for (var name of Object.keys(ifaces)) {
    for (var iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        var parts = iface.address.split('.');
        var sub = parts.slice(0, 3).join('.') + '.';
        if (subnets.indexOf(sub) < 0) subnets.push(sub);
      }
    }
  }
  return subnets;
}

function buildCandidates() {
  var candidates = [];
  // 1. Cached
  if (_cachedRelayUrl) candidates.push(_cachedRelayUrl);
  // 2. Localhost
  candidates.push('http://127.0.0.1:' + RELAY_PORT);
  // 3. LAN subnets × known octets
  var subnets = getLocalSubnets();
  for (var sub of subnets) {
    for (var oct of PROBE_OCTETS) {
      var ip = sub + oct;
      var url = 'http://' + ip + ':' + RELAY_PORT;
      if (candidates.indexOf(url) < 0) candidates.push(url);
    }
  }
  // 4. USB Ethernet
  if (subnets.indexOf('192.168.100.') < 0) {
    for (var oct2 of PROBE_OCTETS) {
      candidates.push('http://192.168.100.' + oct2 + ':' + RELAY_PORT);
    }
  }
  // 5. Public (always last)
  candidates.push(PUBLIC_RELAY);
  return candidates;
}

// ═══════════════════════════════════════════════════════════
// HTTP Helpers
// ═══════════════════════════════════════════════════════════

function httpProbe(url, timeout) {
  timeout = timeout || 2000;
  return new Promise(function(resolve) {
    var mod = url.startsWith('https') ? https : http;
    try {
      var req = mod.get(url + '/api/health', { timeout: timeout }, function(res) {
        var data = '';
        res.on('data', function(c) { data += c; });
        res.on('end', function() {
          try {
            var j = JSON.parse(data);
            resolve(j.status === 'ok' ? j : null);
          } catch(e) { resolve(null); }
        });
      });
      req.on('error', function() { resolve(null); });
      req.on('timeout', function() { req.destroy(); resolve(null); });
    } catch(e) { resolve(null); }
  });
}

function httpRequest(method, fullUrl, body, timeout) {
  timeout = timeout || 30000;
  return new Promise(function(resolve, reject) {
    var parsed = new URL(fullUrl);
    var mod = parsed.protocol === 'https:' ? https : http;
    var opts = {
      method: method,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: {
        'Authorization': 'Bearer ' + RELAY_TOKEN,
        'Content-Type': 'application/json'
      },
      timeout: timeout
    };
    var req = mod.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('timeout')); });
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
  var candidates = buildCandidates();
  for (var url of candidates) {
    var result = await httpProbe(url, 2000);
    if (result) {
      _cachedRelayUrl = url;
      _lastProbe = Date.now();
      console.log('[bridge] Relay found:', url, '(' + result.agents_online + ' agents)');
      return url;
    }
  }
  _cachedRelayUrl = null;
  console.log('[bridge] No relay found');
  return null;
}

// ═══════════════════════════════════════════════════════════
// Relay API Wrappers
// ═══════════════════════════════════════════════════════════

async function relayRequest(method, path, body, timeout) {
  var url = await findRelay();
  if (!url) throw new Error('relay not found');
  return httpRequest(method, url + path, body, timeout);
}

async function getAgents() {
  return relayRequest('GET', '/api/agents');
}

async function execOnRelay(hostname, cmd, timeout) {
  timeout = timeout || 30;
  return relayRequest('POST', '/api/exec-sync', {
    agent_id: hostname, cmd: cmd, timeout: timeout
  }, (timeout + 10) * 1000);
}

async function getRelayHealth() {
  return relayRequest('GET', '/api/health');
}

// ═══════════════════════════════════════════════════════════
// Desktop Guardian Integration
// ═══════════════════════════════════════════════════════════

async function runGuardianViaRelay(hostname, action) {
  // Execute desktop_guardian.ps1 on a remote machine via the relay
  action = action || 'diagnose';
  var guardianCmd = [
    '$gp = "' + __dirname.replace(/\\/g, '\\\\') + '\\\\..\\\\desktop_guardian.ps1"',
    'if (Test-Path $gp) { & $gp -Action ' + action + ' }',
    'else { "desktop_guardian.ps1 not found at $gp" }'
  ].join('; ');
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
  get relayUrl() { return _cachedRelayUrl; },
  RELAY_TOKEN: RELAY_TOKEN
};
