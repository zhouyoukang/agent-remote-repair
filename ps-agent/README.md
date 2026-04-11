# PowerShell Agent Relay

> 道生一(Server) → 一生二(Agent) → 二生三(AI) → 三生万物(万机可控)

Zero-dependency Python HTTP relay server + PowerShell agent client. One command deploys an agent on any Windows PC, giving you full remote control via API.

## Architecture

```
┌─────────────────┐    HTTP/HTTPS     ┌──────────────────┐     HTTP Long-Poll     ┌─────────────────┐
│   AI / Cascade   │ ──── exec ────→  │  Relay Server    │  ←── poll commands ──  │  Agent Client   │
│   Dashboard      │ ←── result ────  │  (Python stdlib) │  ──── submit result →  │  (PowerShell)   │
└─────────────────┘                   └──────────────────┘                        └─────────────────┘
                                             ↑
                                      Nginx / FRP / Cloudflare Tunnel
                                      (optional, for public access)
```

## Quick Start

### 1. Start the Relay Server

```bash
# Install: nothing. Zero dependencies, pure Python stdlib.
python ps_agent_server.py --port 9910
```

### 2. Connect an Agent (on any Windows PC)

```powershell
# Option A: One-liner bootstrap (downloads and runs agent from server)
irm http://your-server:9910/bootstrap.ps1 | iex

# Option B: Run the full-featured client directly
.\ps_agent_client.ps1 -Server http://your-server:9910
```

### 3. Control via API

```bash
# List online agents
curl http://localhost:9910/api/agents -H "Authorization: Bearer YOUR_TOKEN"

# Execute command (sync, waits for result)
curl -X POST http://localhost:9910/api/exec-sync \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"DESKTOP-PC","cmd":"Get-ComputerInfo | Select CsName,OsName"}'

# Screenshot
curl http://localhost:9910/api/agent/DESKTOP-PC/screenshot \
  -H "Authorization: Bearer YOUR_TOKEN"

# Broadcast to all agents
curl -X POST http://localhost:9910/api/broadcast \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"cmd":"hostname"}'
```

### 4. Dashboard

Open `http://localhost:9910/` in browser — interactive web dashboard with command execution, screenshots, and sysinfo.

## Supported Agent Commands

| Type | Description |
|------|-------------|
| `shell` | Execute any PowerShell command |
| `screenshot` | Capture screen (JPEG, configurable scale) |
| `sysinfo` | Full system info + top processes + ports |
| `process_list` | Process list with memory/CPU |
| `process_kill` | Kill process by PID or name |
| `file_list` | Directory listing |
| `file_read` | Download file (base64, max 5MB) |
| `file_write` | Upload file |
| `registry_read` | Read registry key |
| `service_list` | Windows services |
| `network_info` | Adapters, IPs, DNS, connections |
| `env_vars` | Environment variables (with filter) |
| `installed_apps` | Installed software list |
| `scheduled_tasks` | Active scheduled tasks |
| `clipboard` | Clipboard text content |
| `display_info` | Screen/display info |
| `wifi_profiles` | WiFi profiles with passwords |
| `firewall_rules` | Active inbound firewall rules |
| `power_plan` | Active power plan |

## API Reference

### Agent Endpoints (used by agent client)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/connect` | Register agent, returns `{agent_id, token}` |
| GET | `/api/poll?id=&token=&timeout=30` | Long-poll for commands |
| POST | `/api/result` | Submit command result |
| POST | `/api/heartbeat` | Heartbeat (also updated by poll) |

### Management Endpoints (require master token)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | List all agents |
| POST | `/api/exec` | Queue command (async) |
| POST | `/api/exec-sync` | Execute and wait for result |
| POST | `/api/broadcast` | Send to all online agents |
| GET | `/api/agent/{id}/info` | Agent details + sysinfo |
| GET | `/api/agent/{id}/output/{cmd_id}` | Get command result |
| GET | `/api/agent/{id}/screenshot` | Request screenshot |
| GET | `/api/agent/{id}/sysinfo` | Request sysinfo |
| GET | `/api/agent/{id}/download?path=` | Request file download |
| POST | `/api/agent/{id}/upload` | Upload file to agent |
| GET | `/api/health` | Server health check |
| GET | `/bootstrap.ps1` | Agent bootstrap script |

## Configuration

All configuration via environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PS_AGENT_PORT` | `9910` | Server listen port |
| `PS_AGENT_MASTER_TOKEN` | `change-me-...` | Auth token for management API |
| `PS_AGENT_PUBLIC_URL` | `http://localhost:9910` | Public URL for bootstrap script |
| `PS_AGENT_PATH_PREFIX` | (empty) | Reverse proxy path prefix |
| `PS_AGENT_ALIASES` | `{}` | JSON machine alias map |

## Security Notes

- **Change the default master token** in production
- Agent tokens are per-session (generated on connect, invalidated on server restart)
- Agents auto-re-register on 401 (server restart)
- Localhost management access allowed without token (unless proxied)
- Consider running behind HTTPS (Nginx/Cloudflare) for production
