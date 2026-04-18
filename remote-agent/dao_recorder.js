// ═══════════════════════════════════════════════════════════════════
// dao_recorder.js — 会话录制 (JPEG 帧序列 + multipart MJPEG 回放)
// 道法自然 · 无所不容
//
// 设计:
//   - 采样式录制: 定时拉 /screen/capture 快照 → JPEG 文件
//   - 零编码: 不重编码, 不转 MP4, 浏览器 multipart/x-mixed-replace 直接播
//   - 源无关: 任何 capture 函数 (ghost/dao/scrcpy/adb_hub/agent 都行) 均可录
//   - 弱依赖: 纯 Node 内置, 无 ffmpeg/libvpx 之类外设
//
// 存储:
//   <recordDir>/
//     <id>/
//       meta.json          {id, startedAt, stoppedAt, fps, frames, source, status, sizeBytes}
//       frames/
//         000001.jpg
//         000002.jpg
//         ...
// ═══════════════════════════════════════════════════════════════════

"use strict";

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var DEFAULT_FPS = 1; // 1 fps = 省盘省带宽; 回放可加速
var DEFAULT_MAX_DURATION_SEC = 3600; // 1h 上限保护
var MAX_FPS = 10; // 超过 10fps 就该上 WebRTC, 不是录播场景

function pad6(n) {
  var s = String(n);
  while (s.length < 6) s = "0" + s;
  return s;
}

function fmtTs(d) {
  // 2026-04-19_01-36-00
  function p(n) {
    return n < 10 ? "0" + n : "" + n;
  }
  return (
    d.getFullYear() +
    "-" +
    p(d.getMonth() + 1) +
    "-" +
    p(d.getDate()) +
    "_" +
    p(d.getHours()) +
    "-" +
    p(d.getMinutes()) +
    "-" +
    p(d.getSeconds())
  );
}

function genId() {
  var d = new Date();
  var rnd = crypto.randomBytes(3).toString("hex");
  return fmtTs(d) + "_" + rnd;
}

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
}

function safeWriteJson(p, obj) {
  var tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

function safeReadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return null;
  }
}

function dirSize(dir) {
  var total = 0;
  try {
    var files = fs.readdirSync(dir);
    for (var i = 0; i < files.length; i++) {
      var full = path.join(dir, files[i]);
      var st = fs.statSync(full);
      total += st.isFile() ? st.size : dirSize(full);
    }
  } catch (e) {}
  return total;
}

function rmDir(dir) {
  // Node 14.14+ 有 fs.rmSync({recursive:true}), 兜底手写一次
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  } catch (e) {}
  try {
    var files = fs.readdirSync(dir);
    for (var i = 0; i < files.length; i++) {
      var full = path.join(dir, files[i]);
      if (fs.statSync(full).isDirectory()) rmDir(full);
      else fs.unlinkSync(full);
    }
    fs.rmdirSync(dir);
  } catch (e) {}
}

/**
 * DaoRecorder — 会话录制器
 *
 * @param {Object} opts
 * @param {string} opts.recordDir     录制根目录
 * @param {Function} opts.captureFn   () => Promise<Buffer>  // 返回一帧 JPEG
 * @param {Function} [opts.log]       日志函数 (msg) => void
 */
function DaoRecorder(opts) {
  opts = opts || {};
  this.recordDir = opts.recordDir || path.join(process.cwd(), "recordings");
  this.captureFn =
    opts.captureFn ||
    function () {
      return Promise.reject(new Error("no captureFn configured"));
    };
  this.log =
    opts.log ||
    function (m) {
      console.log("[recorder] " + m);
    };
  this.sessions = new Map(); // id → {timer, meta, dir}
  ensureDir(this.recordDir);
}

/**
 * 启动录制.
 * @param {Object} [options]
 * @param {number} [options.fps=1]               帧率
 * @param {number} [options.maxDurationSec=3600] 最长持续秒
 * @param {string} [options.source="auto"]       元信息标识
 * @returns {Object} {id, meta}
 */
