module.exports = function (PUBLIC_URL, TOKEN) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>道 · 远程中枢</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>道</text></svg>">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0e17;color:#e0e0e0;font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;min-height:100vh}
.app{max-width:820px;margin:0 auto;padding:12px 16px}
.hdr{display:flex;align-items:center;justify-content:space-between;padding:16px 0;flex-wrap:wrap;gap:8px}
.hdr h1{font-size:20px;color:#7c8aff;letter-spacing:2px}
.hdr .sub{font-size:11px;color:#556;margin-top:2px}
.pills{display:flex;gap:8px}
.pill{display:flex;align-items:center;gap:5px;padding:5px 12px;border-radius:20px;font-size:12px;font-weight:600;transition:all .3s}
.pill .d{width:7px;height:7px;border-radius:50%;animation:pulse 1.5s infinite}
.pill.on{background:#0d1a0d;color:#4caf50}.pill.on .d{background:#4caf50}
.pill.off{background:#1a1a2a;color:#556}.pill.off .d{background:#556;animation:none}
.pill.wait{background:#1a1a0d;color:#ffa726}.pill.wait .d{background:#ffa726}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.tabs{display:flex;gap:2px;border-bottom:1px solid #1a2040;margin-bottom:16px;overflow-x:auto}
.tab{background:none;border:none;color:#556;padding:10px 16px;font-size:13px;cursor:pointer;border-bottom:2px solid transparent;font-family:inherit;transition:all .2s;white-space:nowrap}
.tab:hover{color:#a0a8c0}.tab.act{color:#7c8aff;border-bottom-color:#7c8aff}
.page{display:none}.page.act{display:block}
.card{background:#111828;border-radius:12px;padding:18px;margin-bottom:14px;border:1px solid #1a2040}
.card h3{color:#7c8aff;font-size:15px;margin-bottom:10px}
.card p{font-size:13px;color:#889;line-height:1.8}
.card p b{color:#c0c8e0}
.card.connected{border-color:#4caf5040}
.cmd-box{background:#0a0e14;border:1px solid #2a3050;border-radius:8px;padding:14px;margin:10px 0;font-family:'Cascadia Code','Fira Code',Consolas,monospace;font-size:12px;color:#7c8aff;word-break:break-all;white-space:pre-wrap;user-select:all}
.cbtn{background:#7c8aff;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;margin-top:4px;transition:all .2s}
.cbtn:hover{background:#6a78ee;transform:translateY(-1px)}.cbtn.ok{background:#4caf50}
.cbtn:active{transform:translateY(0)}
.msg{padding:12px 16px;margin:8px 0;border-radius:10px;font-size:13px;line-height:1.7;animation:fadeIn .3s}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.msg.system{background:#111828;border-left:3px solid #7c8aff;color:#a0a8c0}
.msg.alert-ok{background:#0d1a0d;border-left:3px solid #4caf50;color:#a0d0a0}
.msg.alert-warn{background:#1a1a0d;border-left:3px solid #ffa726;color:#d0c090}
.msg.alert-err{background:#1a0d0d;border-left:3px solid #f44336;color:#d0a0a0}
.msg.action{background:#131a2a;border:1px solid #2a3050}
.msg.action h3{color:#7c8aff;font-size:14px;margin-bottom:8px}
.msg.action .steps{font-size:12px;color:#889;line-height:2}.msg.action .steps b{color:#c0c8e0}
.term{background:#060a10;border:1px solid #1a2040;border-radius:10px;min-height:300px;max-height:70vh;overflow-y:auto;font-family:'Cascadia Code','Fira Code',Consolas,monospace;font-size:12px;padding:12px}
.te{margin-bottom:12px;border-bottom:1px solid #111828;padding-bottom:10px}
.te-cmd{color:#4caf50;margin-bottom:4px}.te-cmd::before{content:'> ';color:#556}
.te-out{color:#a0a8c0;white-space:pre-wrap;word-break:break-all;max-height:400px;overflow-y:auto}
.te-err{color:#f44336}
.te-t{color:#445;font-size:10px;margin-top:4px}
.te-pending .te-out{color:#ffa726;animation:pulse 1.5s infinite}
.ti{display:flex;gap:8px;margin-top:10px}
.ti input{flex:1;background:#0a0e14;border:1px solid #2a3050;border-radius:8px;padding:10px 14px;color:#e0e0e0;font-family:'Cascadia Code','Fira Code',Consolas,monospace;font-size:13px;outline:none;transition:border-color .2s}
.ti input:focus{border-color:#7c8aff}
.ti input::placeholder{color:#334}
.ti button{background:#7c8aff;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;transition:all .2s}
.ti button:hover:not(:disabled){background:#6a78ee}
.ti button:disabled{background:#222;color:#445;cursor:not-allowed}
.empty{text-align:center;color:#334;padding:40px;font-size:14px}
.pw{background:#1a2040;border-radius:6px;height:5px;margin:10px 0;overflow:hidden}
.pf{height:100%;background:linear-gradient(90deg,#7c8aff,#4caf50);border-radius:6px;transition:width .4s}
.ti-r{display:flex;align-items:center;padding:6px 0;font-size:12px;border-bottom:1px solid #0a0e17}
.ti-r .n{flex:1;color:#889}
.ti-r .r{padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;min-width:36px;text-align:center}
.ti-r .r.pass{background:#0d1a0d;color:#4caf50}
.ti-r .r.fail{background:#1a0d0d;color:#f44336}
.ti-r .r.wait{background:#1a1a0d;color:#ffa726}
.ti-r .dd{font-size:10px;color:#556;margin-left:8px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sg{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.si{background:#0d1220;border-radius:10px;padding:14px;border:1px solid #1a204020}
.si .l{font-size:11px;color:#556;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px}
.si .v{font-size:15px;color:#c0c8e0;font-weight:600}
.si .v.sm{font-size:12px;font-weight:400}
.bigb{display:block;width:100%;padding:12px;margin:10px 0;border-radius:10px;border:none;font-size:14px;font-family:inherit;cursor:pointer;text-align:center;background:linear-gradient(135deg,#7c8aff,#5a68dd);color:#fff;transition:all .2s}
.bigb:hover{transform:translateY(-1px);box-shadow:0 4px 20px #7c8aff40}
.bigb:active{transform:translateY(0)}
.info-bar{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:4px}
.user-input{display:flex;gap:8px;margin:14px 0}
.user-input textarea{flex:1;background:#0a0e14;border:1px solid #2a3050;border-radius:8px;padding:10px 14px;color:#e0e0e0;font-family:'Cascadia Code','Fira Code',Consolas,monospace;font-size:13px;outline:none;resize:vertical;min-height:40px;max-height:200px;transition:border-color .2s}
.user-input textarea:focus{border-color:#7c8aff}
.user-input textarea::placeholder{color:#334}
.user-input button{background:linear-gradient(135deg,#7c8aff,#5a68dd);color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;align-self:flex-end;transition:all .2s}
.user-input button:hover{transform:translateY(-1px);box-shadow:0 2px 12px #7c8aff40}
.info-chip{background:#111828;border:1px solid #1a2040;border-radius:8px;padding:8px 14px;font-size:11px;color:#889;display:flex;align-items:center;gap:6px}
.info-chip b{color:#c0c8e0;font-weight:600}
.diag-summary{display:flex;gap:12px;margin:12px 0;flex-wrap:wrap}
.ds-item{background:#0d1220;border-radius:8px;padding:10px 16px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px}
.ds-item.ok{color:#4caf50}.ds-item.fail{color:#f44336}
/* 投屏链路 */
.scr-wrap{position:relative;background:#000;border-radius:12px;overflow:hidden;border:1px solid #1a2040;min-height:300px;display:flex;align-items:center;justify-content:center}
.scr-wrap img{max-width:100%;max-height:70vh;object-fit:contain;display:block}
.scr-wrap .placeholder{color:#445;text-align:center;padding:40px}
.scr-overlay{position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair;z-index:10}
.scr-dot{position:absolute;width:20px;height:20px;border-radius:50%;background:rgba(124,138,255,0.5);border:2px solid #7c8aff;transform:translate(-50%,-50%);pointer-events:none;animation:scrPulse .4s ease-out forwards}
@keyframes scrPulse{0%{transform:translate(-50%,-50%) scale(.5);opacity:1}100%{transform:translate(-50%,-50%) scale(1.5);opacity:0}}
.scr-bar{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;align-items:center}
.scr-bar button{padding:6px 14px;background:#111828;border:1px solid #2a3050;color:#e0e0e0;border-radius:8px;cursor:pointer;font-size:12px;transition:all .15s}
.scr-bar button:hover{background:#7c8aff;border-color:#7c8aff}
.scr-bar button:active{transform:scale(.95)}
.scr-bar button.active{background:#4caf50;border-color:#4caf50}
.scr-bar .sep{width:1px;height:20px;background:#2a3050}
.scr-info{font-size:11px;color:#556;margin-left:auto}
.scr-src-pills{display:flex;gap:6px;margin:8px 0}
.scr-src{padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600}
.scr-src.on{background:#0d1a0d;color:#4caf50}
.scr-src.off{background:#1a0d0d;color:#f44336}
.scr-trail{position:absolute;width:8px;height:8px;border-radius:50%;background:rgba(124,138,255,0.6);pointer-events:none;animation:scrTrailFade .6s ease-out forwards}
@keyframes scrTrailFade{0%{opacity:.8;transform:scale(1)}100%{opacity:0;transform:scale(.3)}}
.scr-line{position:absolute;background:rgba(124,138,255,0.4);height:2px;pointer-events:none;transform-origin:left center;animation:scrTrailFade .8s ease-out forwards}
.scr-bar-row{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0;align-items:center}
.scr-bar-row button{padding:4px 10px;background:#111828;border:1px solid #2a3050;color:#e0e0e0;border-radius:6px;cursor:pointer;font-size:11px;transition:all .15s}
.scr-bar-row button:hover{background:#7c8aff;border-color:#7c8aff}
.scr-bar-row button:active{transform:scale(.95)}
.scr-bar-label{font-size:10px;color:#445;font-weight:600;text-transform:uppercase;letter-spacing:.5px;min-width:32px}
.scr-fullscreen{position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;background:#000;margin:0;border:none;border-radius:0;min-height:100vh}
.scr-fullscreen img{max-height:100vh}
.scr-fs-btn{position:absolute;top:8px;right:8px;z-index:10001;padding:6px 10px;background:rgba(17,24,40,.8);border:1px solid #2a3050;color:#e0e0e0;border-radius:6px;cursor:pointer;font-size:14px;transition:all .15s}
.scr-fs-btn:hover{background:#7c8aff;border-color:#7c8aff}
.scr-toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(17,24,40,.9);color:#4caf50;padding:6px 16px;border-radius:8px;font-size:12px;z-index:10002;animation:scrToastIn .3s ease-out;pointer-events:none}
@keyframes scrToastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.scr-zoom-info{position:absolute;bottom:8px;left:8px;z-index:10001;padding:3px 8px;background:rgba(0,0,0,.6);color:#889;border-radius:4px;font-size:10px;pointer-events:none}
</style>
</head>
<body>
<div class="app">
  <div class="hdr">
    <div><h1>道 · 远程中枢</h1><div class="sub">五感连接远方 · 大脑分析万象</div></div>
    <div class="pills">
      <span id="sPill" class="pill wait"><span class="d"></span>五感</span>
      <span id="aPill" class="pill off"><span class="d"></span>Agent</span>
    </div>
  </div>
  <div class="tabs">
    <button class="tab act" onclick="go('home',this)">首页</button>
    <button class="tab" onclick="go('screen',this)">投屏</button>
    <button class="tab" onclick="go('term',this)">终端</button>
    <button class="tab" onclick="go('diag',this)">诊断</button>
    <button class="tab" onclick="go('sys',this)">系统</button>
    <button class="tab" onclick="go('files',this)">文件</button>
    <button class="tab" onclick="go('clip',this)">剪贴板</button>
    <button class="tab" onclick="go('wake',this)">唤醒</button>
    <a href="/marble${TOKEN ? "?token=" + TOKEN : ""}" class="tab" style="text-decoration:none;color:inherit">3D世界</a>
  </div>
  <div id="p-home" class="page act">
    <div id="agentCard" class="card">
      <h3>连接 Agent（远程之手）</h3>
      <p>在目标电脑以<b>管理员身份</b>打开 PowerShell，粘贴以下命令：</p>
      <div class="cmd-box" id="installCmd">irm ${/:\d+$/.test(PUBLIC_URL) ? "http" : "https"}://${PUBLIC_URL}/go${TOKEN ? "?token=" + TOKEN : ""} | iex</div>
      <button class="cbtn" onclick="cpEl('installCmd',this)">复制安装命令</button>
      <p style="margin-top:10px;font-size:11px;color:#445">${/:\d+$/.test(PUBLIC_URL) ? "Agent连接后解锁远程终端、系统信息等全部能力" : '<span style="color:#4caf50">● 公网接入已就绪</span> — 任何网络均可接入'}</p>
    </div>
    <div id="agentInfo" style="display:none"></div>
    <div class="card" style="border-color:#7c8aff30">
      <h3 style="font-size:13px;margin-bottom:8px">发送消息给大脑</h3>
      <div class="user-input">
        <textarea id="userMsg" rows="1" placeholder="输入消息、配置信息、或任何内容..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendUserMsg()}"></textarea>
        <button onclick="sendUserMsg()">发送</button>
      </div>
    </div>
    <div id="msgs"></div>
  </div>
  <div id="p-term" class="page">
    <div id="termNotice" class="card" style="display:none;border-color:#ffa72640">
      <p style="color:#ffa726;text-align:center">Agent未连接，无法执行命令。请先在首页连接Agent。</p>
    </div>
    <div class="term" id="termOut"><div class="empty" id="termEmpty">等待命令执行...</div></div>
    <div class="ti">
      <input type="text" id="termIn" placeholder="输入 PowerShell 命令..." onkeydown="if(event.key==='Enter')termSend()">
      <button id="termBtn" onclick="termSend()" disabled>执行</button>
    </div>
  </div>
  <div id="p-diag" class="page">
    <div id="diagBox"><div class="card"><h3>网络诊断</h3><p>连接后自动运行浏览器级网络可达性测试</p></div></div>
  </div>
  <div id="p-screen" class="page">
    <div class="card">
      <h3>远程投屏 · 反向控制</h3>
      <div id="scrSrcPills" class="scr-src-pills"></div>
      <div class="scr-bar">
        <button onclick="scrCapture()" title="单次截屏">📸 截屏</button>
        <button id="scrLiveBtn" onclick="scrToggleLive()" title="开启实时投屏">▶ 实时投屏</button>
        <span class="sep"></span>
        <button onclick="scrInput('home',{})" title="HOME键">🏠</button>
        <button onclick="scrInput('back',{})" title="返回键">◀</button>
        <button onclick="scrInput('recents',{})" title="最近任务">▦</button>
        <button onclick="scrInput('lock',{})" title="锁屏">🔒</button>
        <span class="sep"></span>
        <button onclick="scrInput('volume/up',{})" title="音量+">🔊</button>
        <button onclick="scrInput('volume/down',{})" title="音量-">🔉</button>
        <span class="sep"></span>
        <button onclick="scrSendText()" title="输入文本">⌨️ 文本</button>
        <span class="sep"></span>
        <button onclick="scrToggleFullscreen()" title="全屏">⛶ 全屏</button>
        <span class="scr-info" id="scrInfo">等待连接...</span>
      </div>
      <div class="scr-bar-row">
        <span class="scr-bar-label">系统</span>
        <button onclick="scrInput('wake',{})" title="唤醒屏幕">💡 唤醒</button>
        <button onclick="scrInput('power',{})" title="电源菜单">⏻ 电源</button>
        <button onclick="scrInput('screenshot',{})" title="远程截图">📷 截图</button>
        <button onclick="scrInput('notifications',{})" title="通知栏">🔔 通知</button>
        <button onclick="scrInput('quicksettings',{})" title="快捷设置">⚙️ 快设</button>
        <button onclick="scrInput('splitscreen',{})" title="分屏">◫ 分屏</button>
      </div>
      <div class="scr-bar-row">
        <span class="scr-bar-label">媒体</span>
        <button onclick="scrInput('media/play',{})" title="播放/暂停">⏯ 播放</button>
        <button onclick="scrInput('media/next',{})" title="下一曲">⏭ 下曲</button>
        <button onclick="scrInput('media/prev',{})" title="上一曲">⏮ 上曲</button>
        <button onclick="scrInput('scroll',{delta:-120})" title="向上滚动">⬆ 上滚</button>
        <button onclick="scrInput('scroll',{delta:120})" title="向下滚动">⬇ 下滚</button>
      </div>
      <div class="scr-bar-row" id="scrGhostBar" style="display:none">
        <span class="scr-bar-label">Windows</span>
        <button onclick="scrLaunchApp()" title="搜索并启动应用">🚀 启动</button>
        <button onclick="scrInput('launch',{app:'explorer'})" title="文件管理器">📁 资管</button>
        <button onclick="scrInput('key',{key:'alt+tab'})" title="Alt+Tab切换窗口">🔄 切窗</button>
        <button onclick="scrInput('key',{key:'alt+f4'})" title="关闭当前窗口">✕ 关窗</button>
        <button onclick="scrInput('key',{key:'lwin+d'})" title="显示桌面">🖥 桌面</button>
        <button onclick="scrInput('key',{key:'lwin+e'})" title="打开资源管理器">📂 资管</button>
        <button onclick="scrInput('key',{key:'ctrl+shift+escape'})" title="任务管理器">📊 任管</button>
        <button onclick="scrInput('key',{key:'lwin+l'})" title="锁屏">🔐 锁屏</button>
      </div>
      <div class="scr-wrap" id="scrWrap">
        <div class="placeholder" id="scrPlaceholder">Agent连接后点击「截屏」或「实时投屏」查看远程桌面<br><small style="color:#334">点击=tap · 拖拽=swipe · 键盘自动转发</small></div>
        <img id="scrImg" style="display:none" alt="远程屏幕">
        <div class="scr-overlay" id="scrOverlay" style="display:none"></div>
      </div>
    </div>
  </div>
  <div id="p-sys" class="page">
    <div id="sysBox"><div class="empty">等待 Agent 发送系统信息...</div></div>
  </div>
  <div id="p-files" class="page">
    <div class="card">
      <h3>文件浏览 · 上传下载</h3>
      <div class="ti">
        <input type="text" id="fPath" placeholder="${/win/i.test(process.platform) ? "C:\\\\" : "/"}" value="${/win/i.test(process.platform) ? "C:\\\\" : "/"}" onkeydown="if(event.key==='Enter')fList()">
        <button onclick="fList()">列出</button>
      </div>
      <div class="scr-bar" style="margin-top:10px">
        <button onclick="fUp()" title="上一层">⬆ 上级</button>
        <button onclick="fDownload()" title="下载当前路径">⬇ 下载</button>
        <label class="cbtn" style="cursor:pointer;display:inline-block;padding:6px 14px">📤 上传
          <input type="file" id="fUpload" onchange="fUploadFile()" style="display:none">
        </label>
        <span class="scr-info" id="fInfo"></span>
      </div>
      <div id="fList" class="term" style="min-height:200px;max-height:60vh"><div class="empty">点击「列出」开始</div></div>
    </div>
  </div>
  <div id="p-clip" class="page">
    <div class="card">
      <h3>剪贴板同步 · 两端互通</h3>
      <div class="ti" style="margin-bottom:10px">
        <button onclick="clipRead()" title="读取远程剪贴板">⬅ 读远程</button>
        <button onclick="clipWrite()" title="写入远程剪贴板">➡ 写远程</button>
        <span class="scr-info" id="clipInfo">空闲</span>
      </div>
      <textarea id="clipText" rows="8" placeholder="此处内容 · 点[写远程]同步到远程机 · 点[读远程]把远程剪贴板拉到此处"
        style="width:100%;background:#0a0e14;border:1px solid #2a3050;border-radius:8px;padding:10px;color:#e0e0e0;font-family:'Cascadia Code',Consolas,monospace;font-size:12px;resize:vertical"></textarea>
    </div>
  </div>
  <div id="p-wake" class="page">
    <div class="card">
      <h3>Wake-on-LAN · 吹气唤醒</h3>
      <p>对目标网卡发魔法包，机器关机/休眠皆可从网络唤起。需目标机 BIOS 开启 WoL，网卡固件支持，且与本机同网段（或路由器放行 UDP 9）。</p>
      <div id="wakeList" style="margin:12px 0"><div class="empty">加载已记录的 Agent MAC...</div></div>
      <div class="ti">
        <input type="text" id="wakeMac" placeholder="手动 MAC: AA:BB:CC:DD:EE:FF 或 AA-BB-...">
        <button onclick="wakeCustom()">唤醒</button>
      </div>
      <div class="scr-info" id="wakeInfo" style="margin-top:8px">空闲</div>
    </div>
  </div>
</div>
<script>
var ws=null,agentOk=false,diagRan=false,pendingCmds={},cmdId=0;
var scrWs=null,scrLive=false,scrFrameCount=0,scrLastTime=0;
function connect(){
  var proto=location.protocol==='https:'?'wss:':'ws:';
  ws=new WebSocket(proto+'//'+location.host+'/ws/sense${TOKEN ? "?token=" + TOKEN : ""}');
  ws.onopen=function(){
    sPill('on','五感');
    ws.send(JSON.stringify({type:'hello',ua:navigator.userAgent,time:new Date().toISOString(),screen:screen.width+'x'+screen.height}));
    if(!diagRan){diagRan=true;runDiag()}
  };
  ws.onmessage=function(e){try{handle(JSON.parse(e.data))}catch(x){console.error(x)}};
  ws.onclose=function(){sPill('wait','重连中...');setTimeout(connect,3000)};
  ws.onerror=function(){};
}
function handle(m){
  if(m.type==='say') addMsg(m.level||'system',m.text);
  else if(m.type==='command') showCmd(m.title||'命令',m.cmd,m.steps||'');
  else if(m.type==='run_diag'){diagRan=true;runDiag()}
  else if(m.type==='agent_status'){
    agentOk=m.connected;
    if(m.connected){
      aPill('on',m.hostname||'Agent');
      document.getElementById('agentCard').style.display='none';
      document.getElementById('termBtn').disabled=false;
      document.getElementById('termNotice').style.display='none';
      showAgentInfo(m);
    } else {
      aPill('off','离线');
      document.getElementById('agentCard').style.display='';
      document.getElementById('agentInfo').style.display='none';
      document.getElementById('termBtn').disabled=true;
      document.getElementById('termNotice').style.display='';
    }
  }
  else if(m.type==='terminal') addTerm(m.cmd,m.output,m.ok,m.id);
  else if(m.type==='sysinfo') showSys(m);
}
function showAgentInfo(m){
  var el=document.getElementById('agentInfo');
  el.style.display='';
  el.innerHTML='<div class="card connected"><div class="info-bar">'
    +'<div class="info-chip"><b>'+esc(m.hostname||'?')+'</b></div>'
    +'<div class="info-chip">'+esc(m.user||'?')+(m.isAdmin?' <b style="color:#4caf50">(管理员)</b>':'')+'</div>'
    +'<div class="info-chip">'+esc(m.os||'?')+'</div>'
    +'</div></div>';
}
var tests=[
  {name:'DNS: windsurf.com',type:'dns',host:'windsurf.com'},
  {name:'DNS: auth.windsurf.com',type:'dns',host:'auth.windsurf.com'},
  {name:'DNS: unleash.codeium.com',type:'dns',host:'unleash.codeium.com'},
  {name:'DNS: marketplace.windsurf.com',type:'dns',host:'marketplace.windsurf.com'},
  {name:'HTTPS: windsurf.com',type:'fetch',url:'https://windsurf.com'},
  {name:'HTTPS: auth.windsurf.com',type:'fetch',url:'https://auth.windsurf.com'},
  {name:'HTTPS: unleash.codeium.com',type:'fetch',url:'https://unleash.codeium.com'},
  {name:'IP: 34.49.14.144',type:'fetch',url:'https://34.49.14.144'},
  {name:'IP: 35.223.238.178',type:'fetch',url:'https://35.223.238.178'},
  {name:'DNS: github.com (ref)',type:'dns',host:'github.com'},
  {name:'HTTPS: github.com (ref)',type:'fetch',url:'https://github.com'}
];
async function runDiag(){
  var box=document.getElementById('diagBox');
  box.innerHTML='<div class="card"><h3>网络诊断</h3><b style="color:#ffa726">正在检测...</b><div class="pw"><div id="dp" class="pf" style="width:0%"></div></div><div id="dt"></div></div>';
  var results=[],pass=0,fail=0;
  for(var i=0;i<tests.length;i++){
    document.getElementById('dp').style.width=((i+1)/tests.length*100)+'%';
    var t=tests[i],r={name:t.name,status:'fail',detail:''};
    var row=document.createElement('div');row.className='ti-r';
    row.innerHTML='<span class="n">'+t.name+'</span><span class="r wait">...</span><span class="dd"></span>';
    document.getElementById('dt').appendChild(row);
    try{
      if(t.type==='dns'){
        var dohUrls=['https://cloudflare-dns.com/dns-query?name='+t.host+'&type=A','https://dns.google/resolve?name='+t.host+'&type=A'];
        var dohOk=false;
        for(var di=0;di<dohUrls.length&&!dohOk;di++){
          try{
            var resp=await fetch(dohUrls[di],{headers:{'Accept':'application/dns-json'},signal:AbortSignal.timeout(8000)});
            var d=await resp.json();
            if(d.Answer&&d.Answer.length>0){r.status='pass';r.detail=d.Answer.map(function(a){return a.data}).join(', ');dohOk=true}
            else if(d.Status===3){r.detail='NXDOMAIN';dohOk=true}
          }catch(de){}
        }
        if(!dohOk){r.detail='All DoH resolvers failed'}
      }else if(t.type==='fetch'){
        var s=Date.now();
        try{await fetch(t.url,{mode:'no-cors',signal:AbortSignal.timeout(10000)});r.status='pass';r.detail=(Date.now()-s)+'ms'}
        catch(e){r.detail=e.name==='AbortError'?'timeout':e.message}
      }
    }catch(e){r.detail=e.message||'error'}
    results.push(r);
    if(r.status==='pass')pass++;else fail++;
    row.querySelector('.r').className='r '+r.status;
    row.querySelector('.r').textContent=r.status==='pass'?'OK':'FAIL';
    row.querySelector('.dd').textContent=r.detail;
    if(ws&&ws.readyState===1) ws.send(JSON.stringify({type:'test_result',index:i,name:r.name,status:r.status,detail:r.detail}));
  }
  if(ws&&ws.readyState===1) ws.send(JSON.stringify({type:'diagnostics_complete',results:results,ua:navigator.userAgent,time:new Date().toISOString()}));
  var summary='<div class="diag-summary"><div class="ds-item ok">'+pass+' 通过</div>'+(fail?'<div class="ds-item fail">'+fail+' 失败</div>':'')+'</div>';
  var btn='<button class="bigb" onclick="diagRan=true;runDiag()">重新诊断</button>';
  box.insertAdjacentHTML('beforeend',summary+btn);
}
function termSend(){
  var inp=document.getElementById('termIn'),cmd=inp.value.trim();
  if(!cmd||!ws||ws.readyState!==1)return;
  if(!agentOk){addTerm(cmd,'Agent未连接，请先在首页连接Agent',false);return}
  ws.send(JSON.stringify({type:'user_exec',cmd:cmd}));
  inp.value='';
  var te=document.getElementById('termEmpty');if(te)te.remove();
  var id='p'+(++cmdId);
  var d=document.createElement('div');d.className='te te-pending';d.id=id;
  d.innerHTML='<div class="te-cmd">'+esc(cmd)+'</div><div class="te-out">执行中...</div>';
  document.getElementById('termOut').appendChild(d);
  d.scrollIntoView({behavior:'smooth'});
  pendingCmds[cmd]=id;
}
function addTerm(cmd,output,ok){
  var te=document.getElementById('termEmpty');if(te)te.remove();
  var pid=pendingCmds[cmd];
  if(pid){
    var el=document.getElementById(pid);
    if(el){el.className='te';el.id='';el.innerHTML='<div class="te-cmd">'+esc(cmd)+'</div><div class="te-out'+(ok?'':' te-err')+'">'+esc(output||'(no output)')+'</div><div class="te-t">'+new Date().toLocaleTimeString()+'</div>';el.scrollIntoView({behavior:'smooth'})}
    delete pendingCmds[cmd];
  } else {
    var d=document.createElement('div');d.className='te';
    d.innerHTML='<div class="te-cmd">'+esc(cmd)+'</div><div class="te-out'+(ok?'':' te-err')+'">'+esc(output||'(no output)')+'</div><div class="te-t">'+new Date().toLocaleTimeString()+'</div>';
    document.getElementById('termOut').appendChild(d);
    d.scrollIntoView({behavior:'smooth'});
  }
}
function showSys(m){
  if(m.error){document.getElementById('sysBox').innerHTML='<div class="card"><p style="color:#f44336">'+esc(m.error)+'</p></div>';return}
  var h='<div class="sg">';
  h+='<div class="si"><div class="l">CPU</div><div class="v sm">'+esc(m.cpu||'?')+'</div></div>';
  h+='<div class="si"><div class="l">操作系统</div><div class="v sm">'+esc(m.os||'?')+'</div></div>';
  h+='<div class="si"><div class="l">内存</div><div class="v">'+esc(m.ramGB||'?')+' GB <span style="color:#556">/ 空闲 '+esc(m.ramFreeGB||'?')+' GB</span></div></div>';
  h+='<div class="si"><div class="l">进程数</div><div class="v">'+esc(m.processes||'?')+'</div></div>';
  h+='<div class="si"><div class="l">运行时间</div><div class="v">'+esc(m.uptime||'?')+' h</div></div>';
  var dl=m.disks;if(dl){if(!Array.isArray(dl))dl=[dl];dl.forEach(function(dk){h+='<div class="si"><div class="l">磁盘 '+esc(dk.drive||'?')+'</div><div class="v">'+esc(dk.freeGB||'?')+' / '+esc(dk.sizeGB||'?')+' GB</div></div>'})}
  var al=m.adapters;if(al){if(!Array.isArray(al))al=[al];al.forEach(function(a){h+='<div class="si"><div class="l">'+esc(a.name||'?')+'</div><div class="v sm">'+esc(a.desc||'?')+' ('+esc(a.speed||'?')+')</div></div>'})}
  h+='</div>';
  h+='<button class="bigb" style="margin-top:14px" onclick="refreshSys()">刷新系统信息</button>';
  document.getElementById('sysBox').innerHTML=h;
}
function refreshSys(){if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'request_sysinfo'}))}
function go(id,btn){
  document.querySelectorAll('.tab').forEach(function(t){t.className='tab'});
  document.querySelectorAll('.page').forEach(function(p){p.className='page'});
  btn.className='tab act';
  document.getElementById('p-'+id).className='page act';
  // 无为而无不为: 首次进入自动加载
  if(id==='files'&&!window._fLoaded){window._fLoaded=true;fList();}
  if(id==='clip'&&!window._clipLoaded){window._clipLoaded=true;clipRead();}
  if(id==='wake'){wakeLoad();}
}
// ═══════ 文件传输 (v8.2 backend · v8.3 UI) ═══════
var TK=${TOKEN ? '"' + TOKEN + '"' : '""'};
function fJoinPath(base,name){
  base=base||'';
  if(!base) return name;
  var sep=base.indexOf('\\\\')>=0||/^[A-Za-z]:/.test(base)?'\\\\':'/';
  if(base.slice(-1)===sep)return base+name;
  return base+sep+name;
}
function fParent(p){
  if(!p)return p;
  var m=p.match(/^[A-Za-z]:[\\\\\\/]?$/);if(m)return p;
  p=p.replace(/[\\\\\\/]$/,'');
  var i=Math.max(p.lastIndexOf('\\\\'),p.lastIndexOf('/'));
  if(i<=0)return p;
  var parent=p.substring(0,i);
  if(/^[A-Za-z]:$/.test(parent))parent=parent+'\\\\';
  return parent||'/';
}
function fUrl(extra){
  var q=(TK?'token='+encodeURIComponent(TK):'');
  if(extra)q=q?q+'&'+extra:extra;
  return q?'?'+q:'';
}
async function fList(){
  var p=document.getElementById('fPath').value.trim();
  document.getElementById('fInfo').textContent='读取中...';
  try{
    var r=await fetch('/files'+fUrl('path='+encodeURIComponent(p)),{headers:TK?{Authorization:'Bearer '+TK}:{}});
    var d=await r.json();
    if(d.error){document.getElementById('fList').innerHTML='<div class="empty" style="color:#f44336">'+esc(d.error)+'</div>';document.getElementById('fInfo').textContent='失败';return;}
    var curPath=d.path||p;
    var h='<div class="ti-r"><span class="n"><b>'+esc(curPath)+'</b></span><span class="dd">'+(d.entries||[]).length+' 项</span></div>';
    var entries=(d.entries||[]).slice().sort(function(a,b){
      if(a.type!==b.type)return a.type==='dir'?-1:1;
      return a.name.localeCompare(b.name);
    });
    entries.forEach(function(e){
      var icon=e.type==='dir'?'📁':'📄';
      var sz=e.type==='dir'?'':((e.size/1024).toFixed(1)+' KB');
      h+='<div class="ti-r"><span class="n fe" style="cursor:pointer" data-type="'+e.type+'" data-name="'+esc(e.name)+'">'+icon+' '+esc(e.name)+'</span><span class="dd">'+sz+'</span></div>';
    });
    var box=document.getElementById('fList');
    box.innerHTML=h;
    box.dataset.path=curPath;
    Array.prototype.forEach.call(box.querySelectorAll('.fe'),function(el){
      el.onclick=function(){
        var full=fJoinPath(curPath,el.dataset.name);
        if(el.dataset.type==='dir'){document.getElementById('fPath').value=full;fList();}
        else{fDL(full);}
      };
    });
    document.getElementById('fInfo').textContent=entries.length+' 项';
  }catch(e){
    document.getElementById('fList').innerHTML='<div class="empty" style="color:#f44336">'+esc(e.message)+'</div>';
    document.getElementById('fInfo').textContent='失败';
  }
}
function fUp(){
  var p=document.getElementById('fPath').value.trim();
  var parent=fParent(p);
  if(parent&&parent!==p){document.getElementById('fPath').value=parent;fList();}
}
function fDownload(){
  var p=document.getElementById('fPath').value.trim();
  fDL(p);
}
function fDL(p){
  var url='/files/get'+fUrl('path='+encodeURIComponent(p));
  window.open(url,'_blank');
}
async function fUploadFile(){
  var inp=document.getElementById('fUpload');
  var f=inp.files&&inp.files[0];if(!f)return;
  var dir=document.getElementById('fPath').value.trim();
  var dest=fJoinPath(dir,f.name);
  document.getElementById('fInfo').textContent='上传 '+f.name+'...';
  try{
    var headers={};if(TK)headers.Authorization='Bearer '+TK;
    var r=await fetch('/files/put'+fUrl('path='+encodeURIComponent(dest)),{method:'POST',headers:headers,body:f});
    var d=await r.json();
    if(d.ok){document.getElementById('fInfo').textContent='已上传到 '+dest;fList();}
    else{document.getElementById('fInfo').textContent='失败';}
  }catch(e){document.getElementById('fInfo').textContent='失败: '+e.message;}
  inp.value='';
}
// ═══════ 剪贴板同步 ═══════
async function clipRead(){
  document.getElementById('clipInfo').textContent='读取中...';
  try{
    var headers={};if(TK)headers.Authorization='Bearer '+TK;
    var r=await fetch('/dao/clipboard'+fUrl(),{headers:headers});
    var d=await r.json();
    document.getElementById('clipText').value=d.text||'';
    document.getElementById('clipInfo').textContent=d.error?('失败: '+d.error):('已读取 '+(d.text||'').length+' 字符');
  }catch(e){document.getElementById('clipInfo').textContent='失败: '+e.message;}
}
async function clipWrite(){
  var t=document.getElementById('clipText').value;
  document.getElementById('clipInfo').textContent='写入中...';
  try{
    var headers={'Content-Type':'application/json'};if(TK)headers.Authorization='Bearer '+TK;
    var r=await fetch('/dao/clipboard'+fUrl(),{method:'POST',headers:headers,body:JSON.stringify({text:t})});
    var d=await r.json();
    document.getElementById('clipInfo').textContent=d.ok?('已写入 '+t.length+' 字符到远程'):('失败: '+(d.error||'?'));
  }catch(e){document.getElementById('clipInfo').textContent='失败: '+e.message;}
}
// ═══════ Wake-on-LAN ═══════
async function wakeLoad(){
  document.getElementById('wakeList').innerHTML='<div class="empty">查询中...</div>';
  try{
    var headers={};if(TK)headers.Authorization='Bearer '+TK;
    var r=await fetch('/dao/wol'+fUrl(),{headers:headers});
    var d=await r.json();
    var hosts=d.hosts||[];
    if(hosts.length===0){document.getElementById('wakeList').innerHTML='<div class="empty">无已记录 MAC — Agent 需先连一次并上报 sysinfo</div>';return;}
    var h='';
    hosts.forEach(function(host){
      h+='<div class="card" style="padding:10px;margin-bottom:8px">';
      h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">';
      h+='<b style="color:#c0c8e0">'+esc(host.hostname)+'</b>';
      h+='<span class="scr-src '+(host.online?'on':'off')+'">'+(host.online?'在线':'离线')+'</span>';
      h+='</div>';
      (host.macs||[]).forEach(function(m){
        h+='<div class="ti-r"><span class="n">'+esc(m.name||'?')+' — <code>'+esc(m.mac)+'</code></span>';
        h+='<button class="cbtn wk" data-mac="'+esc(m.mac)+'">唤醒</button></div>';
      });
      if((host.macs||[]).length===0)h+='<div class="dd">未记录 MAC</div>';
      h+='</div>';
    });
    var box=document.getElementById('wakeList');
    box.innerHTML=h;
    Array.prototype.forEach.call(box.querySelectorAll('.wk'),function(b){
      b.onclick=function(){wakeGo(b.dataset.mac,b);};
    });
  }catch(e){document.getElementById('wakeList').innerHTML='<div class="empty" style="color:#f44336">'+esc(e.message)+'</div>';}
}
async function wakeGo(mac,btn){
  if(btn)btn.disabled=true;
  document.getElementById('wakeInfo').textContent='发送 WoL 魔法包到 '+mac+'...';
  try{
    var headers={'Content-Type':'application/json'};if(TK)headers.Authorization='Bearer '+TK;
    var r=await fetch('/dao/wol'+fUrl(),{method:'POST',headers:headers,body:JSON.stringify({mac:mac})});
    var d=await r.json();
    if(d.ok){document.getElementById('wakeInfo').textContent='已广播到 '+((d.targets||[]).length)+' 个网段 · 端口 '+((d.ports||[]).join(','));}
    else{document.getElementById('wakeInfo').textContent='失败: '+(d.error||JSON.stringify(d.errors||'?'));}
  }catch(e){document.getElementById('wakeInfo').textContent='失败: '+e.message;}
  if(btn)setTimeout(function(){btn.disabled=false},2000);
}
function wakeCustom(){
  var m=document.getElementById('wakeMac').value.trim();
  if(!m)return;
  wakeGo(m);
}
function sPill(s,t){var e=document.getElementById('sPill');e.className='pill '+s;e.innerHTML='<span class="d"></span>'+t}
function aPill(s,t){var e=document.getElementById('aPill');e.className='pill '+s;e.innerHTML='<span class="d"></span>'+t}
function addMsg(level,html){
  var el=document.createElement('div');el.className='msg '+level;el.innerHTML=html;
  document.getElementById('msgs').appendChild(el);
  el.scrollIntoView({behavior:'smooth',block:'end'});
}
function showCmd(title,cmd,steps){
  var h='<h3>'+esc(title)+'</h3>';
  if(steps) h+='<div class="steps">'+steps+'</div>';
  h+='<div class="cmd-box">'+esc(cmd)+'</div>';
  h+='<button class="cbtn" onclick="cpNear(this)">复制命令</button>';
  addMsg('action',h);
}
function cpNear(btn){
  var box=btn.parentElement.querySelector('.cmd-box');
  if(!box)return;
  var t=box.textContent.trim();
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(t).then(function(){cpDone(btn)}).catch(function(){cpFB(t,btn)});
  }else{cpFB(t,btn)}
}
function cpEl(id,btn){
  var t=document.getElementById(id).textContent.trim();
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(t).then(function(){cpDone(btn,'复制安装命令')}).catch(function(){cpFB(t,btn)});
  }else{cpFB(t,btn)}
}
function cpDone(btn,orig){btn.textContent='已复制!';btn.className='cbtn ok';setTimeout(function(){btn.textContent=orig||'复制命令';btn.className='cbtn'},2000)}
function cpFB(t,btn){var ta=document.createElement('textarea');ta.value=t;ta.style.cssText='position:fixed;left:-9999px';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');cpDone(btn)}catch(e){}document.body.removeChild(ta)}
function sendUserMsg(){
  var ta=document.getElementById('userMsg'),t=ta.value.trim();
  if(!t||!ws||ws.readyState!==1)return;
  ws.send(JSON.stringify({type:'user_message',text:t,time:new Date().toISOString()}));
  addMsg('system','<b>你:</b> '+esc(t));
  ta.value='';
  ta.style.height='auto';
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

// ═══════ 投屏链路: 万法之资 · 适配一切 ═══════
function scrConnect(){
  if(scrWs&&scrWs.readyState<2)return;
  var proto=location.protocol==='https:'?'wss:':'ws:';
  scrWs=new WebSocket(proto+'//'+location.host+'/ws/screen${TOKEN ? "?token=" + TOKEN : ""}');
  scrWs.onopen=function(){document.getElementById('scrInfo').textContent='投屏通道已连接'};
  scrWs.onmessage=function(e){
    try{
      var m=JSON.parse(e.data);
      if(m.type==='screen_frame'){
        var img=document.getElementById('scrImg');
        img.src=m.image;
        img.style.display='block';
        document.getElementById('scrPlaceholder').style.display='none';
        document.getElementById('scrOverlay').style.display='block';
        scrFrameCount++;
        var now=Date.now();
        var fps=scrLastTime?(1000/(now-scrLastTime)).toFixed(1):'--';
        scrLastTime=now;
        document.getElementById('scrInfo').textContent=
          (m.width||'?')+'x'+(m.height||'?')+' | '+fps+' fps | '+scrFrameCount+' frames | '+(m.source||'agent');
      }
      if(m.type==='screen_stopped'){
        scrLive=false;
        var btn=document.getElementById('scrLiveBtn');
        btn.textContent='▶ 实时投屏';btn.classList.remove('active');
        document.getElementById('scrInfo').textContent='投屏已停止';
      }
      if(m.type==='input_result'){
        scrShowToast(m.ok?(m.action+(m.via?' ('+m.via+')':'')):'输入失败: '+m.action);
      }
      if(m.type==='screen_sources'){
        var pills=document.getElementById('scrSrcPills');
        pills.innerHTML='';
        var srcs=m.sources||{};
        var hasGhost=false,hasAdbHub=false;
        for(var k in srcs){
          var s=srcs[k];
          var sp=document.createElement('span');
          sp.className='scr-src '+(s.status==='online'?'on':'off');
          sp.textContent=k+(s.status==='online'?' ✓':' ✗');
          pills.appendChild(sp);
          if(k==='ghost'&&s.status==='online')hasGhost=true;
          if(k==='dao'&&s.status==='online')hasGhost=true;
          if(k==='adb_hub'&&s.status==='online')hasAdbHub=true;
        }
        var gb=document.getElementById('scrGhostBar');
        if(gb)gb.style.display=hasGhost?'flex':'none';
        // Agent截屏始终可用
        var ag=document.createElement('span');
        ag.className='scr-src '+(agentOk?'on':'off');
        ag.textContent='agent-screencap'+(agentOk?' ✓':' ✗');
        pills.appendChild(ag);
      }
      if(m.type==='screen_error'){
        document.getElementById('scrInfo').textContent='截屏失败: '+m.error;
      }
    }catch(x){}
  };
  scrWs.onclose=function(){setTimeout(scrConnect,3000)};
}
function scrCapture(){
  if(!scrWs||scrWs.readyState!==1){scrConnect();return}
  scrWs.send(JSON.stringify({type:'request_capture'}));
  document.getElementById('scrInfo').textContent='截屏中...';
}
function scrToggleLive(){
  scrLive=!scrLive;
  var btn=document.getElementById('scrLiveBtn');
  if(scrLive){
    btn.textContent='⏹ 停止';
    btn.classList.add('active');
    scrFrameCount=0;
    // 通过主WS通知Agent开始连续截屏
    if(ws&&ws.readyState===1){
      ws.send(JSON.stringify({type:'start_screen_capture',interval:800}));
    }
    // 同时通过screen WS持续请求 (兜底)
    scrLiveLoop();
  }else{
    btn.textContent='▶ 实时投屏';
    btn.classList.remove('active');
    if(ws&&ws.readyState===1){
      ws.send(JSON.stringify({type:'stop_screen_capture'}));
    }
  }
}
function scrLiveLoop(){
  if(!scrLive)return;
  // 如果Agent端连续推送已激活, 不需要客户端轮询
  // 但作为兜底保障, 每2秒请求一次
  setTimeout(function(){
    if(scrLive&&scrWs&&scrWs.readyState===1){
      scrWs.send(JSON.stringify({type:'request_capture'}));
    }
    scrLiveLoop();
  },2000);
}
function scrInput(action,params){
  if(scrWs&&scrWs.readyState===1){
    scrWs.send(JSON.stringify({type:'screen_input',action:action,params:params}));
  }
}
function scrSendText(){
  var t=prompt('输入要发送到远程设备的文本:');
  if(t)scrInput('text',{text:t});
}
function scrLaunchApp(){
  var app=prompt('输入要启动的应用名称:');
  if(app)scrInput('launch',{app:app});
}
// ═══════ Toast 反馈 ═══════
function scrShowToast(text){
  var t=document.createElement('div');t.className='scr-toast';t.textContent=text;
  document.body.appendChild(t);setTimeout(function(){t.remove()},1500);
}
// ═══════ 全屏切换 ═══════
var scrFullscreen=false;
function scrToggleFullscreen(){
  var wrap=document.getElementById('scrWrap');
  scrFullscreen=!scrFullscreen;
  if(scrFullscreen){
    wrap.classList.add('scr-fullscreen');
    if(!document.getElementById('scrFsBtn')){
      var btn=document.createElement('button');btn.id='scrFsBtn';btn.className='scr-fs-btn';
      btn.textContent='✕ 退出';btn.onclick=scrToggleFullscreen;
      wrap.appendChild(btn);
    }
  }else{
    wrap.classList.remove('scr-fullscreen');
    var btn=document.getElementById('scrFsBtn');if(btn)btn.remove();
  }
}
// 万法之资: 触控手势 — 点击=tap, 拖拽=swipe, 长按=longpress, 触屏+鼠标统一
(function(){
  var overlay=document.getElementById('scrOverlay');
  if(!overlay)return;
  var dragStart=null,dragTime=0,longTimer=null;
  var scrZoom=1,scrPanX=0,scrPanY=0,pinchStart=0;
  function getRelXY(cx,cy){
    var img=document.getElementById('scrImg');
    if(!img||img.style.display==='none')return null;
    var rect=img.getBoundingClientRect();
    return{rx:(cx-rect.left)/rect.width,ry:(cy-rect.top)/rect.height,
      w:parseInt(img.naturalWidth)||1920,h:parseInt(img.naturalHeight)||1080};
  }
  function getRelXYMouse(e){return getRelXY(e.clientX,e.clientY)}
  function getRelXYTouch(t){return getRelXY(t.clientX,t.clientY)}
  function showDot(rx,ry,cls){
    var dot=document.createElement('div');dot.className=cls||'scr-dot';
    dot.style.left=(rx*100)+'%';dot.style.top=(ry*100)+'%';
    overlay.appendChild(dot);setTimeout(function(){dot.remove()},600);
  }
  function showLine(x1,y1,x2,y2){
    var line=document.createElement('div');line.className='scr-line';
    var dx=x2-x1,dy=y2-y1,len=Math.sqrt(dx*dx+dy*dy)*overlay.offsetWidth/100;
    var angle=Math.atan2(dy,dx)*180/Math.PI;
    line.style.left=(x1*100)+'%';line.style.top=(y1*100)+'%';
    line.style.width=len+'px';line.style.transform='rotate('+angle+'deg)';
    overlay.appendChild(line);setTimeout(function(){line.remove()},800);
  }
  function beginDrag(cx,cy){
    var p=getRelXY(cx,cy);if(!p)return;
    dragStart={rx:p.rx,ry:p.ry,w:p.w,h:p.h,cx:cx,cy:cy};
    dragTime=Date.now();
    longTimer=setTimeout(function(){
      if(dragStart){showDot(dragStart.rx,dragStart.ry,'scr-dot');
        scrInput('longpress',{x:Math.round(dragStart.rx*dragStart.w),y:Math.round(dragStart.ry*dragStart.h),duration:800});
        dragStart=null;}
    },600);
  }
  function moveDrag(cx,cy){
    if(!dragStart)return;
    var dx=cx-dragStart.cx,dy=cy-dragStart.cy;
    if(Math.abs(dx)+Math.abs(dy)>10&&longTimer){clearTimeout(longTimer);longTimer=null;}
  }
  function endDrag(cx,cy){
    if(longTimer){clearTimeout(longTimer);longTimer=null;}
    if(!dragStart)return;
    var p=getRelXY(cx,cy);if(!p){dragStart=null;return;}
    var dx=cx-dragStart.cx,dy=cy-dragStart.cy;
    var dist=Math.sqrt(dx*dx+dy*dy);
    if(dist<8){
      showDot(dragStart.rx,dragStart.ry);
      scrInput('tap',{x:Math.round(dragStart.rx*dragStart.w),y:Math.round(dragStart.ry*dragStart.h)});
    }else{
      showLine(dragStart.rx,dragStart.ry,p.rx,p.ry);
      var duration=Math.min(Math.max(Date.now()-dragTime,100),2000);
      scrInput('swipe',{x1:Math.round(dragStart.rx*dragStart.w),y1:Math.round(dragStart.ry*dragStart.h),
        x2:Math.round(p.rx*p.w),y2:Math.round(p.ry*p.h),duration:duration});
    }
    dragStart=null;
  }
  function cancelDrag(){
    if(longTimer){clearTimeout(longTimer);longTimer=null;}
    dragStart=null;
  }
  // 鼠标事件
  overlay.addEventListener('mousedown',function(e){beginDrag(e.clientX,e.clientY)});
  overlay.addEventListener('mousemove',function(e){moveDrag(e.clientX,e.clientY)});
  overlay.addEventListener('mouseup',function(e){endDrag(e.clientX,e.clientY)});
  overlay.addEventListener('mouseleave',cancelDrag);
  // 触屏事件 — 万法之资: 适配手机/平板
  overlay.addEventListener('touchstart',function(e){
    if(e.touches.length===1){e.preventDefault();var t=e.touches[0];beginDrag(t.clientX,t.clientY)}
    else if(e.touches.length===2){cancelDrag();pinchStart=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY)}
  },{passive:false});
  overlay.addEventListener('touchmove',function(e){
    if(e.touches.length===1){e.preventDefault();var t=e.touches[0];moveDrag(t.clientX,t.clientY)}
    else if(e.touches.length===2&&pinchStart>0){
      e.preventDefault();
      var dist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
      scrZoom=Math.max(1,Math.min(5,scrZoom*(dist/pinchStart)));
      pinchStart=dist;
      var img=document.getElementById('scrImg');
      if(img)img.style.transform='scale('+scrZoom+')';
    }
  },{passive:false});
  overlay.addEventListener('touchend',function(e){
    if(e.changedTouches.length===1&&e.touches.length===0){
      var t=e.changedTouches[0];endDrag(t.clientX,t.clientY);
    }
    if(e.touches.length<2)pinchStart=0;
  });
  overlay.addEventListener('touchcancel',function(){cancelDrag();pinchStart=0});
  // 双击重置缩放
  overlay.addEventListener('dblclick',function(){
    scrZoom=1;var img=document.getElementById('scrImg');
    if(img)img.style.transform='';
  });
})();
// 键盘: 焦点在投屏页时转发按键
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&scrFullscreen){scrToggleFullscreen();return;}
  var page=document.getElementById('p-screen');
  if(!page||!page.classList.contains('act'))return;
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;
  var keyMap={'Backspace':'KEYCODE_DEL','Enter':'KEYCODE_ENTER',
    'ArrowUp':'KEYCODE_DPAD_UP','ArrowDown':'KEYCODE_DPAD_DOWN','ArrowLeft':'KEYCODE_DPAD_LEFT','ArrowRight':'KEYCODE_DPAD_RIGHT',
    'Tab':'KEYCODE_TAB',' ':'KEYCODE_SPACE','Delete':'KEYCODE_FORWARD_DEL','Home':'KEYCODE_MOVE_HOME','End':'KEYCODE_MOVE_END'};
  var kc=keyMap[e.key];
  if(kc){e.preventDefault();scrInput('key',{key:kc});}
  else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey){e.preventDefault();scrInput('text',{text:e.key});}
});
scrConnect();
connect();
</script>
</body>
</html>`;
};
