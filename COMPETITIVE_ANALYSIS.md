# Competitive Analysis & Integration Roadmap — dao-remote v8.4

**Date**: 2026-04-17 (initial) · 2026-04-19 (v8.3 refresh · v8.4 mDNS browse)
**Method**: Tavily deep search + codebase reverse-engineering + workspace cross-scan

---

## 1. Competitive Landscape (2026)

| Feature | **dao-remote** | **RustDesk** (106K★) | **MeshCentral** (6.4K★) | **Guacamole** |
|---------|---------------|---------------------|------------------------|---------------|
| **Language** | Node.js + Python + Go | Rust + Flutter | Node.js (NPM) | Java + C |
| **Auth** | Ed25519 JWT (zero-config) | Ed25519 key pair | Account + 2FA | LDAP/SSO |
| **NAT Traversal** | UPnP/NAT-PMP/SSH/cloudflared | UDP hole-punch + relay (hbbr) | WebSocket relay → WebRTC upgrade | Gateway only |
| **LAN Discovery** | mDNS + UDP multicast + QR pair | ID server rendezvous | Agent WebSocket heartbeat | Manual config |
| **Streaming** | Ghost Shell (GDI) + MJPEG/RTSP/WebRTC (Android) | Custom codec (VP8/VP9/AV1) | WebSocket relay → WebRTC | guacd protocol |
| **QR Pairing** | Zero-dep hand-written QR (v1-v10) + one-shot claim | Numeric ID + password | URL + agent install | N/A |
| **Zero Install** | `irm .../go \| iex` one-liner | Desktop installer required | `npm install meshcentral` | Docker + Tomcat |
| **Client** | Browser (PWA /sense) + PowerShell | Native (Flutter) | Browser (100% web) | Browser (HTML5) |
| **Self-host** | Single `node dao.js` | hbbs + hbbr (2 processes) | Single Node.js | Docker compose (3 containers) |
| **Deps** | `ws` only (1 npm dep) | Rust toolchain | ~40 npm deps + MongoDB optional | Java + guacd + Tomcat |

### Key RustDesk Insights (逆向)
- **hbbs** (rendezvous/ID) + **hbbr** (relay) architecture, Ed25519 key agreement
- UDP port 21116 for hole-punching; TCP 21117-21119 for relay + WebSocket
- Client keeps persistent heartbeat to hbbs → instant connection when peer requests
- **Weakness**: Requires native client install; no browser-only mode until WebClient v2

### Key MeshCentral Insights (逆向)
- **Design decision**: Almost zero REST API; everything over WebSocket (real-time, no polling)
- Agent pushes JS code from server → agent behavior instantly changeable
- Browser ↔ Agent: starts WebSocket relay, auto-upgrades to WebRTC when possible
- **Weakness**: Requires agent install on target; no zero-config QR pairing

### dao-remote Unique Advantages
1. **True zero-config**: `node dao.js` → identity + discovery + pairing + streaming, one command
2. **QR one-shot pairing**: Scan → claim → token → /sense UI, no account creation
3. **Multi-protocol NAT**: UPnP → NAT-PMP → SSH tunnel → cloudflared, cascading fallback
4. **Quadruple discovery**: mDNS (.local) + UDP multicast + QR + tunnel URL
5. **Browser-native**: No native client needed, full PWA experience at /sense
6. **1 npm dependency** (ws): Smallest attack surface of any comparable tool

---

## 2. Gap Analysis — What dao-remote Still Needs

### Critical (P0)
| Gap | Status | Effort |
|-----|--------|--------|
| **WebRTC P2P data channel** (browser ↔ source signaling) | ✅ v8.2 `/ws/rtc` + `/dao/rtc` REST fallback | Medium |
| **Persistent agent mode** (auto-start on boot) | ✅ v8.3 `dao.js --install` (schtasks ONLOGON) | Low |
| **File transfer** | ✅ v8.2 `/files` `/files/get` `/files/put` + v8.3 UI | Medium |
| **Clipboard sync** | ✅ v8.2 `/dao/clipboard` GET/POST + v8.3 UI | Low |

### Important (P1)
| Gap | Notes | Effort |
|-----|-------|--------|
| **AV1/VP9 hardware codec** for streaming | Ghost Shell currently uses GDI BitBlt → JPEG; modern codecs 10x more efficient | High |
| **Audio capture** (WASAPI relay) | Ghost Shell has WASAPI stub but not wired to browser | Medium |
| **Multi-monitor support** | dao_screen_registry has structure; needs per-monitor capture | Medium |
| **Session recording/playback** | MeshCentral has this; useful for audit | Medium |

### Nice-to-have (P2)
| Gap | Notes |
|-----|-------|
| **Mobile agent** (Android) | Android MJPEG/WebRTC modules already exist in `020-投屏链路_Streaming/` |
| **Wake-on-LAN** | ✅ v8.3 `dao_wol.js` + `/dao/wol` + UI (唤醒 tab) — 102B magic packet, multi-broadcast |
| **Chat/messaging** | MeshCentral has built-in messenger |
| **Plugin system** | MeshCentral pushes JS to agent; dao could do similar via /tools endpoint |

---

## 3. Workspace Integration Opportunities

### Already Built (Just Wire It Up)

