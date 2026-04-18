// ╔══════════════════════════════════════════════════════════════╗
// ║  道 · 守护常驻 — 开机自启, 不靠手动                          ║
// ║                                                              ║
// ║  柔弱胜刚强: Windows 用 Scheduled Task (schtasks)            ║
// ║  免管理员 (当前用户登录时触发), 免装 NSSM 等第三方依赖       ║
// ║  Linux/macOS 暂不支持 (后续可加 systemd-user / launchd)       ║
// ╚══════════════════════════════════════════════════════════════╝

"use strict";

const { spawn, execFile } = require("child_process");
const path = require("path");
const os = require("os");

const TASK_NAME = "DaoRemoteHub";

function isWindows() {
  return process.platform === "win32";
}

function nodeExe() {
  return process.execPath;
}

function daoScript() {
  // dao.js 与本文件位于同一目录
  return path.join(__dirname, "dao.js");
}

// ───────────────────────────────────────────────
// schtasks helper — Promise 封装, 输出按 UTF-8 解码
// ───────────────────────────────────────────────
function run(cmd, args, opts) {
  return new Promise(function (resolve) {
    try {
      execFile(
        cmd,
        args,
        Object.assign({ windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, opts || {}),
        function (err, stdout, stderr) {
          resolve({
            ok: !err,
            code: err ? (err.code != null ? err.code : -1) : 0,
            stdout: (stdout || "").toString(),
            stderr: (stderr || "").toString(),
            error: err ? err.message : null,
          });
        },
      );
    } catch (e) {
      resolve({ ok: false, code: -1, stdout: "", stderr: "", error: e.message });
    }
  });
}

// ───────────────────────────────────────────────
// install — 创建登录时自启的计划任务
//   extraArgs: 追加给 dao.js 的参数数组 (如 ["--no-browser"])
// ───────────────────────────────────────────────
async function install(opts) {
  opts = opts || {};
  if (!isWindows()) {
    return {
      ok: false,
      error: "unsupported_platform",
      hint: "非 Windows 系统暂未支持，欢迎 PR systemd/launchd 实现",
      platform: process.platform,
    };
  }
  var extraArgs = opts.extraArgs || ["--no-browser"];
  var taskName = opts.taskName || TASK_NAME;
  // schtasks /TR 的参数是一整个字符串, 空格路径需引号包裹
  var tr =
    '"' +
    nodeExe() +
    '" "' +
    daoScript() +
    '"' +
    (extraArgs.length ? " " + extraArgs.join(" ") : "");
  var args = [
    "/Create",
    "/SC",
    "ONLOGON",
    "/TN",
    taskName,
    "/TR",
    tr,
    "/RL",
    "LIMITED", // 当前用户权限, 避免 UAC; 如需更高用 /RL HIGHEST (首次会弹权限)
    "/F", // 覆盖旧同名
  ];
  var r = await run("schtasks", args);
  return {
    ok: r.ok,
    task: taskName,
    tr: tr,
    stdout: r.stdout.trim(),
    stderr: r.stderr.trim(),
    error: r.error,
  };
}

// ───────────────────────────────────────────────
// uninstall — 删除计划任务
// ───────────────────────────────────────────────
async function uninstall(opts) {
  opts = opts || {};
  if (!isWindows()) {
    return {
      ok: false,
      error: "unsupported_platform",
      platform: process.platform,
    };
  }
  var taskName = opts.taskName || TASK_NAME;
  var r = await run("schtasks", ["/Delete", "/TN", taskName, "/F"]);
  return {
    ok: r.ok,
    task: taskName,
    stdout: r.stdout.trim(),
    stderr: r.stderr.trim(),
    error: r.error,
  };
}

// ───────────────────────────────────────────────
// status — 查询安装状态
// ───────────────────────────────────────────────
async function status(opts) {
  opts = opts || {};
  if (!isWindows()) {
    return {
      installed: false,
      platform: process.platform,
      error: "unsupported_platform",
    };
  }
  var taskName = opts.taskName || TASK_NAME;
  var r = await run("schtasks", ["/Query", "/TN", taskName, "/FO", "LIST", "/V"]);
  if (!r.ok) {
    return { installed: false, task: taskName };
  }
  // 简单解析关键字段 — 多语言兼容: 只挑出 "Next Run Time", "Status" 这类
  var lines = r.stdout.split(/\r?\n/);
  var info = {};
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/^([^:]+):\s*(.*)$/);
    if (m) info[m[1].trim()] = m[2].trim();
  }
  return { installed: true, task: taskName, info: info, raw: r.stdout };
}

module.exports = {
  install: install,
  uninstall: uninstall,
  status: status,
  TASK_NAME: TASK_NAME,
  _run: run,
  _nodeExe: nodeExe,
  _daoScript: daoScript,
};

// ───────────────────────────────────────────────
// CLI: node dao_service.js install | uninstall | status
// ───────────────────────────────────────────────
if (require.main === module) {
  var action = (process.argv[2] || "status").toLowerCase();
  var fn =
    action === "install" ? install : action === "uninstall" ? uninstall : status;
  fn().then(function (r) {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok || r.installed ? 0 : 1);
  });
}
