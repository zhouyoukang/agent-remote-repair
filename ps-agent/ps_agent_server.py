#!/usr/bin/env python3
"""
公网 PowerShell Agent Relay Server v1.0
道生一(Server) → 一生二(Agent连接) → 二生三(AI调度) → 三生万物(控制万机)

零依赖 · 纯Python stdlib · HTTP命令队列 · 支持任意公网Windows机器

端口: 9910 (默认)
启动: python ps_agent_server.py [--port 9910]

架构:
  [任意公网电脑] --HTTP--> [本Server :9910] --FRP--> [阿里云 aiotvr.xyz/ps-agent/]
  [AI/Cascade]   --HTTP--> [本Server :9910] 发送命令 → 队列 → Agent取走执行 → 返回结果

API (Agent端):
  POST /api/connect          注册Agent, 返回 {agent_id, token}
  GET  /api/poll?id=&token=  长轮询取命令 (30s timeout)
  POST /api/result           提交命令执行结果
  POST /api/heartbeat        心跳

API (AI/管理端):
  GET  /api/agents           列出所有在线Agent
  POST /api/exec             向Agent下发命令
  GET  /api/agent/<id>/info  获取Agent系统信息
  GET  /api/agent/<id>/output/<cmd_id>  获取命令输出
  GET  /api/agent/<id>/screenshot       请求截图
  POST /api/agent/<id>/upload           上传文件到Agent
  GET  /api/agent/<id>/download?path=   从Agent下载文件
  GET  /                     Dashboard
  GET  /api/health           健康检查
  GET  /bootstrap.ps1        一键部署脚本(PowerShell)
"""

import json, os, sys, time, socket, uuid, hashlib, base64, io
import threading, secrets

# 道法自然: Windows 默认 GBK 控制台会使 banner 里的 ☰ 等字符炸, 导致 relay 反复崩溃重启
# 根因修复: 统一强制 stdout/stderr 为 UTF-8 (errors=replace 兜底), 与 dao 语义一致
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        try:
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=True)
        except Exception:
            pass
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs, unquote
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict

# ═══════════════════════════════════════════════════════════
# 配置 (全部支持环境变量覆盖, 道法自然)
# ═══════════════════════════════════════════════════════════

PORT = int(os.environ.get('PS_AGENT_PORT', '9910'))
MASTER_TOKEN = os.environ.get('PS_AGENT_MASTER_TOKEN', 'dao-ps-agent-2026')
POLL_TIMEOUT = 30          # 长轮询超时(秒)
HEARTBEAT_TIMEOUT = 120    # Agent离线判定(秒)
MAX_OUTPUT_SIZE = 10 * 1024 * 1024  # 10MB max output
AGENT_EXPIRY = 3600        # Agent 1小时无心跳自动清除
PUBLIC_BASE_URL = os.environ.get('PS_AGENT_PUBLIC_URL', 'https://aiotvr.xyz/ps-agent')
PATH_PREFIX = os.environ.get('PS_AGENT_PATH_PREFIX', '/ps-agent').rstrip('/')  # reverse proxy prefix

# ═══════════════════════════════════════════════════════════
# 机器别名 (友好名称 → hostname, 方便 dao.ps1 调用)
# ═══════════════════════════════════════════════════════════

_alias_json = os.environ.get('PS_AGENT_ALIASES', '{}')
try:
    MACHINE_ALIASES = json.loads(_alias_json)
except:
    MACHINE_ALIASES = {}
# 内置默认别名
MACHINE_ALIASES.setdefault('desktop', 'DESKTOP-MASTER')
MACHINE_ALIASES.setdefault('laptop', 'zhoumac')
MACHINE_ALIASES.setdefault('141', 'DESKTOP-MASTER')
MACHINE_ALIASES.setdefault('179', 'zhoumac')

def resolve_machine_alias(name):
    """Resolve friendly name/alias to stable agent_id (hostname)."""
    return MACHINE_ALIASES.get(name.lower().strip(), name)

# ═══════════════════════════════════════════════════════════
# Agent Registry
# ═══════════════════════════════════════════════════════════

class AgentInfo:
    def __init__(self, agent_id, token, sysinfo):
        self.id = agent_id
        self.token = token
        self.sysinfo = sysinfo  # {hostname, ip, os, user, cpu, ram, ...}
        self.connected_at = time.time()
        self.last_heartbeat = time.time()
        self.command_queue = []  # [{cmd_id, type, payload, queued_at}]
        self.results = {}       # cmd_id -> {output, exit_code, completed_at, ...}
        self.pending_files = {} # cmd_id -> file bytes (for upload)
        self.screenshots = {}   # cmd_id -> base64 png
        self.lock = threading.Lock()
        # 道法自然: 事件驱动的 poll 唤醒, 取代 0.5s 轮询, 命令入队即刻送达
        self.wake_event = threading.Event()

    @property
    def is_alive(self):
        return (time.time() - self.last_heartbeat) < HEARTBEAT_TIMEOUT

    @property
    def status(self):
        if self.is_alive:
            return 'online'
        if (time.time() - self.last_heartbeat) < AGENT_EXPIRY:
            return 'offline'
        return 'expired'

    def to_dict(self, detail=False):
        d = {
            'id': self.id,
            'hostname': self.sysinfo.get('hostname', '?'),
            'ip': self.sysinfo.get('public_ip', self.sysinfo.get('local_ip', '?')),
            'os': self.sysinfo.get('os_version', '?'),
            'user': self.sysinfo.get('username', '?'),
            'status': self.status,
            'connected_at': datetime.fromtimestamp(self.connected_at).isoformat(),
            'last_heartbeat': datetime.fromtimestamp(self.last_heartbeat).isoformat(),
            'pending_commands': len(self.command_queue),
            'completed_commands': len(self.results),
        }
        if detail:
            d['sysinfo'] = self.sysinfo
            d['results'] = {k: {kk: vv for kk, vv in v.items() if kk != 'output_bytes'}
                           for k, v in self.results.items()}
        return d

agents = {}  # agent_id -> AgentInfo
agents_lock = threading.Lock()

def get_agent(agent_id):
    """Case-insensitive agent lookup. 适配一切环境: Windows $env:COMPUTERNAME 常为大写,
    而别名配置可能小写; 此处统一兜底匹配, 让用户无需关心大小写."""
    if not agent_id:
        return None
    with agents_lock:
        # Fast-path: exact match
        a = agents.get(agent_id)
        if a:
            return a
        # Slow-path: case-insensitive match
        target = agent_id.lower()
        for k, v in agents.items():
            if k.lower() == target:
                return v
        return None