DaoRecorder.prototype.start = function (options) {
  options = options || {};
  var fps = Math.min(
    MAX_FPS,
    Math.max(0.1, Number(options.fps) || DEFAULT_FPS),
  );
  var maxDur = Math.max(
    1,
    Math.min(86400, Number(options.maxDurationSec) || DEFAULT_MAX_DURATION_SEC),
  );
  var source = String(options.source || "auto").slice(0, 32);

  var id = genId();
  var dir = path.join(this.recordDir, id);
  var framesDir = path.join(dir, "frames");
  ensureDir(framesDir);

  var meta = {
    id: id,
    startedAt: Date.now(),
    stoppedAt: null,
    fps: fps,
    frames: 0,
    source: source,
    status: "recording",
    sizeBytes: 0,
    maxDurationSec: maxDur,
  };
  safeWriteJson(path.join(dir, "meta.json"), meta);

  var self = this;
  var frameIdx = 0;
  var startMs = Date.now();
  var intervalMs = Math.max(50, Math.floor(1000 / fps));

  // 单帧抓取+落盘 — 返回 Promise, 保证测试可确定性 await
  function captureOne() {
    return new Promise(function (resolve) {
      if (Date.now() - startMs > maxDur * 1000) {
        self.log("自动停止 (达 maxDurationSec): " + id);
        resolve({ stopped: true });
        return;
      }
      self
        .captureFn()
        .then(function (buf) {
          if (!buf || !Buffer.isBuffer(buf) || buf.length < 16) {
            resolve({ written: false });
            return;
          }
          frameIdx++;
          var fname = pad6(frameIdx) + ".jpg";
          var fpath = path.join(framesDir, fname);
          fs.writeFile(fpath, buf, function (err) {
            if (err) {
              self.log("帧写入失败 " + id + "/" + fname + ": " + err.message);
              resolve({ written: false, error: err.message });
              return;
            }
            meta.frames = frameIdx;
            if (frameIdx % 10 === 0) {
              meta.sizeBytes = dirSize(dir);
              safeWriteJson(path.join(dir, "meta.json"), meta);
            }
            resolve({ written: true, frameIdx: frameIdx });
          });
        })
        .catch(function (e) {
          self.log("抓帧失败 " + id + ": " + e.message);
          resolve({ written: false, error: e.message });
        });
    });
  }

  // 递归 setTimeout 调度: 比 setInterval 更抗事件循环压力, 自带串行/背压
  var nextTimer = null;
  var stopped = false;
  function loop() {
    if (stopped) return;
    captureOne().then(function (r) {
      if (r && r.stopped) {
        self.stop(id);
        return;
      }
      if (stopped) return;
      nextTimer = setTimeout(loop, intervalMs);
      if (nextTimer && nextTimer.unref) nextTimer.unref();
    });
  }

  // 会话状态 — 保留 cancel hook 给 stop() 用
  var sessionState = {
    meta: meta,
    dir: dir,
    cancel: function () {
      stopped = true;
      if (nextTimer) clearTimeout(nextTimer);
    },
    captureOne: captureOne, // 测试/外部强制触发一帧
  };
  this.sessions.set(id, sessionState);
  this.log("开始录制 " + id + " @ " + fps + "fps (source=" + source + ")");
  // 立即抓第一帧, 避免 1fps 时等 1 秒才出画
  loop();

  return { id: id, meta: meta };
};

/**
 * 停止录制.
 * @param {string} id
 * @returns {Object|null} 最终 meta; 未知 id 返回 null
 */
DaoRecorder.prototype.stop = function (id) {
  var s = this.sessions.get(id);
  if (!s) {
    // 也许进程重启后 id 还在磁盘上, 用户手动 stop — 读 meta 标记 stopped
    var diskMeta = this._readMeta(id);
    if (diskMeta && diskMeta.status === "recording") {
      diskMeta.status = "stopped";
      diskMeta.stoppedAt = Date.now();
      diskMeta.sizeBytes = dirSize(path.join(this.recordDir, id));
      safeWriteJson(path.join(this.recordDir, id, "meta.json"), diskMeta);
      return diskMeta;
    }
    return null;
  }
  if (typeof s.cancel === "function") s.cancel();
  s.meta.status = "stopped";
  s.meta.stoppedAt = Date.now();
  s.meta.sizeBytes = dirSize(s.dir);
  safeWriteJson(path.join(s.dir, "meta.json"), s.meta);
  this.sessions.delete(id);
  this.log("停止录制 " + id + " · 帧数=" + s.meta.frames);
  return s.meta;
};

/**
 * 测试/外部强制抓一帧 (不等 setTimeout 周期) — 对抗事件循环压力下的确定性验证
 * @param {string} id 活跃会话 id
 * @returns {Promise<Object>} {written, frameIdx, error?}
 */
DaoRecorder.prototype.captureNow = function (id) {
  var s = this.sessions.get(id);
  if (!s || typeof s.captureOne !== "function") {
    return Promise.resolve({ written: false, error: "not recording" });
  }
  return s.captureOne();
};

/** 停止所有活跃会话. 常用于进程退出. */
DaoRecorder.prototype.stopAll = function () {
  var ids = [];
  this.sessions.forEach(function (_, id) {
    ids.push(id);
  });
  var self = this;
  ids.forEach(function (id) {
    self.stop(id);
  });
  return ids.length;
};

/**
 * 列出所有录制 (扫磁盘, 不只是活跃会话)
 * @returns {Array<meta>}
 */
