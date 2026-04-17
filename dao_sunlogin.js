// ╔══════════════════════════════════════════════════════════════╗
// ║  道 · 向日葵 — 万法之资 · 从根本底层调用一切             ║
// ║                                                              ║
// ║  道法自然: 向日葵之所有, 皆为我用                           ║
// ║  config.ini解析 → Oray云API → CLI启动 → 全功能集成        ║
// ║                                                              ║
// ║  Capabilities:                                               ║
// ║    · 设备信息 (ID/主机名/账号/版本)                         ║
// ║    · 远程设备列表 (云端API查询)                             ║
// ║    · 远程桌面/文件/CMD启动                                  ║
// ║    · 端口转发管理                                           ║
// ║    · 插件能力检测                                           ║
// ║    · 安全设置读取                                           ║
// ╚══════════════════════════════════════════════════════════════╝

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync, spawn } = require("child_process");

// ═══════════════════════════════════════════════════════════════
//  Config Parser — 道生一: 解析config.ini, 万物从此涌现
// ═══════════════════════════════════════════════════════════════

function findSunloginPath() {
  // 道法自然: 多路径自适应探测
  var candidates = [
    process.env.SUNLOGIN_PATH,
    "D:\\安装的软件\\SunloginClient",
    "C:\\Program Files\\Oray\\SunLogin\\SunloginClient",
    "C:\\Program Files (x86)\\Oray\\SunLogin\\SunloginClient",
  ];

  // 从运行进程中获取路径 (最可靠)
  try {
    var psScript =
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;" +
      "Get-Process -Name SunloginClient -EA SilentlyContinue | " +
      "Where-Object{$_.Path} | Select-Object -First 1 -ExpandProperty Path";
    var encoded = Buffer.from(psScript, "utf16le").toString("base64");
    var result = execSync(
      "powershell.exe -NoProfile -EncodedCommand " + encoded,
      { timeout: 5000, windowsHide: true },
    )
      .toString()
      .trim();
    if (result && fs.existsSync(result)) {
      candidates.unshift(path.dirname(result));
    }
  } catch (e) {}

  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i] && fs.existsSync(path.join(candidates[i], "config.ini"))) {
      return candidates[i];
    }
  }
  return null;
}

function parseIni(content) {
  var result = {};
  var section = "base";
  result[section] = {};
  content.split(/\r?\n/).forEach(function (line) {
    line = line.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) return;
    var secMatch = line.match(/^\[(.+)\]$/);
    if (secMatch) {
      section = secMatch[1];
      if (!result[section]) result[section] = {};
      return;
    }
    var eqIdx = line.indexOf("=");
    if (eqIdx > 0) {
      var key = line.substring(0, eqIdx).trim();
      var val = line.substring(eqIdx + 1).trim();
      result[section][key] = val;
    }
  });
  return result;
}