def register_agent(sysinfo):
    hostname = sysinfo.get('hostname', 'unknown')
    agent_id = hostname  # Stable ID: hostname is the key (reconnect-safe)
    token = secrets.token_urlsafe(32)
    with agents_lock:
        existing = agents.get(agent_id)
        if existing:
            # Reconnect: update existing agent, preserve command history
            existing.token = token
            existing.sysinfo = sysinfo
            existing.connected_at = time.time()
            existing.last_heartbeat = time.time()
            # 锚定本源: 重连时 **不清空** command_queue.
            # 场景: AI 端 exec-sync 入队 → laptop 网络抖动 → 短暂重注册 →
            # 旧实现清空队列导致命令永久丢失 (exec-sync 10s 后 408).
            # 保留队列, 让 laptop 重新 poll 时照常取走.
            # 唤醒现有等待的 poll, 让其感知 token 已更新 (会返回 None → 客户端重注册).
            existing.wake_event.set()
            print(f"[RECONNECT] {agent_id} from {sysinfo.get('public_ip', sysinfo.get('local_ip', '?'))} (queue preserved: {len(existing.command_queue)})")
            return existing
        agent = AgentInfo(agent_id, token, sysinfo)
        agents[agent_id] = agent
    return agent

def cleanup_expired():
    """Remove expired agents."""
    with agents_lock:
        expired = [k for k, v in agents.items() if v.status == 'expired']
        for k in expired:
            del agents[k]
    return len(expired)

# ═══════════════════════════════════════════════════════════
# Command Queue
# ═══════════════════════════════════════════════════════════

def queue_command(agent_id, cmd_type, payload):
    """Queue a command for an agent. Returns cmd_id."""
    agent = get_agent(agent_id)
    if not agent:
        return None, 'agent not found'
    cmd_id = f"cmd_{int(time.time()*1000)}_{secrets.token_hex(3)}"
    cmd = {
        'cmd_id': cmd_id,
        'type': cmd_type,        # shell, screenshot, sysinfo, file_list, file_read, file_write, process_list, process_kill, download, upload
        'payload': payload,
        'queued_at': time.time(),
    }
    with agent.lock:
        agent.command_queue.append(cmd)
    # 道法自然: 入队即刻唤醒正在等待的 long-poll, 消除 0-500ms 延迟
    agent.wake_event.set()
    return cmd_id, None

def poll_commands(agent_id, token, timeout=POLL_TIMEOUT):
    """Long-poll: wait for commands, return list of pending commands.

    事件驱动: 用 Event.wait(0.5) 代替 sleep(0.5).
    - 有新命令时 queue_command 会 set event → 0ms 返回
    - 无命令时每 0.5s 自动检查 (兜底, 防止 event 丢失)
    - 最坏延迟仍为 500ms, 最好延迟从 250ms (旧: avg 0.5*0.5) 降到 ~0ms
    """
    agent = get_agent(agent_id)
    if not agent or agent.token != token:
        return None
    agent.last_heartbeat = time.time()
    # 进入 poll 时清掉之前残留的 event (避免立即假触发)
    agent.wake_event.clear()
    deadline = time.time() + timeout
    while time.time() < deadline:
        with agent.lock:
            if agent.command_queue:
                cmds = list(agent.command_queue)
                agent.command_queue.clear()
                return cmds
        remaining = deadline - time.time()
        if remaining <= 0:
            break
        # wait 最多 0.5s 或剩余时间, 命令入队时 wake_event.set() 会立刻唤醒
        woke = agent.wake_event.wait(timeout=min(0.5, remaining))
        if woke:
            agent.wake_event.clear()
    return []  # empty = no commands, agent should re-poll

def submit_result(agent_id, token, cmd_id, result_data):
    """Agent submits command result."""
    agent = get_agent(agent_id)
    if not agent or agent.token != token:
        return False
    agent.last_heartbeat = time.time()
    with agent.lock:
        agent.results[cmd_id] = {
            **result_data,
            'completed_at': time.time(),
        }
    return True

# ═══════════════════════════════════════════════════════════
# HTTP Handler
# ═══════════════════════════════════════════════════════════