DaoRecorder.prototype.list = function () {
  var out = [];
  try {
    var entries = fs.readdirSync(this.recordDir);
    for (var i = 0; i < entries.length; i++) {
      var id = entries[i];
      var meta = this._readMeta(id);
      if (meta) out.push(meta);
    }
  } catch (e) {}
  out.sort(function (a, b) {
    return (b.startedAt || 0) - (a.startedAt || 0);
  });
  return out;
};

/** 读取单个录制元信息 */
DaoRecorder.prototype.get = function (id) {
  return this._readMeta(id);
};

DaoRecorder.prototype._readMeta = function (id) {
  if (!id || typeof id !== "string" || id.indexOf("..") !== -1) return null;
  var dir = path.join(this.recordDir, id);
  var meta = safeReadJson(path.join(dir, "meta.json"));
  if (meta && this.sessions.has(id)) {
    // 实时更新活跃会话的帧数
    var live = this.sessions.get(id).meta;
    meta.frames = live.frames;
    meta.status = live.status;
  }
  return meta;
};

/**
 * 删除录制
 * @returns {boolean}
 */
DaoRecorder.prototype.delete = function (id) {
  if (!id || typeof id !== "string" || id.indexOf("..") !== -1) return false;
  if (this.sessions.has(id)) this.stop(id);
  var dir = path.join(this.recordDir, id);
  if (!fs.existsSync(dir)) return false;
  rmDir(dir);
  this.log("已删除 " + id);
  return true;
};

/**
 * 流式回放: 写 multipart/x-mixed-replace MJPEG 到 HTTP 响应
 * 浏览器 <img src="/dao/record/play?id=xxx"> 直接播放
 *
 * @param {string} id
 * @param {http.ServerResponse} res
 * @param {Object} [opts]
 * @param {number} [opts.speed=1.0]  播放倍速
 * @param {boolean} [opts.loop=false] 循环播放
 */
DaoRecorder.prototype.stream = function (id, res, opts) {
  opts = opts || {};
  var speed = Math.max(0.1, Math.min(10, Number(opts.speed) || 1.0));
  var loop = opts.loop === true;
  var meta = this._readMeta(id);
  if (!meta) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
    return;
  }
  var framesDir = path.join(this.recordDir, id, "frames");
  var files;
  try {
    files = fs.readdirSync(framesDir).filter(function (f) {
      return /\.jpg$/i.test(f);
    });
    files.sort();
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "frames dir unreadable" }));
    return;
  }
  if (files.length === 0) {
    res.writeHead(204);
    res.end();
    return;
  }

  var boundary = "daoplayback";
  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=" + boundary,
    "Cache-Control": "no-cache",
    Connection: "close",
    Pragma: "no-cache",
  });

  var idx = 0;
  var frameMs = Math.max(20, Math.floor(1000 / (meta.fps || 1) / speed));
  var self = this;
  var aborted = false;

  res.on("close", function () {
    aborted = true;
  });

  function nextFrame() {
    if (aborted) return;
    if (idx >= files.length) {
      if (loop) {
        idx = 0;
      } else {
        try {
          res.end("--" + boundary + "--\r\n");
        } catch (e) {}
        return;
      }
    }
    var fpath = path.join(framesDir, files[idx]);
    fs.readFile(fpath, function (err, buf) {
      if (aborted) return;
      if (err || !buf) {
        idx++;
        setImmediate(nextFrame);
        return;
      }
      try {
        res.write("--" + boundary + "\r\n");
        res.write("Content-Type: image/jpeg\r\n");
        res.write("Content-Length: " + buf.length + "\r\n\r\n");
        res.write(buf);
        res.write("\r\n");
      } catch (e) {
        aborted = true;
        return;
      }
      idx++;
      setTimeout(nextFrame, frameMs);
    });
  }
  nextFrame();
};

/**
 * 导出单帧 (用于缩略图)
 */
DaoRecorder.prototype.thumbnail = function (id) {
  if (!id || typeof id !== "string" || id.indexOf("..") !== -1) return null;
  var framesDir = path.join(this.recordDir, id, "frames");
  try {
    var files = fs.readdirSync(framesDir).filter(function (f) {
      return /\.jpg$/i.test(f);
    });
    files.sort();
    if (files.length === 0) return null;
    // 取中间帧, 通常比首帧更有代表性
    var mid = files[Math.floor(files.length / 2)];
    return fs.readFileSync(path.join(framesDir, mid));
  } catch (e) {
    return null;
  }
};

module.exports = {
  DaoRecorder: DaoRecorder,
  _pad6: pad6,
  _genId: genId,
  _DEFAULT_FPS: DEFAULT_FPS,
  _MAX_FPS: MAX_FPS,
};
