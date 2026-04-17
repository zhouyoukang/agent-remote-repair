// ╔══════════════════════════════════════════════════════════════╗
// ║  道 · 投屏注册表 — 一表定万法                                ║
// ║                                                              ║
// ║  道生一: NOTHING hard-coded, EVERY source is one row.        ║
// ║                                                              ║
// ║  Each source declares (data, not code):                      ║
// ║    id             — unique key                               ║
// ║    priority       — lower = preferred                        ║
// ║    port/url       — where it lives (single port)             ║
// ║    portCandidates — [port...] probe-and-latch first alive     ║
// ║    probe()        — Promise<bool> liveness (overrides ports) ║
// ║    capture()      — Promise<{ok,image,…}> | null             ║
// ║    input()        — Promise<any> | null                      ║
// ║                                                              ║
// ║  柔弱胜刚强: on capture/input failure the source is marked   ║
// ║  offline immediately so next attempt picks the next source   ║
// ║  without waiting for the 30s reprobe interval.               ║
// ║                                                              ║
// ║  Consumers iterate the table. To add/remove/reorder a        ║
// ║  source, edit exactly ONE row. 无为而无不为.                 ║
// ╚══════════════════════════════════════════════════════════════╝

const http = require("http");

// ── Default HTTP health probe (shared by most entries) ─────────
function probeHttp(port, healthPath, timeoutMs) {
  var t = timeoutMs || 2000;
  var p = healthPath || "/status";
  return new Promise(function (resolve) {
    var req = http.get(
      "http://127.0.0.1:" + port + p,
      { timeout: t },
      function (res) {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      },
    );
    req.on("error", function () {
      resolve(false);
    });
    req.on("timeout", function () {
      req.destroy();
      resolve(false);
    });
  });
}

// ── Registry ───────────────────────────────────────────────────
class ScreenRegistry {
  constructor() {
    this._defs = [];
    this._state = new Map();
  }

  // def: { id, name, priority,
  //        port?, portCandidates?, url?, healthPath?,
  //        probe?, capture?, input? }
  register(def) {
    if (!def || !def.id) throw new Error("registry: def.id required");
    // Normalize: port → portCandidates
    if (!def.portCandidates && def.port) def.portCandidates = [def.port];
    if (!def.probe && !def.portCandidates) {
      throw new Error(
        "registry: '" + def.id + "' needs probe() or port/portCandidates",
      );
    }
    // Default url derived from first port candidate if not explicit (will be overridden by latched port)
    if (!def.url && def.portCandidates && def.portCandidates.length > 0) {
      def.url = "http://127.0.0.1:" + def.portCandidates[0];
    }
    this._defs.push(def);
    this._defs.sort(function (a, b) {
      return (a.priority || 99) - (b.priority || 99);
    });
    return this;
  }

  // Run all probes in parallel; resolves with list of online ids
  probeAll() {
    var self = this;
    var tasks = this._defs.map(function (d) {
      return self._probeOne(d);
    });
    return Promise.all(tasks).then(function () {
      return self.onlineIds();
    });
  }

  _probeOne(def) {
    var self = this;
    // Custom probe wins (sunlogin bridge, complex checks)
    if (def.probe) {
      var p;
      try {
        p = Promise.resolve(def.probe());
      } catch (e) {
        p = Promise.resolve(false);
      }
      return p
        .catch(function () {
          return false;
        })
        .then(function (result) {
          var alive = !!result;
          self._state.set(def.id, {
            url: def.url || "",
            status: alive ? "online" : "offline",
            lastCheck: Date.now(),
            detail: typeof result === "string" ? result : undefined,
          });
        });
    }
    // 柔弱胜刚强: probe each candidate in order, latch first alive
    var ports = def.portCandidates || [];
    var healthPath = def.healthPath || "/status";
    var i = 0;
    function tryNext() {
      if (i >= ports.length) {
        self._state.set(def.id, {
          url: "http://127.0.0.1:" + (ports[0] || 0),
          status: "offline",
          lastCheck: Date.now(),
        });
        return;
      }
      var port = ports[i++];
      return probeHttp(port, healthPath).then(function (alive) {
        if (alive) {
          self._state.set(def.id, {
            url: "http://127.0.0.1:" + port,
            status: "online",
            lastCheck: Date.now(),
            port: port,
          });
          return;
        }
        return tryNext();
      });
    }
    return Promise.resolve().then(tryNext);
  }

  // ── Read-only views ───────────────────────────────────────────
  get(id) {
    return this._state.get(id);
  }
  has(id) {
    return this._state.has(id);
  }
  forEach(fn) {
    return this._state.forEach(fn);
  }
  get state() {
    return this._state;
  }
  defs() {
    return this._defs.slice();
  }
  defById(id) {
    for (var i = 0; i < this._defs.length; i++) {
      if (this._defs[i].id === id) return this._defs[i];
    }
    return null;
  }
  onlineIds() {
    var ids = [];
    this._state.forEach(function (v, k) {
      if (v.status === "online") ids.push(k);
    });
    return ids;
  }

  // ── 万法归宗 · Priority-ordered operations ────────────────────
  // "best stream source" = first online entry that actually streams (capture exists)
  best() {
    for (var i = 0; i < this._defs.length; i++) {
      var d = this._defs[i];
      if (!d.capture) continue;
      var s = this._state.get(d.id);
      if (s && s.status === "online") return { name: d.id, url: s.url };
    }
    return null;
  }

  // 柔弱胜刚强: mark a source offline (used by captureBest/inputBest on failure)
  _markOffline(id, reason) {
    var s = this._state.get(id);
    if (s) {
      s.status = "offline";
      s.lastError = reason && reason.message ? reason.message : String(reason);
      s.lastCheck = Date.now();
    }
  }

  // Try each registered capture() in priority order. Returns null if none produced ok result.
  // On failure: mark source offline so the next consumer call skips it immediately.
  captureBest(ctx) {
    var self = this;
    var defs = this._defs.slice();
    var state = this._state;
    var i = 0;
    function next() {
      if (i >= defs.length) return Promise.resolve(null);
      var d = defs[i++];
      if (!d.capture) return next();
      var s = state.get(d.id);
      if (!s || s.status !== "online") return next();
      return Promise.resolve()
        .then(function () {
          return d.capture(ctx || {}, s.url);
        })
        .then(
          function (r) {
            if (r && r.ok !== false) return r;
            self._markOffline(d.id, "capture returned !ok");
            return next();
          },
          function (err) {
            self._markOffline(d.id, err);
            return next();
          },
        );
    }
    return next();
  }

  // Try each registered input() in priority order; rejects if none succeeds.
  // On failure: mark source offline so the next consumer call skips it immediately.
  inputBest(action, params, serial) {
    var self = this;
    var defs = this._defs.slice();
    var state = this._state;
    var i = 0;
    function next() {
      if (i >= defs.length) {
        return Promise.reject(new Error("no input source available"));
      }
      var d = defs[i++];
      if (!d.input) return next();
      var s = state.get(d.id);
      if (!s || s.status !== "online") return next();
      return Promise.resolve()
        .then(function () {
          return d.input(action, params || {}, serial || "", s.url);
        })
        .catch(function (err) {
          self._markOffline(d.id, err);
          return next();
        });
    }
    return next();
  }
}

module.exports = { ScreenRegistry: ScreenRegistry, probeHttp: probeHttp };