class AgentRelayHandler(BaseHTTPRequestHandler):
    server_version = "PsAgentRelay/1.0"

    def _normalize_path(self, raw_path):
        """Strip reverse-proxy path prefix (e.g. /ps-agent) for routing."""
        p = raw_path.rstrip('/')
        if PATH_PREFIX and p.startswith(PATH_PREFIX):
            p = p[len(PATH_PREFIX):]
        if not p or not p.startswith('/'):
            p = '/' + p
        return p.rstrip('/')

    def log_message(self, format, *args):
        ts = datetime.now().strftime('%H:%M:%S')
        print(f"[{ts}] {self.address_string()} {format % args}")

    def _json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False, default=str).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def _html(self, html, code=200):
        body = html.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def _text(self, text, code=200, content_type='text/plain'):
        body = text.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', f'{content_type}; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length > MAX_OUTPUT_SIZE:
            return None
        return self.rfile.read(length) if length else b''

    def _check_master_auth(self):
        """Check master token for AI/management endpoints."""
        auth = self.headers.get('Authorization', '')
        if auth == f'Bearer {MASTER_TOKEN}':
            return True
        q = parse_qs(urlparse(self.path).query)
        if q.get('master_token', [''])[0] == MASTER_TOKEN:
            return True
        # Allow localhost without auth — but NOT if proxied (X-Forwarded-For present)
        forwarded = self.headers.get('X-Forwarded-For', '') or self.headers.get('X-Real-IP', '')
        if forwarded:
            return False  # proxied request (FRP/Nginx) — require token
        client_ip = self.client_address[0]
        if client_ip in ('127.0.0.1', '::1', 'localhost'):
            return True
        return False

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = self._normalize_path(parsed.path)
        query = parse_qs(parsed.query)

        # ─── Dashboard ───
        if path in ('', '/'):
            return self._html(generate_dashboard())

        # ─── Health ───
        if path == '/api/health':
            with agents_lock:
                online = sum(1 for a in agents.values() if a.is_alive)
                total = len(agents)
            return self._json({
                'status': 'ok',
                'service': 'ps-agent-relay',
                'version': '1.0',
                'agents_online': online,
                'agents_total': total,
                'uptime': int(time.time() - _start_time),
            })

        # ─── Bootstrap Script ───
        if path == '/bootstrap.ps1':
            return self._text(generate_bootstrap_script(), content_type='text/plain')

        # ─── Agent Poll (Agent端) ───
        if path == '/api/poll':
            aid = query.get('id', [''])[0]
            tok = query.get('token', [''])[0]
            timeout = min(int(query.get('timeout', [str(POLL_TIMEOUT)])[0]), 60)
            cmds = poll_commands(aid, tok, timeout)
            if cmds is None:
                return self._json({'error': 'unauthorized'}, 401)
            return self._json({'commands': cmds})

        # ─── List Agents (AI端) ───
        if path == '/api/agents':
            if not self._check_master_auth():
                return self._json({'error': 'unauthorized'}, 401)
            cleanup_expired()
            with agents_lock:
                agent_list = [a.to_dict() for a in agents.values()]
            return self._json({'agents': agent_list, 'count': len(agent_list)})

        # ─── Agent Detail ───
        if path.startswith('/api/agent/'):
            if not self._check_master_auth():
                return self._json({'error': 'unauthorized'}, 401)
            parts = path.split('/')
            if len(parts) >= 4:
                aid = resolve_machine_alias(parts[3])
                agent = get_agent(aid)
                if not agent:
                    return self._json({'error': 'agent not found'}, 404)

                # /api/agent/<id>/info
                if len(parts) == 5 and parts[4] == 'info':
                    return self._json(agent.to_dict(detail=True))

                # /api/agent/<id>/output/<cmd_id>
                if len(parts) == 6 and parts[4] == 'output':
                    cmd_id = parts[5]
                    with agent.lock:
                        result = agent.results.get(cmd_id)
                    if not result:
                        return self._json({'status': 'pending'})
                    return self._json({'status': 'completed', 'result': result})

                # /api/agent/<id>/screenshot
                if len(parts) == 5 and parts[4] == 'screenshot':
                    cmd_id, err = queue_command(aid, 'screenshot', {})
                    if err:
                        return self._json({'error': err}, 400)
                    return self._json({'cmd_id': cmd_id, 'message': 'screenshot requested, poll output for result'})

                # /api/agent/<id>/sysinfo
                if len(parts) == 5 and parts[4] == 'sysinfo':
                    cmd_id, err = queue_command(aid, 'sysinfo', {})
                    if err:
                        return self._json({'error': err}, 400)
                    return self._json({'cmd_id': cmd_id, 'message': 'sysinfo requested'})

                # /api/agent/<id>/download?path=...
                if len(parts) == 5 and parts[4] == 'download':
                    file_path = query.get('path', [''])[0]
                    if not file_path:
                        return self._json({'error': 'path required'}, 400)
                    cmd_id, err = queue_command(aid, 'file_read', {'path': file_path})
                    if err:
                        return self._json({'error': err}, 400)
                    return self._json({'cmd_id': cmd_id, 'message': 'file download requested'})

                # /api/agent/<id> (default → info)
                if len(parts) == 4:
                    return self._json(agent.to_dict(detail=True))

        return self._json({'error': 'not found'}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = self._normalize_path(parsed.path)
        body_raw = self._read_body()

        try:
            body = json.loads(body_raw) if body_raw else {}
        except:
            body = {}

        # ─── Agent Connect (Agent端) ───
        if path == '/api/connect':
            sysinfo = body.get('sysinfo', {})
            if not sysinfo.get('hostname'):
                return self._json({'error': 'hostname required in sysinfo'}, 400)
            agent = register_agent(sysinfo)
            print(f"[CONNECT] New agent: {agent.id} from {sysinfo.get('hostname')} ({sysinfo.get('public_ip', '?')})")
            return self._json({
                'agent_id': agent.id,
                'token': agent.token,
                'poll_interval': POLL_TIMEOUT,
                'server_time': datetime.now().isoformat(),
            })

        # ─── Agent Result (Agent端) ───
        if path == '/api/result':
            aid = body.get('agent_id', '')
            tok = body.get('token', '')
            cmd_id = body.get('cmd_id', '')
            result = body.get('result', {})
            if submit_result(aid, tok, cmd_id, result):
                return self._json({'ok': True})
            return self._json({'error': 'unauthorized or invalid'}, 401)

        # ─── Agent Heartbeat (Agent端) ───
        if path == '/api/heartbeat':
            aid = body.get('agent_id', '')
            tok = body.get('token', '')
            agent = get_agent(aid)
            if agent and agent.token == tok:
                agent.last_heartbeat = time.time()
                # Update sysinfo if provided
                if body.get('sysinfo'):
                    agent.sysinfo.update(body['sysinfo'])
                return self._json({'ok': True, 'pending': len(agent.command_queue)})
            return self._json({'error': 'unauthorized'}, 401)

        # ─── Execute Command (AI端) ───
        if path == '/api/exec':
            if not self._check_master_auth():
                return self._json({'error': 'unauthorized'}, 401)
            aid = resolve_machine_alias(body.get('agent_id', ''))
            cmd_type = body.get('type', 'shell')
            payload = body.get('payload', {})
            if 'cmd' in body and cmd_type == 'shell':
                payload = {'command': body['cmd']}
            cmd_id, err = queue_command(aid, cmd_type, payload)
            if err:
                return self._json({'error': err}, 400)
            return self._json({'cmd_id': cmd_id, 'agent_id': aid, 'type': cmd_type})

        # ─── Synchronous Execute (AI端, 等待结果返回) ───
        if path == '/api/exec-sync':
            if not self._check_master_auth():
                return self._json({'error': 'unauthorized'}, 401)
            aid = resolve_machine_alias(body.get('agent_id', ''))
            cmd_type = body.get('type', 'shell')
            payload = body.get('payload', {})
            if 'cmd' in body and cmd_type == 'shell':
                payload = {'command': body['cmd']}
            timeout = min(int(body.get('timeout', 30)), 120)
            cmd_id, err = queue_command(aid, cmd_type, payload)
            if err:
                return self._json({'error': err}, 400)
            agent = get_agent(aid)
            if not agent:
                return self._json({'error': 'agent not found'}, 404)
            deadline = time.time() + timeout
            while time.time() < deadline:
                with agent.lock:
                    result = agent.results.get(cmd_id)
                if result:
                    return self._json({'status': 'completed', 'result': result, 'cmd_id': cmd_id, 'agent_id': aid})
                time.sleep(0.3)
            return self._json({'status': 'timeout', 'cmd_id': cmd_id, 'agent_id': aid}, 408)

        # ─── Broadcast Command (AI端, 发给所有在线Agent) ───
        if path == '/api/broadcast':
            if not self._check_master_auth():
                return self._json({'error': 'unauthorized'}, 401)
            cmd_type = body.get('type', 'shell')
            payload = body.get('payload', {})
            if 'cmd' in body and cmd_type == 'shell':
                payload = {'command': body['cmd']}
            with agents_lock:
                live_ids = [a.id for a in agents.values() if a.is_alive]
            results = []
            for aid in live_ids:
                cmd_id, err = queue_command(aid, cmd_type, payload)
                results.append({'agent_id': aid, 'cmd_id': cmd_id, 'error': err})
            return self._json({'broadcast': results, 'count': len(results)})

        # ─── Upload File to Agent (AI端) ───
        if path.startswith('/api/agent/') and path.endswith('/upload'):
            if not self._check_master_auth():
                return self._json({'error': 'unauthorized'}, 401)
            parts = path.split('/')
            if len(parts) >= 5:
                aid = resolve_machine_alias(parts[3])
                dest_path = body.get('path', '')
                content_b64 = body.get('content_base64', '')
                if not dest_path or not content_b64:
                    return self._json({'error': 'path and content_base64 required'}, 400)
                cmd_id, err = queue_command(aid, 'file_write', {
                    'path': dest_path,
                    'content_base64': content_b64,
                })
                if err:
                    return self._json({'error': err}, 400)
                return self._json({'cmd_id': cmd_id, 'message': 'upload queued'})

        return self._json({'error': 'not found'}, 404)

# ═══════════════════════════════════════════════════════════
# Dashboard HTML
# ═══════════════════════════════════════════════════════════

def generate_dashboard():
    with agents_lock:
        agent_list = [a.to_dict() for a in agents.values()]
    online = sum(1 for a in agent_list if a['status'] == 'online')
    total = len(agent_list)

    agent_rows = ''
    for a in sorted(agent_list, key=lambda x: x['status'] != 'online'):
        status_color = '#4ade80' if a['status'] == 'online' else '#f87171'
        status_dot = f'<span style="color:{status_color};font-size:1.2em">●</span>'
        agent_rows += f"""<tr>
            <td>{status_dot} {a['status']}</td>
            <td><b>{a['hostname']}</b></td>
            <td>{a['ip']}</td>
            <td>{a['os']}</td>
            <td>{a['user']}</td>
            <td>{a['connected_at'][:19]}</td>
            <td>{a['last_heartbeat'][:19]}</td>
            <td>{a['pending_commands']}</td>
            <td>{a['completed_commands']}</td>
            <td>
                <button onclick="execCmd('{a['id']}')" class="btn">⚡ 执行</button>
                <button onclick="screenshot('{a['id']}')" class="btn btn-s">📷</button>
                <button onclick="sysinfo('{a['id']}')" class="btn btn-s">📊</button>
            </td>
        </tr>"""

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>☰ 公网PowerShell Agent Relay</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:'Segoe UI',system-ui,sans-serif;background:#0a0a0a;color:#e0e0e0;padding:20px}}
h1{{text-align:center;font-size:1.8em;margin-bottom:8px;background:linear-gradient(90deg,#60a5fa,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}}
.subtitle{{text-align:center;color:#888;margin-bottom:24px;font-size:0.9em}}
.stats{{display:flex;gap:16px;justify-content:center;margin-bottom:24px;flex-wrap:wrap}}
.stat{{background:#1a1a2e;border:1px solid #333;border-radius:12px;padding:16px 24px;text-align:center;min-width:120px}}
.stat .num{{font-size:2em;font-weight:bold;color:#60a5fa}}
.stat .label{{font-size:0.8em;color:#888;margin-top:4px}}
table{{width:100%;border-collapse:collapse;background:#111;border-radius:12px;overflow:hidden}}
th{{background:#1a1a2e;padding:12px 8px;text-align:left;font-size:0.85em;color:#888;border-bottom:1px solid #333}}
td{{padding:10px 8px;border-bottom:1px solid #1a1a2e;font-size:0.85em}}
tr:hover{{background:#1a1a2e}}
.btn{{background:#2563eb;color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:0.8em;margin:2px}}
.btn:hover{{background:#3b82f6}}
.btn-s{{background:#374151;padding:4px 8px}}
.btn-s:hover{{background:#4b5563}}
.oneliner{{background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:16px;margin:20px 0;font-family:'Cascadia Code',monospace;font-size:0.85em;color:#4ade80;position:relative;word-break:break-all}}
.oneliner .copy{{position:absolute;right:8px;top:8px;background:#374151;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.8em}}
.oneliner .copy:hover{{background:#4b5563}}
#output{{background:#0d1117;border:1px solid #333;border-radius:8px;padding:16px;margin-top:16px;font-family:'Cascadia Code',monospace;font-size:0.8em;max-height:400px;overflow:auto;white-space:pre-wrap;display:none;color:#c9d1d9}}
.section{{margin-top:32px}}
.section h2{{font-size:1.2em;margin-bottom:12px;color:#a78bfa}}
</style>
</head>
<body>
<h1>☰ 公网 PowerShell Agent Relay</h1>
<p class="subtitle">道生一 · 一命接万机 — 任意公网电脑，一条命令，全权掌控</p>

<div class="stats">
    <div class="stat"><div class="num">{online}</div><div class="label">在线 Agent</div></div>
    <div class="stat"><div class="num">{total}</div><div class="label">总计 Agent</div></div>
    <div class="stat"><div class="num">{int(time.time()-_start_time)}s</div><div class="label">运行时间</div></div>
</div>

<div class="section">
<h2>⚡ 一键接入命令 (任意Windows电脑运行)</h2>
<div class="oneliner">
irm {PUBLIC_BASE_URL}/bootstrap.ps1 | iex
<button class="copy" onclick="navigator.clipboard.writeText('irm {PUBLIC_BASE_URL}/bootstrap.ps1 | iex')">📋 复制</button>
</div>
</div>

<div class="section">
<h2>🖥️ 已连接 Agent ({total})</h2>
<table>
<tr><th>状态</th><th>主机名</th><th>IP</th><th>操作系统</th><th>用户</th><th>连接时间</th><th>最后心跳</th><th>待执行</th><th>已完成</th><th>操作</th></tr>
{agent_rows}
</table>
</div>

<div id="output"></div>

<script>
const BASE = window.location.pathname.replace(/\\/+$/, '');
let _token = sessionStorage.getItem('ps_agent_token') || '';
function getToken() {{
    if (!_token) {{
        _token = prompt('请输入 Master Token:','');
        if (_token) sessionStorage.setItem('ps_agent_token', _token);
    }}
    return _token || '';
}}

async function api(method, path, body) {{
    const tok = getToken();
    const opts = {{method, headers: {{'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'}}}};
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(BASE + path, opts);
    if (r.status === 401) {{ sessionStorage.removeItem('ps_agent_token'); _token = ''; alert('Token无效，请重试'); return {{error:'unauthorized'}}; }}
    return r.json();
}}

function showOutput(text) {{
    const el = document.getElementById('output');
    el.style.display = 'block';
    el.textContent = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
    el.scrollTop = el.scrollHeight;
}}

async function execCmd(agentId) {{
    const cmd = prompt('输入 PowerShell 命令:', 'Get-ComputerInfo | Select-Object CsName,OsName,OsTotalVisibleMemorySize');
    if (!cmd) return;
    showOutput('⏳ 发送命令...');
    const r = await api('POST', '/api/exec', {{agent_id: agentId, cmd: cmd}});
    if (r.error) {{ showOutput('❌ ' + r.error); return; }}
    showOutput('✅ 命令已排队: ' + r.cmd_id + '\\n⏳ 等待执行结果...');
    // Poll for result
    for (let i = 0; i < 60; i++) {{
        await new Promise(ok => setTimeout(ok, 1000));
        const res = await api('GET', '/api/agent/' + agentId + '/output/' + r.cmd_id);
        if (res.status === 'completed') {{
            showOutput('✅ 完成 (exit=' + (res.result.exit_code||0) + ')\\n\\n' + (res.result.stdout || res.result.output || JSON.stringify(res.result)));
            return;
        }}
    }}
    showOutput('⏱️ 超时，命令可能仍在执行');
}}

async function screenshot(agentId) {{
    showOutput('📷 请求截图...');
    const r = await api('GET', '/api/agent/' + agentId + '/screenshot');
    if (r.error) {{ showOutput('❌ ' + r.error); return; }}
    for (let i = 0; i < 30; i++) {{
        await new Promise(ok => setTimeout(ok, 1000));
        const res = await api('GET', '/api/agent/' + agentId + '/output/' + r.cmd_id);
        if (res.status === 'completed' && res.result.screenshot_base64) {{
            const el = document.getElementById('output');
            el.style.display = 'block';
            el.innerHTML = '<img src="data:image/png;base64,' + res.result.screenshot_base64 + '" style="max-width:100%">';
            return;
        }}
    }}
    showOutput('⏱️ 截图超时');
}}

async function sysinfo(agentId) {{
    showOutput('📊 获取系统信息...');
    const r = await api('GET', '/api/agent/' + agentId + '/sysinfo');
    if (r.error) {{ showOutput('❌ ' + r.error); return; }}
    for (let i = 0; i < 15; i++) {{
        await new Promise(ok => setTimeout(ok, 1000));
        const res = await api('GET', '/api/agent/' + agentId + '/output/' + r.cmd_id);
        if (res.status === 'completed') {{
            showOutput(JSON.stringify(res.result, null, 2));
            return;
        }}
    }}
    showOutput('⏱️ 超时');
}}

// Auto-refresh every 10s
setInterval(() => location.reload(), 15000);
</script>
</body></html>"""


# ═══════════════════════════════════════════════════════════
# Bootstrap Script Generator
# ═══════════════════════════════════════════════════════════

def generate_bootstrap_script():
    """Generate the PowerShell one-liner bootstrap script.
    道法自然: 先连接(快), 后探测(慢). 不让WMI阻塞启动."""
    return f"""# ============================================================
# 公网 PowerShell Agent v2.0 — 一键接入脚本
# 用法: irm {PUBLIC_BASE_URL}/bootstrap.ps1 | iex
# 道法自然: 先连接, 后探测 — 零等待启动
# ============================================================
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$SERVER = '{PUBLIC_BASE_URL}'
$POLL_URL = $SERVER + '/api/poll'
$CONNECT_URL = $SERVER + '/api/connect'
$RESULT_URL = $SERVER + '/api/result'
$HEARTBEAT_URL = $SERVER + '/api/heartbeat'

# ── 代理旁路 (适配一切环境: 清理本会话陈旧/失效代理, relay 永远公网直达) ──
foreach ($pv in 'HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy') {{
    Set-Item "env:$pv" -Value '' -EA SilentlyContinue
}}
try {{ $_host = ([Uri]$SERVER).Host }} catch {{ $_host = '' }}
$env:NO_PROXY = if ($_host) {{ "localhost,127.0.0.1,$_host" }} else {{ 'localhost,127.0.0.1' }}
# .NET HttpClient 需要显式 UseDefaultProxy=false; 通过 handler 覆盖, 双保险
[System.Net.WebRequest]::DefaultWebProxy = [System.Net.WebProxy]::new()

# ── 快速系统信息 (零WMI, <100ms) ──
function Get-QuickSysInfo {{
    @{{
        hostname      = $env:COMPUTERNAME
        username      = $env:USERNAME
        domain        = $env:USERDOMAIN
        os_arch       = $env:PROCESSOR_ARCHITECTURE
        ps_version    = $PSVersionTable.PSVersion.ToString()
        agent_version = '2.0'
        agent_pid     = $PID
        public_ip     = 'detecting...'
        os_version    = 'detecting...'
    }}
}}

# ── 详细系统信息 (带超时保护, 后台收集) ──
function Get-FullSysInfo {{
    $info = @{{
        hostname      = $env:COMPUTERNAME
        username      = $env:USERNAME
        domain        = $env:USERDOMAIN
        os_arch       = $env:PROCESSOR_ARCHITECTURE
        ps_version    = $PSVersionTable.PSVersion.ToString()
        agent_version = '2.0'
        agent_pid     = $PID
    }}
    # WMI calls with individual try/catch (never block)
    try {{ $os = Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 10 -EA Stop
        $info['os_version']  = "$($os.Caption) $($os.Version)"
        $info['ram_total_gb'] = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
        $info['ram_free_gb']  = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
        try {{ $info['uptime_hours'] = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1) }} catch {{}}
    }} catch {{ $info['os_version'] = 'WMI timeout' }}
    try {{ $cpu = Get-CimInstance Win32_Processor -OperationTimeoutSec 10 -EA Stop | Select-Object -First 1
        $info['cpu_name']    = $cpu.Name
        $info['cpu_cores']   = $cpu.NumberOfCores
        $info['cpu_threads'] = $cpu.NumberOfLogicalProcessors
    }} catch {{}}
    try {{ $net = Get-NetIPAddress -AddressFamily IPv4 -EA Stop |
           Where-Object {{ $_.IPAddress -notmatch '^(127\\.|169\\.254)' }} | Select-Object -First 1
        $info['local_ip'] = $net.IPAddress
    }} catch {{}}
    try {{ $info['public_ip'] = (Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 5) }} catch {{ $info['public_ip'] = 'unknown' }}
    try {{ $info['disk_info'] = (Get-PSDrive -PSProvider FileSystem -EA Stop | ForEach-Object {{
        "$($_.Name): $([math]::Round($_.Used/1GB,1))/$([math]::Round(($_.Used+$_.Free)/1GB,1))GB"
    }}) -join ' | ' }} catch {{}}
    return $info
}}

# ── 安全JSON发送 ──
function Send-JsonSafe {{
    param([string]$Url, [hashtable]$Body, [int]$TimeoutSec = 30)
    $json = $Body | ConvertTo-Json -Depth 10 -Compress
    if ($json.Length -gt 8MB) {{
        if ($Body.result -and $Body.result.stdout) {{
            $Body.result.stdout = $Body.result.stdout.Substring(0, [Math]::Min($Body.result.stdout.Length, 500000)) + "`n... [TRUNCATED]"
        }}
        if ($Body.result -and $Body.result.screenshot_base64 -and $Body.result.screenshot_base64.Length -gt 6MB) {{
            $Body.result.Remove('screenshot_base64')
            $Body.result['error'] = 'Screenshot too large'
        }}
        $json = $Body | ConvertTo-Json -Depth 10 -Compress
    }}
    Invoke-RestMethod -Uri $Url -Method POST -Body $json -ContentType 'application/json; charset=utf-8' -TimeoutSec $TimeoutSec
}}

# ══════════════════════════════════════════════════
# 启动 · 道生一(快连) → 一生二(后探) → 二生三(听令)
# ══════════════════════════════════════════════════

Write-Host "`n[*] 公网PowerShell Agent v2.0 启动中..." -ForegroundColor Cyan
Write-Host "[*] 主机: $env:COMPUTERNAME | 用户: $env:USERNAME" -ForegroundColor Gray

# Step 1: 快速连接 (仅hostname, <1秒)
Write-Host "[*] 连接服务器: $SERVER" -ForegroundColor Yellow
$quickInfo = Get-QuickSysInfo
try {{
    $regBody = @{{ sysinfo = $quickInfo }} | ConvertTo-Json -Depth 5
    $reg = Invoke-RestMethod -Uri $CONNECT_URL -Method POST -Body $regBody -ContentType 'application/json; charset=utf-8' -TimeoutSec 15
}} catch {{
    Write-Host "[!] 连接失败: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "[!] 服务器: $SERVER" -ForegroundColor Red
    return
}}

$AGENT_ID = $reg.agent_id
$TOKEN = $reg.token
Write-Host "[+] 注册成功! Agent ID: $AGENT_ID" -ForegroundColor Green

# Step 2: 后台收集详细信息并通过心跳更新
Write-Host "[*] 后台收集详细系统信息..." -ForegroundColor Gray
$fullInfo = Get-FullSysInfo
try {{
    $hb = @{{ agent_id = $AGENT_ID; token = $TOKEN; sysinfo = $fullInfo }} | ConvertTo-Json -Depth 5
    Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Body $hb -ContentType 'application/json' -TimeoutSec 10 | Out-Null
    Write-Host "[*] IP: $($fullInfo.public_ip) | OS: $($fullInfo.os_version)" -ForegroundColor Gray
}} catch {{}}

Write-Host "[+] 等待命令中... (Ctrl+C 退出)`n" -ForegroundColor Green

# ── 命令执行器 (全功能) ──
function Invoke-AgentCommand($cmd) {{
    $type = $cmd.type
    $payload = $cmd.payload
    $result = @{{}}
    switch ($type) {{
        'shell' {{
            $command = $payload.command
            Write-Host "  [>] shell: $command" -ForegroundColor DarkCyan
            try {{
                $ps = [PowerShell]::Create()
                $ps.AddScript($command) | Out-Null
                $handle = $ps.BeginInvoke()
                if ($handle.AsyncWaitHandle.WaitOne(300000)) {{
                    $output = $ps.EndInvoke($handle)
                    $stdout = ($output | Out-String -Width 4096)
                    $stderr = ($ps.Streams.Error | ForEach-Object {{ $_.ToString() }}) -join "`n"
                    $result = @{{
                        stdout    = if ($stdout) {{ $stdout.Substring(0, [Math]::Min($stdout.Length, 1048576)) }} else {{ '' }}
                        stderr    = if ($stderr) {{ $stderr.Substring(0, [Math]::Min($stderr.Length, 262144)) }} else {{ '' }}
                        exit_code = if ($ps.HadErrors) {{ 1 }} else {{ 0 }}
                    }}
                }} else {{
                    $ps.Stop()
                    $result = @{{ error = 'Command timed out (300s)'; exit_code = -1; stdout = '' }}
                }}
                $ps.Dispose()
            }} catch {{
                $result = @{{ error = $_.Exception.Message; exit_code = -1 }}
            }}
        }}
        'screenshot' {{
            Write-Host "  [>] screenshot" -ForegroundColor DarkCyan
            try {{
                Add-Type -AssemblyName System.Windows.Forms
                Add-Type -AssemblyName System.Drawing
                $scale = if ($payload.scale) {{ [int]$payload.scale }} else {{ 50 }}
                $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
                $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
                $g = [System.Drawing.Graphics]::FromImage($bmp)
                $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
                $newW = [int]($bounds.Width * $scale / 100)
                $newH = [int]($bounds.Height * $scale / 100)
                $scaled = New-Object System.Drawing.Bitmap($newW, $newH)
                $g2 = [System.Drawing.Graphics]::FromImage($scaled)
                $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $g2.DrawImage($bmp, 0, 0, $newW, $newH)
                $ms = New-Object System.IO.MemoryStream
                $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object {{ $_.MimeType -eq 'image/jpeg' }}
                $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
                $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 60L)
                $scaled.Save($ms, $jpegCodec, $encoderParams)
                $b64 = [Convert]::ToBase64String($ms.ToArray())
                $g.Dispose(); $g2.Dispose(); $bmp.Dispose(); $scaled.Dispose(); $ms.Dispose()
                $result = @{{ screenshot_base64 = $b64; width = $newW; height = $newH; scale = $scale; format = 'jpeg'; size_kb = [math]::Round($b64.Length/1024,1) }}
            }} catch {{
                $result = @{{ error = $_.Exception.Message }}
            }}
        }}
        'sysinfo' {{
            Write-Host "  [>] sysinfo" -ForegroundColor DarkCyan
            $result = Get-FullSysInfo
            $result['processes_count'] = (Get-Process).Count
            $result['top_cpu'] = @(Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 |
                ForEach-Object {{ @{{ name=$_.ProcessName; pid=$_.Id; cpu_sec=[math]::Round($_.CPU,1); mem_mb=[math]::Round($_.WorkingSet64/1MB,1) }} }})
            $result['network_adapters'] = @(Get-NetAdapter -EA SilentlyContinue | Where-Object Status -eq 'Up' |
                ForEach-Object {{ @{{ name=$_.Name; speed=$_.LinkSpeed; mac=$_.MacAddress }} }})
            $result['listening_ports'] = @(Get-NetTCPConnection -State Listen -EA SilentlyContinue | Sort-Object LocalPort | Select-Object -First 50 |
                ForEach-Object {{ @{{ port=$_.LocalPort; pid=$_.OwningProcess; process=(Get-Process -Id $_.OwningProcess -EA SilentlyContinue).ProcessName }} }})
        }}
        'process_list' {{
            Write-Host "  [>] process_list" -ForegroundColor DarkCyan
            $result = @{{ processes = @(Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 100 |
                ForEach-Object {{ @{{ name=$_.ProcessName; pid=$_.Id; mem_mb=[math]::Round($_.WorkingSet64/1MB,1); cpu_sec=[math]::Round($_.CPU,1); window=$_.MainWindowTitle; path=$_.Path }} }}) }}
        }}
        'process_kill' {{
            $pid_to_kill = $payload.pid; $name_to_kill = $payload.name
            Write-Host "  [>] process_kill: pid=$pid_to_kill name=$name_to_kill" -ForegroundColor DarkYellow
            try {{
                if ($pid_to_kill) {{ Stop-Process -Id $pid_to_kill -Force; $result = @{{ killed_pid = $pid_to_kill; ok = $true }} }}
                elseif ($name_to_kill) {{ Stop-Process -Name $name_to_kill -Force; $result = @{{ killed_name = $name_to_kill; ok = $true }} }}
                else {{ $result = @{{ error = 'pid or name required' }} }}
            }} catch {{ $result = @{{ error = $_.Exception.Message }} }}
        }}
        'file_list' {{
            $dir = if ($payload.path) {{ $payload.path }} else {{ 'C:\\' }}
            Write-Host "  [>] file_list: $dir" -ForegroundColor DarkCyan
            try {{
                $items = @(Get-ChildItem -Path $dir -EA Stop | Select-Object -First 500 |
                    ForEach-Object {{ @{{ name=$_.Name; size=$_.Length; is_dir=$_.PSIsContainer; modified=$_.LastWriteTime.ToString('s'); ext=$_.Extension }} }})
                $result = @{{ path = $dir; items = $items; count = $items.Count }}
            }} catch {{ $result = @{{ error = $_.Exception.Message }} }}
        }}
        'file_read' {{
            $path = $payload.path
            Write-Host "  [>] file_read: $path" -ForegroundColor DarkCyan
            try {{
                $fi = Get-Item $path -EA Stop
                if ($fi.Length -gt 5MB) {{ $result = @{{ error = "File too large: $([math]::Round($fi.Length/1MB,1))MB (max 5MB)"; size = $fi.Length }} }}
                else {{ $result = @{{ path = $path; size = $fi.Length; content_base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) }} }}
            }} catch {{ $result = @{{ error = $_.Exception.Message }} }}
        }}
        'file_write' {{
            $path = $payload.path
            Write-Host "  [>] file_write: $path" -ForegroundColor DarkYellow
            try {{
                $dir = Split-Path $path -Parent
                if (-not (Test-Path $dir)) {{ New-Item -Path $dir -ItemType Directory -Force | Out-Null }}
                $bytes = [Convert]::FromBase64String($payload.content_base64)
                [IO.File]::WriteAllBytes($path, $bytes)
                $result = @{{ path = $path; written_bytes = $bytes.Length; ok = $true }}
            }} catch {{ $result = @{{ error = $_.Exception.Message }} }}
        }}
        'registry_read' {{
            $key = $payload.path
            Write-Host "  [>] registry_read: $key" -ForegroundColor DarkCyan
            try {{
                $item = Get-ItemProperty -Path $key -EA Stop
                $props = @{{}}; $item.PSObject.Properties | Where-Object {{ $_.Name -notmatch '^PS' }} | ForEach-Object {{ $props[$_.Name] = "$($_.Value)" }}
                $result = @{{ path = $key; properties = $props }}
            }} catch {{ $result = @{{ error = $_.Exception.Message }} }}
        }}
        'service_list' {{
            Write-Host "  [>] service_list" -ForegroundColor DarkCyan
            $filter = $payload.filter; $svcs = Get-Service
            if ($filter) {{ $svcs = $svcs | Where-Object {{ $_.Name -like "*$filter*" -or $_.DisplayName -like "*$filter*" }} }}
            $result = @{{ services = @($svcs | Select-Object -First 200 | ForEach-Object {{ @{{ name=$_.Name; display=$_.DisplayName; status=$_.Status.ToString(); start_type=$_.StartType.ToString() }} }}) }}
        }}
        'network_info' {{
            Write-Host "  [>] network_info" -ForegroundColor DarkCyan
            $result = @{{
                adapters = @(Get-NetAdapter -EA SilentlyContinue | ForEach-Object {{ @{{ name=$_.Name; status=$_.Status.ToString(); speed=$_.LinkSpeed; mac=$_.MacAddress }} }})
                ip_config = @(Get-NetIPAddress -AddressFamily IPv4 -EA SilentlyContinue | ForEach-Object {{ @{{ ip=$_.IPAddress; prefix=$_.PrefixLength; iface=$_.InterfaceAlias }} }})
                dns = @(Get-DnsClientServerAddress -AddressFamily IPv4 -EA SilentlyContinue | ForEach-Object {{ @{{ iface=$_.InterfaceAlias; dns=$_.ServerAddresses }} }})
                connections_count = (Get-NetTCPConnection -State Established -EA SilentlyContinue | Measure-Object).Count
            }}
        }}
        'env_vars' {{
            Write-Host "  [>] env_vars" -ForegroundColor DarkCyan
            $filter = $payload.filter; $all = [Environment]::GetEnvironmentVariables(); $vars = @{{}}
            $all.GetEnumerator() | ForEach-Object {{ if (-not $filter -or $_.Key -like "*$filter*") {{ $vars[$_.Key] = $_.Value }} }}
            $result = @{{ variables = $vars; count = $vars.Count }}
        }}
        'installed_apps' {{
            Write-Host "  [>] installed_apps" -ForegroundColor DarkCyan
            $result = @{{ apps = @(Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*","HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" -EA SilentlyContinue |
                Where-Object {{ $_.DisplayName }} | Sort-Object DisplayName | ForEach-Object {{ @{{ name=$_.DisplayName; version=$_.DisplayVersion; publisher=$_.Publisher }} }}) }}
        }}
        default {{ $result = @{{ error = "Unknown command type: $type"; supported = @('shell','screenshot','sysinfo','process_list','process_kill','file_list','file_read','file_write','registry_read','service_list','network_info','env_vars','installed_apps') }} }}
    }}
    return $result
}}

# ── 自动重注册 ──
function Invoke-BootstrapReRegister {{
    Write-Host "[*] Token失效，重新注册..." -ForegroundColor Yellow
    try {{
        $si = Get-FullSysInfo
        $body = @{{ sysinfo = $si }} | ConvertTo-Json -Depth 5
        $reg = Invoke-RestMethod -Uri $CONNECT_URL -Method POST -Body $body -ContentType 'application/json; charset=utf-8' -TimeoutSec 15
        $script:AGENT_ID = $reg.agent_id; $script:TOKEN = $reg.token
        Write-Host "[+] 重新注册成功! Agent ID: $($script:AGENT_ID)" -ForegroundColor Green
        return $true
    }} catch {{
        Write-Host "[!] 重新注册失败: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }}
}}

# ── 心跳后台定时器 ──
$heartbeatTimer = New-Object System.Timers.Timer
$heartbeatTimer.Interval = 30000
$heartbeatTimer.AutoReset = $true
$heartbeatAction = {{
    try {{
        $body = @{{ agent_id = $script:AGENT_ID; token = $script:TOKEN }} | ConvertTo-Json
        Invoke-RestMethod -Uri $script:HEARTBEAT_URL -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 10 | Out-Null
    }} catch {{ }}
}}
Register-ObjectEvent -InputObject $heartbeatTimer -EventName Elapsed -Action $heartbeatAction | Out-Null
$heartbeatTimer.Start()

# ── 主循环: 长轮询 ──
$reconnect_count = 0; $total_commands = 0
try {{
    while ($true) {{
        try {{
            $pollUri = $POLL_URL + '?id=' + $AGENT_ID + '&token=' + $TOKEN + '&timeout=30'
            $poll = Invoke-RestMethod -Uri $pollUri -TimeoutSec 35
            $reconnect_count = 0
            if ($poll.commands -and $poll.commands.Count -gt 0) {{
                foreach ($cmd in $poll.commands) {{
                    $total_commands++
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] #$total_commands 收到命令: $($cmd.type) ($($cmd.cmd_id))" -ForegroundColor Cyan
                    $sw = [System.Diagnostics.Stopwatch]::StartNew()
                    $result = Invoke-AgentCommand $cmd
                    $sw.Stop()
                    $result['execution_time_ms'] = $sw.ElapsedMilliseconds
                    try {{
                        Send-JsonSafe -Url $RESULT_URL -Body @{{ agent_id=$AGENT_ID; token=$TOKEN; cmd_id=$cmd.cmd_id; result=$result }} -TimeoutSec 30
                        Write-Host "  [+] 结果已提交 ($($sw.ElapsedMilliseconds)ms)" -ForegroundColor Green
                    }} catch {{
                        Write-Host "  [!] 提交失败: $($_.Exception.Message)" -ForegroundColor Red
                    }}
                }}
            }}
        }} catch [System.Net.WebException] {{
            if ($_.Exception.Status -eq 'Timeout') {{ continue }}
            $resp = $_.Exception.Response
            if ($resp -and [int]$resp.StatusCode -eq 401) {{
                if (Invoke-BootstrapReRegister) {{ $reconnect_count = 0; continue }}
            }}
            $reconnect_count++; $wait = [Math]::Min($reconnect_count * 5, 60)
            Write-Host "[!] 连接断开 ($($_.Exception.Message))，${{wait}}秒后重连 (#$reconnect_count)..." -ForegroundColor Yellow
            Start-Sleep -Seconds $wait
        }} catch {{
            if ($_.Exception.Message -match '401|Unauthorized') {{
                if (Invoke-BootstrapReRegister) {{ $reconnect_count = 0; continue }}
            }}
            $reconnect_count++; $wait = [Math]::Min($reconnect_count * 5, 60)
            Write-Host "[!] 错误: $($_.Exception.Message)，${{wait}}秒后重连 (#$reconnect_count)..." -ForegroundColor Yellow
            Start-Sleep -Seconds $wait
        }}
    }}
}} finally {{
    $heartbeatTimer.Stop(); $heartbeatTimer.Dispose()
    Get-EventSubscriber | Unregister-Event -EA SilentlyContinue
    Write-Host "`n[*] Agent 已退出 (共执行 $total_commands 条命令)" -ForegroundColor Yellow
}}
"""


# ═══════════════════════════════════════════════════════════
# Cleanup Thread
# ═══════════════════════════════════════════════════════════

def _cleanup_loop():
    while True:
        time.sleep(300)
        n = cleanup_expired()
        if n:
            print(f"[CLEANUP] Removed {n} expired agents")

# ═══════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════

_start_time = time.time()

def main():
    global PORT
    import argparse
    parser = argparse.ArgumentParser(description='公网 PowerShell Agent Relay Server')
    parser.add_argument('--port', type=int, default=PORT, help=f'端口 (默认 {PORT})')
    args = parser.parse_args()
    PORT = args.port

    # Start cleanup thread
    t = threading.Thread(target=_cleanup_loop, daemon=True)
    t.start()

    class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
        daemon_threads = True
    # 道·柔弱胜刚强: 仅绑 127.0.0.1 — Relay 仅由本机 dao.js 代理访问, 无需对外.
    # 避免 Windows Hyper-V/WSL/winnat 对 0.0.0.0 高端口段的 PermissionError 10013.
    try:
        server = ThreadingHTTPServer(('127.0.0.1', PORT), AgentRelayHandler)
    except PermissionError as e:
        print(f"[relay!] Port {PORT} bind denied ({e}) — ", end='')
        print("Windows 可能预留了此端口段. dao.js 会换口重启.", flush=True)
        sys.exit(1)
    except OSError as e:
        print(f"[relay!] Port {PORT} bind failed: {e}", flush=True)
        sys.exit(1)
    hostname = socket.gethostname()
    print(f"""
╔══════════════════════════════════════════════════════════╗
║  ☰ 公网 PowerShell Agent Relay v1.0                     ║
║  道生一 · 一命接万机                                      ║
╠══════════════════════════════════════════════════════════╣
║  Dashboard:  http://localhost:{PORT}/                     ║
║  Health:     http://localhost:{PORT}/api/health            ║
║  Bootstrap:  http://localhost:{PORT}/bootstrap.ps1         ║
║  公网:       {PUBLIC_BASE_URL}/                            ║
║  主机:       {hostname}                                    ║
║  Master Token: {MASTER_TOKEN[:8]}...                       ║
╠══════════════════════════════════════════════════════════╣
║  一键接入:                                                ║
║  irm {PUBLIC_BASE_URL}/bootstrap.ps1 | iex               ║
╚══════════════════════════════════════════════════════════╝
""")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] Server stopped")
        server.server_close()

if __name__ == '__main__':
    main()
