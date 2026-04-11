module.exports = function (PUBLIC_URL) {
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
    <button class="tab" onclick="go('term',this)">终端</button>
    <button class="tab" onclick="go('diag',this)">诊断</button>
    <button class="tab" onclick="go('sys',this)">系统</button>
  </div>
  <div id="p-home" class="page act">
    <div id="agentCard" class="card">
      <h3>连接 Agent（远程之手）</h3>
      <p>在目标电脑以<b>管理员身份</b>打开 PowerShell，粘贴以下命令：</p>
      <div class="cmd-box" id="installCmd">irm http://${PUBLIC_URL}/agent.ps1 | iex</div>
      <button class="cbtn" onclick="cpEl('installCmd',this)">复制安装命令</button>
      <p style="margin-top:10px;font-size:11px;color:#445">Agent连接后解锁远程终端、系统信息等全部能力</p>
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
  <div id="p-sys" class="page">
    <div id="sysBox"><div class="empty">等待 Agent 发送系统信息...</div></div>
  </div>
</div>
<script>
var ws=null,agentOk=false,diagRan=false,pendingCmds={},cmdId=0;
function connect(){
  var proto=location.protocol==='https:'?'wss:':'ws:';
  ws=new WebSocket(proto+'//'+location.host+'/ws/sense');
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
connect();
</script>
</body>
</html>`;
};