function parseConfig(slPath) {
  var configPath = path.join(slPath, "config.ini");
  if (!fs.existsSync(configPath)) return null;
  try {
    var content = fs.readFileSync(configPath, "utf-8");
    return parseIni(content);
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  Device Info — 一生二: 从config提取设备全貌
// ═══════════════════════════════════════════════════════════════

function extractDeviceInfo(config, slPath) {
  var base = config.base || {};
  var desktop = config.desktop || {};
  var security = config.security || {};
  var forward = config.forward || {};

  // 解析端口转发通道
  var channels = [];
  if (forward.channels) {
    forward.channels.split(";").forEach(function (ch) {
      if (!ch.trim()) return;
      var params = {};
      ch.split("&").forEach(function (p) {
        var kv = p.split("=");
        if (kv.length === 2) {
          params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
        }
      });
      if (params.name) channels.push(params);
    });
  }

  return {
    // 基本信息
    hostname: base.hostname || "",
    account: base.account || base.bind_account || "",
    nick: base.nick || "",
    userId: base.user_id || "",
    level: base.levelname || base.level || "free",
    version: base.full_version || "",
    checkVersion: base.check_new_version || "",
    isEnterprise: base.is_enterprise === "1",
    language: base.language || "0",
    macAddress: base.macaddress || "",
    resolution: {
      width: parseInt(base.width || "0"),
      height: parseInt(base.height || "0"),
    },

    // 安装路径
    installPath: slPath,
    configPath: path.join(slPath, "config.ini"),
    exePath: path.join(slPath, "SunloginClient.exe"),
    agentExePath: path.join(slPath, "agent", "SunloginClient.exe"),

    // API服务器
    apiServer: base.clientapi || "api-std.sunlogin.oray.com",
    slapiServer: base.slapiserver || "slapi.oray.net",

    // 桌面设置
    desktop: {
      mirrorDriver: desktop.enablemirrordriver === "1",
      disableEffects: desktop.disabledesktopeffects === "1",
      autoAuth: desktop.autoauth === "1",
      autoLock: desktop.autolockws === "1",
      recording: desktop.enablerecord === "1",
      dpms: desktop.enabledpms === "1",
      confirmTime: parseInt(desktop.confirmtime || "15"),
    },

    // 安全设置
    security: {
      useCustomPassword: security.usecustompassword === "1",
      useWindowsUser: security.usewindowuser === "1",
      wakeupSelected: security.wakeupselected === "1",
      autoLock: security.autolock === "1",
      sensitiveProcess: security.sensitive_process === "1",
    },

    // 端口转发
    portForwarding: channels,

    // 截图路径
    screenshotsPath: base.screenshots_path || "",
  };
}

// ═══════════════════════════════════════════════════════════════
//  Plugin Detection — 二生三: 检测所有可用插件
// ═══════════════════════════════════════════════════════════════

function detectPlugins(slPath) {
  var pluginDir = path.join(slPath, "plugins");
  var plugins = [];
  var pluginMap = {
    "sl-client-desktop.dll": {
      id: "desktop",
      name: "远程桌面(被控)",
      type: "client",
    },
    "sl-client-file.dll": {
      id: "file",
      name: "远程文件(被控)",
      type: "client",
    },
    "sl-client-cmd.dll": {
      id: "cmd",
      name: "远程命令(被控)",
      type: "client",
    },
    "sl-client-camera.dll": {
      id: "camera",
      name: "远程摄像头(被控)",
      type: "client",
    },
    "sl-client-audio.dll": {
      id: "audio",
      name: "远程音频(被控)",
      type: "client",
    },
    "sl-client-ortc.dll": {
      id: "ortc",
      name: "WebRTC(被控)",
      type: "client",
    },
    "sl-client-rdp.dll": {
      id: "rdp_client",
      name: "RDP(被控)",
      type: "client",
    },
    "sl-client-saddc.dll": {
      id: "saddc",
      name: "SADDC(被控)",
      type: "client",
    },
    "sl-client-usbip.dll": {
      id: "usbip_client",
      name: "USB重定向(被控)",
      type: "client",
    },
    "sl-control-desktop.dll": {
      id: "ctrl_desktop",
      name: "远程桌面(主控)",
      type: "control",
    },
    "sl-control-file.dll": {
      id: "ctrl_file",
      name: "远程文件(主控)",
      type: "control",
    },
    "sl-control-cmd.dll": {
      id: "ctrl_cmd",
      name: "远程命令(主控)",
      type: "control",
    },
    "sl-control-camera.dll": {
      id: "ctrl_camera",
      name: "远程摄像头(主控)",
      type: "control",
    },
    "sl-control-rdp.dll": {
      id: "ctrl_rdp",
      name: "RDP(主控)",
      type: "control",
    },
    "sl-control-ssh.dll": {
      id: "ctrl_ssh",
      name: "SSH(主控)",
      type: "control",
    },
    "sl-control-usbip.dll": {
      id: "ctrl_usbip",
      name: "USB重定向(主控)",
      type: "control",
    },
    "sl-codec.dll": { id: "codec", name: "编解码器", type: "core" },
    "sl-net-p2p.dll": { id: "p2p", name: "P2P网络", type: "core" },
  };

  if (fs.existsSync(pluginDir)) {
    try {
      fs.readdirSync(pluginDir).forEach(function (file) {
        var info = pluginMap[file.toLowerCase()];
        if (info) {
          var stat = fs.statSync(path.join(pluginDir, file));
          plugins.push(
            Object.assign({}, info, {
              file: file,
              size: stat.size,
            }),
          );
        }
      });
    } catch (e) {}
  }

  // 检测额外工具
  var tools = [];
  var rdpExe = path.join(slPath, "itmprc", "rdp.exe");
  var sshExe = path.join(slPath, "itmprc", "ssh.exe");
  if (fs.existsSync(rdpExe))
    tools.push({ id: "rdp_tunnel", name: "RDP隧道", path: rdpExe });
  if (fs.existsSync(sshExe))
    tools.push({ id: "ssh_tunnel", name: "SSH隧道", path: sshExe });

  // 检测驱动
  var drivers = [];
  var driverDir = path.join(slPath, "driver");
  var driverDefs = {
    Idd64: "IDD虚拟显示器",
    VGC64: "虚拟显卡",
    Mirror64: "镜像驱动",
    Vhid64: "虚拟HID",
    DpmsMonitor64: "DPMS显示器",
    OrayUSBMon: "USB监控",
    OrayUSBStub: "USB桩",
    OrayUSBVHCI: "USB虚拟主控",
    Print64: "虚拟打印",
  };
  if (fs.existsSync(driverDir)) {
    Object.keys(driverDefs).forEach(function (d) {
      if (fs.existsSync(path.join(driverDir, d))) {
        drivers.push({ id: d, name: driverDefs[d] });
      }
    });
  }

  return { plugins: plugins, tools: tools, drivers: drivers };
}

// ═══════════════════════════════════════════════════════════════
//  Process Status — 检测运行状态
// ═══════════════════════════════════════════════════════════════

function getProcessStatus() {
  var status = { service: false, gui: false, watchdog: false, guard: false };
  try {
    var psScript =
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;" +
      "Get-WmiObject Win32_Process | Where-Object { $_.Name -like '*sunlogin*' } | " +
      "ForEach-Object { $_.ProcessId.ToString() + '|' + $_.Name + '|' + $_.CommandLine }";
    var encoded = Buffer.from(psScript, "utf16le").toString("base64");
    var out = execSync(
      "powershell.exe -NoProfile -EncodedCommand " + encoded,
      { timeout: 8000, windowsHide: true },
    )
      .toString()
      .trim();
    var procs = [];
    out.split("\n").forEach(function (line) {
      line = line.trim();
      if (!line) return;
      var parts = line.split("|");
      var pid = parts[0];
      var name = parts[1] || "";
      var cmd = parts.slice(2).join("|");
      var role = "unknown";
      if (cmd.includes("--mod=service")) {
        role = "service";
        status.service = true;
      } else if (cmd.includes("--mod=watch")) {
        role = "watchdog";
        status.watchdog = true;
      } else if (cmd.includes("--cmd=autorun") || (!cmd.includes("--mod=") && name.toLowerCase().includes("sunloginclient"))) {
        role = "gui";
        status.gui = true;
      } else if (name.toLowerCase().includes("guard")) {
        role = "guard";
        status.guard = true;
      }
      procs.push({ pid: parseInt(pid), name: name, role: role });
    });
    status.processes = procs;
    status.running = status.service || status.gui;
  } catch (e) {
    status.error = e.message;
    status.running = false;
  }
  return status;
}

// ═══════════════════════════════════════════════════════════════
//  Oray Cloud API — 三生万物: 连接向日葵云端
// ═══════════════════════════════════════════════════════════════

function orayApiCall(hostname, apiPath, method, headers, body) {
  return new Promise(function (resolve, reject) {
    var opts = {
      hostname: hostname,
      port: 443,
      path: apiPath,
      method: method || "GET",
      headers: Object.assign(
        { "Content-Type": "application/json", Accept: "application/json" },
        headers || {},
      ),
      timeout: 10000,
    };
    var req = https.request(opts, function (res) {
      var data = "";
      res.on("data", function (c) {
        data += c;
      });
      res.on("end", function () {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: JSON.parse(data),
          });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on("error", function (e) {
      reject(e);
    });
    req.on("timeout", function () {
      req.destroy();
      reject(new Error("timeout"));
    });
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

// OAuth2 获取access_token
function getAccessToken(basicToken, apiServer) {
  return orayApiCall(
    apiServer || "slapi.oray.net",
    "/authorization/oauth2/token",
    "POST",
    {
      Authorization: "Basic " + basicToken,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    "grant_type=client_credentials",
  );
}

// 获取设备列表
function getDeviceList(accessToken, apiServer) {
  return orayApiCall(apiServer || "api-std.sunlogin.oray.com", "/api/v2/device/list", "GET", {
    Authorization: "Bearer " + accessToken,
  });
}

// 获取设备在线状态
function getDeviceStatus(accessToken, deviceId, apiServer) {
  return orayApiCall(
    apiServer || "api-std.sunlogin.oray.com",
    "/api/v2/device/" + deviceId + "/status",
    "GET",
    { Authorization: "Bearer " + accessToken },
  );
}

// ═══════════════════════════════════════════════════════════════
//  CLI Launcher — 启动向日葵功能
// ═══════════════════════════════════════════════════════════════

function launchSunlogin(slPath, action, params) {
  var exe = path.join(slPath, "SunloginClient.exe");
  if (!fs.existsSync(exe)) {
    return { ok: false, error: "SunloginClient.exe not found" };
  }

  var args = [];
  switch (action) {
    case "open":
      // 打开向日葵主界面
      break;
    case "connect":
      // 连接到远程设备 (通过模拟UI)
      if (params && params.deviceId) {
        // 向日葵v15不支持直接CLI连接, 通过启动后打开连接界面
        args = [];
      }
      break;
    case "desktop":
      // 远程桌面
      break;
    case "file":
      // 远程文件
      break;
    default:
      break;
  }

  try {
    var proc = spawn(exe, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    proc.unref();
    return {
      ok: true,
      action: action,
      pid: proc.pid,
      exe: exe,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  SunloginBridge — 统一接口类
// ═══════════════════════════════════════════════════════════════

function SunloginBridge() {
  this.slPath = null;
  this.config = null;
  this.deviceInfo = null;
  this.capabilities = null;
  this.processStatus = null;
  this._accessToken = null;
  this._tokenExpiry = 0;
  this.ready = false;
}

SunloginBridge.prototype.init = function () {
  this.slPath = findSunloginPath();
  if (!this.slPath) {
    return { ok: false, error: "Sunlogin not found" };
  }

  this.config = parseConfig(this.slPath);
  if (!this.config) {
    return { ok: false, error: "config.ini parse failed" };
  }

  this.deviceInfo = extractDeviceInfo(this.config, this.slPath);
  this.capabilities = detectPlugins(this.slPath);
  this.processStatus = getProcessStatus();
  this.ready = true;

  return {
    ok: true,
    path: this.slPath,
    version: this.deviceInfo.version,
    hostname: this.deviceInfo.hostname,
    account: this.deviceInfo.account,
    running: this.processStatus.running,
    plugins: this.capabilities.plugins.length,
    tools: this.capabilities.tools.length,
    drivers: this.capabilities.drivers.length,
  };
};

SunloginBridge.prototype.getFullStatus = function () {
  if (!this.ready) return { ok: false, error: "not initialized" };

  // 刷新进程状态
  this.processStatus = getProcessStatus();

  return {
    ok: true,
    device: this.deviceInfo,
    process: this.processStatus,
    capabilities: this.capabilities,
    features: {
      remoteDesktop: this.capabilities.plugins.some(function (p) {
        return p.id === "ctrl_desktop";
      }),
      remoteFile: this.capabilities.plugins.some(function (p) {
        return p.id === "ctrl_file";
      }),
      remoteCmd: this.capabilities.plugins.some(function (p) {
        return p.id === "ctrl_cmd";
      }),
      remoteCamera: this.capabilities.plugins.some(function (p) {
        return p.id === "ctrl_camera";
      }),
      rdp: this.capabilities.plugins.some(function (p) {
        return p.id === "ctrl_rdp";
      }),
      ssh: this.capabilities.plugins.some(function (p) {
        return p.id === "ctrl_ssh";
      }),
      webrtc: this.capabilities.plugins.some(function (p) {
        return p.id === "ortc";
      }),
      p2p: this.capabilities.plugins.some(function (p) {
        return p.id === "p2p";
      }),
      usbRedirect: this.capabilities.plugins.some(function (p) {
        return p.id === "ctrl_usbip";
      }),
      iddVirtualDisplay: this.capabilities.drivers.some(function (d) {
        return d.id === "Idd64";
      }),
      virtualHid: this.capabilities.drivers.some(function (d) {
        return d.id === "Vhid64";
      }),
      portForwarding: this.deviceInfo.portForwarding.length > 0,
    },
  };
};

// 获取云端设备列表 (需要网络)
SunloginBridge.prototype.fetchDevices = function () {
  if (!this.ready) return Promise.reject(new Error("not initialized"));

  var basicToken = (this.config.base || {}).basic_token;
  if (!basicToken) return Promise.reject(new Error("no basic_token in config"));

  var self = this;
  var apiServer = this.deviceInfo.slapiServer;

  // 检查token缓存
  if (this._accessToken && Date.now() < this._tokenExpiry) {
    return getDeviceList(this._accessToken, this.deviceInfo.apiServer);
  }

  return getAccessToken(basicToken, apiServer).then(function (tokenRes) {
    if (tokenRes.data && tokenRes.data.access_token) {
      self._accessToken = tokenRes.data.access_token;
      self._tokenExpiry =
        Date.now() + (tokenRes.data.expires_in || 3600) * 1000 - 60000;
      return getDeviceList(
        self._accessToken,
        self.deviceInfo.apiServer,
      );
    }
    return { status: tokenRes.status, data: tokenRes.data, error: "auth failed" };
  });
};

SunloginBridge.prototype.launch = function (action, params) {
  if (!this.ready) return { ok: false, error: "not initialized" };
  return launchSunlogin(this.slPath, action, params);
};

SunloginBridge.prototype.refreshProcess = function () {
  this.processStatus = getProcessStatus();
  return this.processStatus;
};

module.exports = { SunloginBridge: SunloginBridge };