| Module | Location | Integration Point |
|--------|----------|-------------------|
| **MJPEG Streaming** (Android) | `020-投屏链路_Streaming/010-MJPEG投屏_MJPEG/` | Register in `dao_screen_registry.js` as source with probe on Android IP:8081 |
| **RTSP Streaming** (Android) | `020-投屏链路_Streaming/020-RTSP投屏_RTSP/` | Register as RTSP source; hub proxies to browser via MSE |
| **WebRTC Streaming** (Android) | `020-投屏链路_Streaming/030-WebRTC投屏_WebRTC/` | P2P upgrade path: browser ↔ Android direct, hub as signaling only |
| **Input/Control** (Android) | `040-反向控制_Input/` | Wire `InputHttpServer.kt` as input target in registry |
| **Smart Home** (HA) | `100-智能家居_SmartHome/` | Expose HA entities via /tools endpoint for remote diagnosis |
| **向日葵 Integration** | `dao_sunlogin.js` | Already registered in screen registry, needs probe polish |

### Cross-Pollination from ScreenStream

The `github项目同步/ScreenStream/` project (forked) contains production-grade:
- MJPEG state machine (`MjpegStateMachine.kt`)
- WebRTC client (`WebRtcClient.kt`)
- Network helper with PIN auth
- Settings migration framework

These Kotlin modules are the **Android-side complement** to dao-remote's Node.js hub.

---

## 4. Architecture Evolution Roadmap

```
Current (v8.1):
  dao.js ─┬─ Ghost Shell (Go) ──── GDI capture + SendInput
          ├─ PS Agent Relay (Py) ── PowerShell execution
          ├─ Hub (server.js) ────── HTTP/WS API + /sense PWA
          ├─ Rendezvous Beacon ──── UDP multicast 239.77.76.75
          ├─ mDNS ──────────────── .local resolution
          ├─ NAT ───────────────── UPnP/NAT-PMP auto-map
          └─ Tunnel ────────────── SSH/cloudflared/ngrok

Target (v9.0):
  dao.js ─┬─ Ghost Shell v2 (Go) ─ GDI + DXGI + WASAPI + VP9/AV1
          ├─ PS Agent Relay (Py) ── PowerShell + file transfer
          ├─ Hub (server.js) ────── HTTP/WS + WebRTC signaling
          │   ├─ /sense (PWA) ───── Remote desktop + audio + clipboard
          │   ├─ /files ─────────── File browser + transfer
          │   └─ /tools ─────────── Extensible tool registry
          ├─ Screen Registry ────── Android MJPEG/RTSP/WebRTC sources
          ├─ WebRTC Relay ───────── STUN/TURN for P2P upgrade
          ├─ Discovery (4-way) ──── mDNS + UDP + QR + tunnel
          ├─ NAT (3-protocol) ───── UPnP + NAT-PMP + PCP
          └─ Agent Service ──────── Windows service + Linux systemd
```

---

## 5. Immediate Next Actions (Prioritized)

### ✅ Completed (v8.2 → v8.5)

1. ~~**WebRTC signaling endpoint**~~ → `/ws/rtc` + `/dao/rtc` (v8.2)
2. ~~**Windows service wrapper**~~ → `dao.js --install` via `schtasks /SC ONLOGON` (v8.3), no NSSM dep
3. ~~**File transfer API**~~ → `/files` list + `/files/get` + `/files/put` (v8.2) + `/sense` 文件 tab (v8.3)
4. ~~**Clipboard sync**~~ → `/dao/clipboard` GET/POST (v8.2) + `/sense` 剪贴板 tab (v8.3)
5. ~~**Wake-on-LAN**~~ → `dao_wol.js` + `/dao/wol` + `/sense` 唤醒 tab, MAC harvested from Agent sysinfo (v8.3)
6. ~~**Android source registration**~~ → `DaoMdnsBrowser` class in `dao_mdns.js` browses `_screenstream._tcp.local` + `_dao._tcp.local`, auto-registers discovered peers into `_screenReg` (v8.4); exposed at `/dao/mdns` + `/dao/mdns/refresh`; Android MJPEG module ships `MjpegNsdAdvertiser.kt` for the reverse side (monorepo commit `74fddf75d`)
7. ~~**Session recording**~~ → `dao_recorder.js` (JPEG sampled @ fps, no external deps) + `/dao/record[/stop|/play|/thumb]` endpoints + `multipart/x-mixed-replace` playback (v8.5); deterministic `captureNow` for testability

### 🔜 Remaining

1. **AV1/VP9 encoder path** — Ghost Shell Go side: swap JPEG for libvpx/libaom; browser decodes via `VideoDecoder` API
2. **Audio capture wiring** — WASAPI stub → WebRTC audio track
3. **/sense UI for 录制** — GUI tab to start/stop/list/play recordings (server-side plumbing done)

---

## Sources
- RustDesk self-host docs: rustdesk.com/docs/en/self-host/
- MeshCentral Design Architecture: meshcentral.com/docs/MeshCentral2DesignArchitecture.pdf
- NAT traversal (STUN/TURN/ICE): nabto.com, pinggy.io
- QR Login security: USENIX Security 2025 (Zhang et al.)
- Remote desktop market: $3.9B (2025) → $14.73B (2034), 41.7% self-hosted
