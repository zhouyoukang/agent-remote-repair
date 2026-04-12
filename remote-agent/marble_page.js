// ═══════════════════════════════════════════════════════════════════════
// 道 · Marble 3D世界 — WorldLabs Gaussian Splatting Scene Viewer
// 整合一切: 从远程修复中枢进入三维世界, 道法自然
// ═══════════════════════════════════════════════════════════════════════
module.exports = function (PUBLIC_URL, TOKEN) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<title>道 · 3D世界 — WorldLabs Marble</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden;height:100vh;width:100vw}
#canvas-container{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0}
#canvas-container canvas{display:block;width:100%!important;height:100%!important}

/* ─── HUD ─── */
#hud{position:fixed;top:0;left:0;right:0;z-index:10;display:flex;align-items:center;padding:10px 16px;background:linear-gradient(180deg,rgba(0,0,0,0.7) 0%,transparent 100%);pointer-events:none}
#hud>*{pointer-events:auto}
.hud-back{background:rgba(255,255,255,0.12);border:none;color:#fff;font-size:14px;padding:6px 14px;border-radius:8px;cursor:pointer;backdrop-filter:blur(8px);transition:background 0.2s}
.hud-back:hover{background:rgba(255,255,255,0.25)}
.hud-title{flex:1;text-align:center;font-size:16px;font-weight:600;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.6)}
.hud-scene{font-size:13px;color:rgba(255,255,255,0.7);margin-right:8px}
.hud-quality{background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#fff;font-size:12px;padding:4px 10px;border-radius:6px;cursor:pointer;backdrop-filter:blur(4px)}
.hud-quality:hover{background:rgba(255,255,255,0.2)}

/* ─── Scene Gallery (bottom) ─── */
#gallery{position:fixed;bottom:0;left:0;right:0;z-index:10;padding:8px 12px 12px;background:linear-gradient(0deg,rgba(0,0,0,0.75) 0%,transparent 100%);display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
#gallery::-webkit-scrollbar{display:none}
.scene-card{flex:0 0 auto;width:100px;height:70px;border-radius:10px;overflow:hidden;cursor:pointer;border:2px solid transparent;transition:all 0.3s;position:relative;background:#111;opacity:0.7}
.scene-card:hover{opacity:1;transform:translateY(-2px)}
.scene-card.active{border-color:#00b4d8;opacity:1;box-shadow:0 0 12px rgba(0,180,216,0.4)}
.scene-card img{width:100%;height:100%;object-fit:cover}
.scene-card .label{position:absolute;bottom:0;left:0;right:0;font-size:10px;padding:2px 4px;background:rgba(0,0,0,0.7);text-align:center;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ─── Loading Overlay ─── */
#loading{position:fixed;top:0;left:0;width:100%;height:100%;z-index:20;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;transition:opacity 0.5s}
#loading.hidden{opacity:0;pointer-events:none}
.loading-spinner{width:48px;height:48px;border:3px solid rgba(255,255,255,0.15);border-top:3px solid #00b4d8;border-radius:50%;animation:spin 0.8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.loading-text{margin-top:16px;font-size:14px;color:rgba(255,255,255,0.7)}
.loading-progress{width:200px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;margin-top:10px;overflow:hidden}
.loading-bar{height:100%;background:linear-gradient(90deg,#00b4d8,#48cae4);width:0%;transition:width 0.3s}

/* ─── Info HUD (bottom-left) ─── */
#info-hud{position:fixed;bottom:90px;left:16px;z-index:10;font-size:11px;color:rgba(255,255,255,0.4);pointer-events:none;line-height:1.5}

/* ─── FPS Counter ─── */
#fps{position:fixed;top:48px;right:16px;z-index:10;font-size:11px;color:rgba(255,255,255,0.35);font-family:'Cascadia Code','Fira Code',monospace;pointer-events:none}

/* ─── Controls Hint ─── */
#controls-hint{position:fixed;bottom:90px;right:16px;z-index:10;font-size:11px;color:rgba(255,255,255,0.3);text-align:right;pointer-events:none;line-height:1.6;transition:opacity 0.5s}

/* ─── Help Overlay ─── */
#help{position:fixed;top:0;left:0;width:100%;height:100%;z-index:30;background:rgba(0,0,0,0.85);display:none;align-items:center;justify-content:center;backdrop-filter:blur(8px)}
#help.show{display:flex}
#help-box{background:#111828;border:1px solid #2a3050;border-radius:16px;padding:28px 36px;max-width:420px;width:90%}
#help-box h2{color:#7c8aff;font-size:18px;margin-bottom:16px;text-align:center}
.help-row{display:flex;justify-content:space-between;padding:5px 0;font-size:13px;border-bottom:1px solid #1a2040}
.help-row .k{color:#7c8aff;font-family:'Cascadia Code',monospace;font-size:12px}
.help-row .d{color:#889}
#help-close{margin-top:16px;width:100%;padding:10px;background:#7c8aff;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer}

/* ─── Fullscreen Button ─── */
.hud-fs{background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#fff;font-size:14px;padding:4px 8px;border-radius:6px;cursor:pointer;margin-left:6px;backdrop-filter:blur(4px)}
.hud-fs:hover{background:rgba(255,255,255,0.2)}

/* ─── Fade Overlay ─── */
#fade{position:fixed;top:0;left:0;width:100%;height:100%;z-index:5;background:#000;opacity:0;pointer-events:none;transition:opacity 0.4s}

/* ─── Create Panel ─── */
#create-panel{position:fixed;top:0;right:-380px;width:360px;height:100%;z-index:25;background:rgba(8,12,30,0.95);border-left:1px solid #1a2040;padding:20px;transition:right 0.3s;overflow-y:auto;backdrop-filter:blur(8px)}
#create-panel.open{right:0}
#create-panel h2{color:#7c8aff;font-size:16px;margin-bottom:14px}
#create-panel label{display:block;color:#889;font-size:12px;margin-bottom:4px;margin-top:12px}
#create-panel input,#create-panel textarea{width:100%;background:#0d1128;border:1px solid #1a2040;color:#e0e0e0;padding:8px 10px;border-radius:6px;font-size:13px}
#create-panel textarea{height:80px;resize:vertical}
#create-panel select{width:100%;background:#0d1128;border:1px solid #1a2040;color:#e0e0e0;padding:8px;border-radius:6px;font-size:13px}
.create-btn{width:100%;padding:10px;background:#7c8aff;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;margin-top:16px}
.create-btn:hover{background:#6a78ee}
.create-btn:disabled{opacity:0.5;cursor:not-allowed}
#create-status{margin-top:12px;font-size:12px;color:#7c8aff;min-height:20px}
#create-result{margin-top:12px}
.result-card{background:#0d1128;border:1px solid #1a2040;border-radius:8px;padding:10px;cursor:pointer}
.result-card:hover{border-color:#7c8aff}
.result-card img{width:100%;border-radius:4px;margin-bottom:6px}
.result-card .name{color:#e0e0e0;font-size:13px}
.hud-create{background:rgba(124,138,255,0.2);border:1px solid rgba(124,138,255,0.4);color:#7c8aff;font-size:12px;padding:4px 10px;border-radius:6px;cursor:pointer;margin-left:6px}
.hud-create:hover{background:rgba(124,138,255,0.3)}
#create-close{position:absolute;top:12px;right:12px;background:none;border:none;color:#889;font-size:18px;cursor:pointer}

/* ─── Mobile ─── */
@media(max-width:600px){
  .scene-card{width:80px;height:56px}
  .hud-title{font-size:14px}
  #controls-hint{display:none}
  #create-panel{width:100%}
}
</style>
</head>
<body>

<!-- Loading Overlay -->
<div id="loading">
  <div class="loading-spinner"></div>
  <div class="loading-text" id="loadText">初始化3D引擎...</div>
  <div class="loading-progress"><div class="loading-bar" id="loadBar"></div></div>
</div>

<!-- HUD -->
<div id="hud">
  <button class="hud-back" onclick="location.href='/${TOKEN ? "?token=" + TOKEN : ""}'">← 中枢</button>
  <span class="hud-scene" id="hudScene">选择场景</span>
  <div class="hud-title">道 · 3D世界</div>
  <button class="hud-quality" id="qualityBtn" onclick="cycleQuality()">低</button>
  <button class="hud-fs" onclick="toggleFS()" title="全屏 (F)">⛶</button>
  <button class="hud-create" onclick="toggleCreate()" title="创建世界">+ 创建</button>
</div>

<!-- FPS -->
<div id="fps"></div>

<!-- Controls Hint -->
<div id="controls-hint">WASD 移动 | 鼠标拖拽 旋转 | 滚轮 缩放<br>Space 上升 | Q/C 下降 | Shift 加速<br>← → 切换场景 | 1/2/3 画质 | F 全屏 | ? 帮助</div>

<!-- Help Overlay -->
<div id="help">
  <div id="help-box">
    <h2>操控指南</h2>
    <div class="help-row"><span class="k">W A S D</span><span class="d">前 左 后 右</span></div>
    <div class="help-row"><span class="k">Space / Q</span><span class="d">上升 / 下降</span></div>
    <div class="help-row"><span class="k">Shift</span><span class="d">加速移动</span></div>
    <div class="help-row"><span class="k">鼠标左键拖拽</span><span class="d">旋转视角</span></div>
    <div class="help-row"><span class="k">滚轮</span><span class="d">缩放</span></div>
    <div class="help-row"><span class="k">← →</span><span class="d">上/下个场景</span></div>
    <div class="help-row"><span class="k">F</span><span class="d">全屏切换</span></div>
    <div class="help-row"><span class="k">1 2 3</span><span class="d">低/中/高画质</span></div>
    <div class="help-row"><span class="k">R</span><span class="d">重置视角</span></div>
    <div class="help-row"><span class="k">?</span><span class="d">显示/隐藏帮助</span></div>
    <div class="help-row"><span class="k">Esc</span><span class="d">关闭面板</span></div>
    <button id="help-close" onclick="toggleHelp()">关闭</button>
  </div>
</div>

<!-- Create Panel -->
<div id="create-panel">
  <button id="create-close" onclick="toggleCreate()">✕</button>
  <h2>创建3D世界</h2>
  <label>文本描述</label>
  <textarea id="create-prompt" placeholder="描述你想创建的3D世界, 例如: 云端仙境, 飘浮的宫殿群..."></textarea>
  <label>模型</label>
  <select id="create-model">
    <option value="marble-1.0">Marble 1.0 (标准)</option>
    <option value="marble-1.0-mini">Marble 1.0 Mini (快速)</option>
  </select>
  <label><input type="checkbox" id="create-enhance" checked> 自动增强提示词</label>
  <button class="create-btn" id="createBtn" onclick="generateWorld()">生成世界</button>
  <div id="create-status"></div>
  <div id="create-result"></div>
  <div style="margin-top:20px;padding-top:12px;border-top:1px solid #1a2040">
    <div style="color:#556;font-size:11px">需要设置环境变量 WLT_API_KEY<br>获取API Key: <a href="https://platform.worldlabs.ai/api-keys" target="_blank" style="color:#7c8aff">platform.worldlabs.ai</a></div>
  </div>
</div>

<!-- Fade -->
<div id="fade"></div>

<!-- 3D Canvas -->
<div id="canvas-container"></div>

<!-- Scene Gallery -->
<div id="gallery"></div>

<!-- Info -->
<div id="info-hud"></div>

<script type="importmap">
{
  "imports": {
    "three": "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.178.0/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.178.0/examples/jsm/",
    "@sparkjsdev/spark": "https://sparkjs.dev/releases/spark/0.1.10/spark.module.js"
  }
}
</script>

<script type="module">
import * as THREE from 'three';
// 道·万法归宗: SparkControls = FpsMovement + PointerControls (WASD + mouse + touch + gamepad)
// SplatLoader gives real download progress; SplatMesh + SparkRenderer for rendering
// OrbitControls kept as fallback if SparkControls unavailable

// ═══════ 道 · 场景数据 — 万物皆备于我 ═══════
const SCENES = [
  {id:"660f680d-c31f-4463-8285-b61ad406739e",name:"Floating Asian Palace Complex",scale:9.168,ground_offset:15.512,
    thumbnail:"https://cdn.marble.worldlabs.ai/660f680d-c31f-4463-8285-b61ad406739e/9b25dd11_image_prompt_sanitized.png",
    spz:{low:"https://cdn.marble.worldlabs.ai/660f680d-c31f-4463-8285-b61ad406739e/41a57d07-6ace-4f65-8a7e-5e9289db6b92_dust_100k.spz",
      medium:"https://cdn.marble.worldlabs.ai/660f680d-c31f-4463-8285-b61ad406739e/53fc72c4-4ac6-448e-80f0-57ac4a751e9b_ceramic_500k.spz",
      high:"https://cdn.marble.worldlabs.ai/660f680d-c31f-4463-8285-b61ad406739e/fb7c8a27-e224-40e6-8863-4f5acb78c68c_ceramic.spz"}},
  {id:"b0029c5e-e7c4-49ee-9649-561f84402f18",name:"Ancient Sentinels Guard River Passage",scale:0.808,ground_offset:0.821,
    thumbnail:"https://cdn.marble.worldlabs.ai/b0029c5e-e7c4-49ee-9649-561f84402f18/281425bb_image_prompt_sanitized.png",
    spz:{low:"https://cdn.marble.worldlabs.ai/b0029c5e-e7c4-49ee-9649-561f84402f18/79f7f553-5c53-4f28-819d-ef319826024a_dust_100k.spz",
      medium:"https://cdn.marble.worldlabs.ai/b0029c5e-e7c4-49ee-9649-561f84402f18/9d2b50b7-209b-424d-b5fb-3a5817da25c1_ceramic_500k.spz",
      high:"https://cdn.marble.worldlabs.ai/b0029c5e-e7c4-49ee-9649-561f84402f18/c83e489d-69b0-48cd-9db5-8f829ff7cfdf_ceramic.spz"}},
  {id:"dc15921b-3a10-4be3-b325-fba5c308560b",name:"Winter Mountain Lake Sunset",scale:1.376,ground_offset:0.906,
    thumbnail:"https://cdn.marble.worldlabs.ai/dc15921b-3a10-4be3-b325-fba5c308560b/89c56884_image_prompt_sanitized.png",
    spz:{low:"https://cdn.marble.worldlabs.ai/dc15921b-3a10-4be3-b325-fba5c308560b/9b3c619f-2219-40cd-b4ad-ec9758e44248_dust_100k.spz",
      medium:"https://cdn.marble.worldlabs.ai/dc15921b-3a10-4be3-b325-fba5c308560b/33bcaa92-9c83-4546-a428-9272bfe11ffb_ceramic_500k.spz",
      high:"https://cdn.marble.worldlabs.ai/dc15921b-3a10-4be3-b325-fba5c308560b/3799b970-5685-4902-89df-d2719e3fe58a_ceramic.spz"}},
  {id:"91f34581-0c18-491c-bd2b-9b5078e73df6",name:"Celestial Garden of Golden Fruit",scale:1.019,ground_offset:0.911,
    thumbnail:"https://cdn.marble.worldlabs.ai/91f34581-0c18-491c-bd2b-9b5078e73df6/5a4cedb5_image_prompt_sanitized.png",
    spz:{low:"https://cdn.marble.worldlabs.ai/91f34581-0c18-491c-bd2b-9b5078e73df6/18ee3c99-68c3-49e3-bec7-fa951200f988_dust_100k.spz",
      medium:"https://cdn.marble.worldlabs.ai/91f34581-0c18-491c-bd2b-9b5078e73df6/4d922c02-df97-4b31-a316-03cb0d7bb786_ceramic_500k.spz",
      high:"https://cdn.marble.worldlabs.ai/91f34581-0c18-491c-bd2b-9b5078e73df6/a72ba416-a4c5-4dee-aabd-f47892231bbd_ceramic.spz"}},
  {id:"234ae08a-7dee-491b-86f3-f9014113c2f2",name:"Mountain Valley Flower Meadow",scale:1.072,ground_offset:0.686,
    thumbnail:"https://cdn.marble.worldlabs.ai/234ae08a-7dee-491b-86f3-f9014113c2f2/eab03ca2_image_prompt_sanitized.png",
    spz:{low:"https://cdn.marble.worldlabs.ai/234ae08a-7dee-491b-86f3-f9014113c2f2/06193630-02bd-4583-943a-3ffbf1d0e256_dust_100k.spz",
      medium:"https://cdn.marble.worldlabs.ai/234ae08a-7dee-491b-86f3-f9014113c2f2/f3569ed7-f3d9-433e-8c3d-f14f4112e8f4_ceramic_500k.spz",
      high:"https://cdn.marble.worldlabs.ai/234ae08a-7dee-491b-86f3-f9014113c2f2/08f6044f-02b8-4946-a352-ab7f9ddeb9f7_ceramic.spz"}},
  {id:"97583c3d-19d6-4246-86ed-a8d4c9201eab",name:"Golden Record Temple at Sunset",scale:0.574,ground_offset:0.345,
    thumbnail:"https://cdn.marble.worldlabs.ai/97583c3d-19d6-4246-86ed-a8d4c9201eab/7db778cf_image_prompt_sanitized.png",
    spz:{low:"https://cdn.marble.worldlabs.ai/97583c3d-19d6-4246-86ed-a8d4c9201eab/30e5de8e-fc0f-4028-b513-cf91a42f4cef_dust_100k.spz",
      medium:"https://cdn.marble.worldlabs.ai/97583c3d-19d6-4246-86ed-a8d4c9201eab/63d5932b-3296-47e9-88b1-f04e2e30b53f_ceramic_500k.spz",
      high:"https://cdn.marble.worldlabs.ai/97583c3d-19d6-4246-86ed-a8d4c9201eab/6f1e41e1-8323-41e1-9d97-8e6fe5a5c683_ceramic.spz"}},
  {id:"3883f06a-ccdb-439a-bef7-ce452d69bad3",name:"Enchanted Wisteria Pathway",scale:1.0,ground_offset:0,
    thumbnail:"https://cdn.marble.worldlabs.ai/3883f06a-ccdb-439a-bef7-ce452d69bad3/4bb6f947_image_prompt_sanitized.png",
    spz:{low:"https://cdn.marble.worldlabs.ai/3883f06a-ccdb-439a-bef7-ce452d69bad3/c9136f39-6ef4-4fd9-97ea-47c2f8fae2c6_dust_100k.spz",
      high:"https://cdn.marble.worldlabs.ai/3883f06a-ccdb-439a-bef7-ce452d69bad3/c8942023-2d6f-407f-8f96-c793faa1074a_ceramic.spz"}},
  {id:"a6561515-cbb0-4a2d-84a1-d0f4e63e027c",name:"Cozy Dragon Hearthside Retreat",scale:1.259,ground_offset:1.223,
    thumbnail:"https://cdn.marble.worldlabs.ai/a6561515-cbb0-4a2d-84a1-d0f4e63e027c/ad9faba0_image_prompt_sanitized.png",
    spz:{low:"https://cdn.marble.worldlabs.ai/a6561515-cbb0-4a2d-84a1-d0f4e63e027c/2a9be8ed-6e83-4410-ac13-4d0e6345cb1e_dust_100k.spz",
      medium:"https://cdn.marble.worldlabs.ai/a6561515-cbb0-4a2d-84a1-d0f4e63e027c/5e6bbeea-885b-400b-b763-66bc541981ef_ceramic_500k.spz",
      high:"https://cdn.marble.worldlabs.ai/a6561515-cbb0-4a2d-84a1-d0f4e63e027c/ef7dad74-f248-4cb0-8e57-89fa6d5c5ec3_ceramic.spz"}},
  {id:"9b66855a-e073-4249-825c-a3d065f8b35b",name:"Hidden Temple Gate at Night",scale:1.387,ground_offset:0.894,
    thumbnail:"https://cdn.marble.worldlabs.ai/9b66855a-e073-4249-825c-a3d065f8b35b/75efd212_image_prompt_sanitized.png",
    spz:{low:"https://cdn.marble.worldlabs.ai/9b66855a-e073-4249-825c-a3d065f8b35b/df22b916-0a6e-43e4-832c-8d28fbd71c72_dust_100k.spz",
      medium:"https://cdn.marble.worldlabs.ai/9b66855a-e073-4249-825c-a3d065f8b35b/a8913a26-864d-4c4d-ac4e-7dffb4b06c2d_ceramic_500k.spz",
      high:"https://cdn.marble.worldlabs.ai/9b66855a-e073-4249-825c-a3d065f8b35b/0c534cc7-8dc9-4656-8362-3ef3b4bc2591_ceramic.spz"}},
];

const SCENE_CN = {
  "660f680d-c31f-4463-8285-b61ad406739e":"\\u{1F3EF} 浮空宫殿",
  "b0029c5e-e7c4-49ee-9649-561f84402f18":"\\u{1F5FF} 巨石河道",
  "dc15921b-3a10-4be3-b325-fba5c308560b":"\\u2744\\uFE0F 雪山落日",
  "91f34581-0c18-491c-bd2b-9b5078e73df6":"\\u{1F34A} 天界果园",
  "234ae08a-7dee-491b-86f3-f9014113c2f2":"\\u{1F33A} 山谷花海",
  "97583c3d-19d6-4246-86ed-a8d4c9201eab":"\\u{1F305} 金殿夕照",
  "3883f06a-ccdb-439a-bef7-ce452d69bad3":"\\u{1F338} 紫藤仙径",
  "a6561515-cbb0-4a2d-84a1-d0f4e63e027c":"\\u{1F409} 龙巢壁炉",
  "9b66855a-e073-4249-825c-a3d065f8b35b":"\\u{1F319} 暗夜神殿"
};

// 道·境: Per-scene atmosphere — 万物各得其所
const SCENE_ATMOSPHERE = {
  "660f680d-c31f-4463-8285-b61ad406739e":{bg:"#8899bb",fog:"#8899bb",light:1.3,fogNear:200,fogFar:1500},
  "b0029c5e-e7c4-49ee-9649-561f84402f18":{bg:"#3a4a5a",fog:"#3a4a5a",light:1.0,fogNear:30,fogFar:200},
  "dc15921b-3a10-4be3-b325-fba5c308560b":{bg:"#8899aa",fog:"#99aabb",light:1.6,fogNear:50,fogFar:300},
  "91f34581-0c18-491c-bd2b-9b5078e73df6":{bg:"#6699aa",fog:"#6699aa",light:1.5,fogNear:40,fogFar:250},
  "234ae08a-7dee-491b-86f3-f9014113c2f2":{bg:"#7a9a7a",fog:"#7a9a7a",light:1.4,fogNear:40,fogFar:280},
  "97583c3d-19d6-4246-86ed-a8d4c9201eab":{bg:"#cc8844",fog:"#aa6633",light:2.0,fogNear:20,fogFar:150},
  "3883f06a-ccdb-439a-bef7-ce452d69bad3":{bg:"#8866aa",fog:"#8866aa",light:1.2,fogNear:25,fogFar:180},
  "a6561515-cbb0-4a2d-84a1-d0f4e63e027c":{bg:"#1a1208",fog:"#1a1208",light:0.7,fogNear:10,fogFar:100},
  "9b66855a-e073-4249-825c-a3d065f8b35b":{bg:"#080816",fog:"#080816",light:0.5,fogNear:15,fogFar:150}
};

// ═══════ 道 · 引擎 — 三生万物 ═══════
let renderer, scene, camera, controls, spark;
let currentSplat = null;
let currentWorldId = null;
let quality = 'low';
const qualityLabels = {low:'低',medium:'中',high:'高'};
let SplatMesh = null, SparkRendererClass = null, SplatLoader = null, SparkControlsClass = null;
let useSparkControls = false;

// FPS
let fpsFrames = 0, fpsLast = performance.now(), fpsCurrent = 0;
let lastTime = 0;

function setLoading(show, text, progress) {
  const el = document.getElementById('loading');
  if (text) document.getElementById('loadText').textContent = text;
  if (progress != null) document.getElementById('loadBar').style.width = progress + '%';
  if (show) el.classList.remove('hidden');
  else el.classList.add('hidden');
}

// 道·初: THREE.js core setup
function initEngine() {
  // antialias: false — SparkJS official recommendation for splat rendering
  renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#050a1e');
  scene.fog = new THREE.Fog('#050a1e', 80, 500);

  camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.01, 2000);
  camera.position.set(0, 0, 0);
  camera.quaternion.set(0, 0, 0, 1);
  scene.add(camera);

  // Lighting — 道·明
  const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
  mainLight.position.set(5, 10, 5);
  scene.add(mainLight);
  scene.add(new THREE.AmbientLight(0x404060, 0.5));
  scene.add(new THREE.HemisphereLight(0x4488ff, 0x224400, 0.4));
  scene._mainLight = mainLight;

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ── Keyboard (scene cycling, quality, fullscreen, help, reset) ──
  document.addEventListener('keydown', (e) => {
    // Scene cycling: arrow left/right
    if (e.code === 'ArrowLeft') { cycleScene(-1); e.preventDefault(); }
    if (e.code === 'ArrowRight') { cycleScene(1); e.preventDefault(); }
    // Quality: 1/2/3
    if (e.code === 'Digit1') setQuality('low');
    if (e.code === 'Digit2') setQuality('medium');
    if (e.code === 'Digit3') setQuality('high');
    // Fullscreen
    if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) toggleFS();
    // Help
    if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) toggleHelp();
    // Reset view
    if (e.code === 'KeyR' && !e.ctrlKey) resetView();
    // Escape: close help / create panel
    if (e.code === 'Escape') {
      const help = document.getElementById('help');
      if (help.classList.contains('show')) { help.classList.remove('show'); e.preventDefault(); return; }
      const cp = document.getElementById('create-panel');
      if (cp.classList.contains('open')) { cp.classList.remove('open'); e.preventDefault(); return; }
    }
  });
}

// 道·载: Load SparkJS — 万法之资,探囊取物
async function loadSparkJS() {
  try {
    const sparkMod = await import('@sparkjsdev/spark');
    SplatMesh = sparkMod.SplatMesh;
    SparkRendererClass = sparkMod.SparkRenderer;
    SplatLoader = sparkMod.SplatLoader || null;
    SparkControlsClass = sparkMod.SparkControls || null;

    // SparkRenderer: sort32 for quality, add to camera for large-scene float16 precision
    spark = new SparkRendererClass({ renderer, view: { sort32: true }, maxStdDev: Math.sqrt(5) });
    camera.add(spark);

    // SparkControls: WASD + mouse + touch + gamepad — 官方Marble操控方案
    if (SparkControlsClass) {
      controls = new SparkControlsClass({ canvas: renderer.domElement });
      useSparkControls = true;
      console.log('SparkControls active (WASD + mouse + touch + gamepad)');
    } else {
      // Fallback: OrbitControls
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.25;
      console.log('OrbitControls fallback');
    }

    console.log('SparkJS loaded: SplatLoader=' + !!SplatLoader + ' SparkControls=' + !!SparkControlsClass);
    return true;
  } catch (e) {
    console.error('SparkJS load failed:', e);
    // Full fallback: OrbitControls only
    try {
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.25;
    } catch (e2) { console.error('OrbitControls also failed:', e2); }
    return false;
  }
}

// ═══════ 道·归位: Load World — 万物各归其位 ═══════
async function loadWorld(worldId, q) {
  const world = SCENES.find(s => s.id === worldId);
  if (!world) { console.error('Scene not found:', worldId); return; }

  setLoading(true, '加载 ' + (SCENE_CN[worldId] || world.name) + '...', 10);

  // Remove previous splat
  if (currentSplat) {
    scene.remove(currentSplat);
    if (currentSplat.dispose) currentSplat.dispose();
    currentSplat = null;
  }
  // Clean up texture backgrounds
  if (scene.background && scene.background.isTexture) {
    scene.background.dispose();
    scene.background = null;
  }

  // Quality fallback chain
  q = q || quality;
  let spzUrl = world.spz[q];
  if (!spzUrl && q !== 'low') { spzUrl = world.spz.low; q = 'low'; }
  if (!spzUrl && q !== 'high') { spzUrl = world.spz.high; q = 'high'; }
  if (!spzUrl) { setLoading(false); console.error('No SPZ URL'); return; }

  setLoading(true, '下载Gaussian Splat...', 15);
  console.log('SPZ CDN:', spzUrl.substring(0, 80));

  if (SplatMesh) {
    try {
      let splat;

      // 道·万法之资: SplatLoader with real progress (official Marble pattern)
      if (SplatLoader) {
        const loader = new SplatLoader();
        const packedSplats = await loader.loadAsync(spzUrl, (evt) => {
          if (evt.total > 0) {
            const pct = Math.min(95, 15 + Math.round(80 * evt.loaded / evt.total));
            setLoading(true, '下载 ' + Math.round(evt.loaded / 1024) + 'KB / ' + Math.round(evt.total / 1024) + 'KB', pct);
          }
        });
        splat = new SplatMesh({ packedSplats });
      } else {
        // Fallback: direct SplatMesh URL loading (no progress)
        setLoading(true, '加载Gaussian Splat...', 50);
        splat = new SplatMesh({ url: spzUrl });
      }

      // 道·正位: OpenCV→OpenGL coordinate flip (官方Marble翻转)
      // WorldLabs SPZ is in OpenCV coords (+x left, +y down, +z forward)
      // THREE.js is OpenGL coords — rotate 180° around X axis
      splat.quaternion.set(1, 0, 0, 0);

      scene.add(splat);
      currentSplat = splat;
      currentWorldId = worldId;

      setLoading(true, '场景就绪!', 98);

      // 道·归位: Camera at origin (official Marble pattern)
      // SparkControls handles camera movement from origin
      camera.position.set(0, 0, 0);
      camera.quaternion.set(0, 0, 0, 1);
      camera.fov = 65;
      camera.near = 0.01;
      camera.far = 2000;
      camera.updateProjectionMatrix();

      console.log('道·归位: origin start, scale=' + (world.scale || 1).toFixed(2) +
        ' q=' + q + ' SplatLoader=' + !!SplatLoader);

      // 道·境: Scene-adaptive atmosphere
      const atmo = SCENE_ATMOSPHERE[worldId];
      if (atmo) {
        scene.background = new THREE.Color(atmo.bg);
        scene.fog = new THREE.Fog(atmo.fog, atmo.fogNear || 60, atmo.fogFar || 400);
        scene._mainLight.intensity = atmo.light || 1.2;
      } else {
        scene.background = new THREE.Color('#050a1e');
        scene.fog.near = 80;
        scene.fog.far = 500;
      }

      setTimeout(() => { setLoading(true, null, 100); setTimeout(() => setLoading(false), 300); }, 500);
      console.log('World loaded: ' + world.name + ' (' + q + ')');
    } catch (e) {
      console.warn('SplatMesh failed:', e);
      await loadFallbackPanorama(world);
    }
  } else {
    await loadFallbackPanorama(world);
  }

  // Update UI
  document.getElementById('hudScene').textContent = SCENE_CN[worldId] || world.name;
  updateGalleryActive(worldId);
  updateInfoHud(world, q);
}

async function loadFallbackPanorama(world) {
  if (!world.thumbnail) { setLoading(false); return; }
  setLoading(true, '降级: 加载全景图...', 60);
  try {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const tex = await new Promise((resolve, reject) => {
      loader.load(world.thumbnail, resolve, undefined, reject);
    });
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = tex;
    scene.environment = tex;
    currentWorldId = world.id;
    document.getElementById('hudScene').textContent = SCENE_CN[world.id] || world.name;
    updateGalleryActive(world.id);
    setTimeout(() => setLoading(false), 300);
  } catch (e) {
    console.error('Fallback panorama failed:', e);
    setLoading(false);
  }
}

function updateInfoHud(world, q) {
  const el = document.getElementById('info-hud');
  if (!el) return;
  el.innerHTML = 'Scale: ' + (world.scale || 1).toFixed(3) +
    ' | Offset: ' + (world.ground_offset || 0).toFixed(3) +
    ' | Quality: ' + (q || quality) +
    '<br>WorldLabs Marble 3DGS';
}

// ═══════ Gallery ═══════
function buildGallery() {
  const gallery = document.getElementById('gallery');
  gallery.innerHTML = '';
  SCENES.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'scene-card' + (i === 0 ? ' active' : '');
    card.dataset.id = s.id;
    card.innerHTML = (s.thumbnail
      ? '<img src="' + s.thumbnail + '" alt="' + s.name + '" loading="lazy">'
      : '<div style="background:#1a1a2e;height:100%;display:flex;align-items:center;justify-content:center">\\u{1F30D}</div>') +
      '<div class="label">' + (SCENE_CN[s.id] || s.name) + '</div>';
    card.onclick = () => loadWorld(s.id, quality);
    gallery.appendChild(card);
  });
}

function updateGalleryActive(worldId) {
  document.querySelectorAll('.scene-card').forEach(c => {
    const isActive = c.dataset.id === worldId;
    c.classList.toggle('active', isActive);
    if (isActive) c.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  });
}

// ═══════ Quality — 两者相观而上善 ═══════
function setQuality(q) {
  quality = q;
  document.getElementById('qualityBtn').textContent = qualityLabels[quality] || quality;
  if (currentWorldId) loadWorld(currentWorldId, quality);
}

window.cycleQuality = function() {
  const order = ['low','medium','high'];
  const idx = order.indexOf(quality);
  setQuality(order[(idx + 1) % order.length]);
};

// ═══════ Scene Cycling — 相辅相成 ═══════
function cycleScene(dir) {
  if (!currentWorldId) return;
  const idx = SCENES.findIndex(s => s.id === currentWorldId);
  const next = (idx + dir + SCENES.length) % SCENES.length;
  // Fade transition
  const fade = document.getElementById('fade');
  fade.style.opacity = '1';
  setTimeout(() => {
    loadWorld(SCENES[next].id, quality);
    setTimeout(() => { fade.style.opacity = '0'; }, 200);
  }, 400);
}

// ═══════ Fullscreen ═══════
window.toggleFS = function() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  else document.exitFullscreen().catch(() => {});
};

// ═══════ Help ═══════
window.toggleHelp = function() {
  document.getElementById('help').classList.toggle('show');
};

// ═══════ Reset View — 复归于朴 ═══════
function resetView() {
  camera.position.set(0, 0, 0);
  camera.quaternion.set(0, 0, 0, 1);
  if (!useSparkControls && controls && controls.target) {
    controls.target.set(0, 0, -2);
    controls.autoRotate = true;
    controls.update();
  }
}

// ═══════ Render Loop — 道·动 (official Marble pattern) ═══════
function animate(time) {
  requestAnimationFrame(animate);

  // SparkControls: update(camera) — handles WASD + mouse + touch + gamepad
  if (useSparkControls && controls) {
    controls.update(camera);
  } else if (controls && controls.update) {
    controls.update();
  }

  // Render
  renderer.render(scene, camera);

  // FPS counter
  fpsFrames++;
  if (time - fpsLast > 500) {
    fpsCurrent = Math.round(fpsFrames / ((time - fpsLast) / 1000));
    fpsFrames = 0;
    fpsLast = time;
    const el = document.getElementById('fps');
    if (el) el.textContent = fpsCurrent + ' FPS';
  }
}

// ═══════ Init — 道生一 ═══════
async function init() {
  setLoading(true, '初始化3D引擎...', 5);
  initEngine();
  setLoading(true, '加载SparkJS...', 20);
  const ok = await loadSparkJS();
  if (!ok) console.warn('SparkJS unavailable — fallback rendering');

  buildGallery();
  setLoading(true, '加载首个场景...', 40);
  animate(performance.now());

  // Hide controls hint after 8s
  setTimeout(() => {
    const hint = document.getElementById('controls-hint');
    if (hint) hint.style.opacity = '0';
  }, 8000);

  // 道法自然: Auto-load first scene
  await loadWorld(SCENES[0].id, quality);
}

// ═══════ Create Panel — 道·创 (World API Integration) ═══════
window.toggleCreate = function() {
  document.getElementById('create-panel').classList.toggle('open');
};

const API_BASE = location.origin + '/marble/api/';

async function apiFetch(path, opts) {
  const tokenParam = '${TOKEN ? TOKEN : ""}';
  const sep = path.includes('?') ? '&' : '?';
  const url = API_BASE + path + (tokenParam ? sep + 'token=' + tokenParam : '');
  const r = await fetch(url, opts);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}

window.generateWorld = async function() {
  const prompt = document.getElementById('create-prompt').value.trim();
  if (!prompt) { alert('请输入文本描述'); return; }
  const model = document.getElementById('create-model').value;
  const enhance = document.getElementById('create-enhance').checked;
  const btn = document.getElementById('createBtn');
  const status = document.getElementById('create-status');
  const result = document.getElementById('create-result');

  btn.disabled = true;
  btn.textContent = '生成中...';
  status.textContent = '提交生成请求...';
  result.innerHTML = '';

  try {
    // Generate
    const op = await apiFetch('worlds:generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: prompt.substring(0, 50),
        model: model,
        world_prompt: { type: 'text', text_prompt: prompt, disable_recaption: !enhance }
      })
    });
    const opId = op.operation_id;
    status.textContent = '生成中... (operation: ' + opId.substring(0, 8) + ')';

    // Poll
    let done = false;
    let world = null;
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const check = await apiFetch('operations/' + opId);
      if (check.metadata && check.metadata.progress) {
        status.textContent = '状态: ' + (check.metadata.progress.description || check.metadata.progress.status);
      }
      if (check.done) {
        world = check.response;
        done = true;
        break;
      }
    }

    if (!done) { status.textContent = '超时 — 请稍后重试'; return; }

    status.textContent = '世界已生成!';

    // Get full world details
    const worldId = world.world_id || world.id;
    const detail = await apiFetch('worlds/' + worldId);
    const w = detail.world || detail;
    const assets = w.assets || {};
    const spzUrls = assets.splats ? assets.splats.spz_urls : {};

    // Show result card
    result.innerHTML = '<div class="result-card" id="gen-result">' +
      (assets.thumbnail_url ? '<img src="' + assets.thumbnail_url + '">' : '') +
      '<div class="name">' + (w.display_name || prompt.substring(0, 30)) + '</div>' +
      '<div style="color:#556;font-size:11px;margin-top:4px">' + (assets.caption || '').substring(0, 100) + '</div>' +
      '</div>';

    // Click to load the generated world
    if (spzUrls['100k'] || spzUrls['500k'] || spzUrls['full_res']) {
      document.getElementById('gen-result').onclick = function() {
        // Dynamically add to SCENES and load
        const newScene = {
          id: worldId,
          name: w.display_name || prompt.substring(0, 30),
          scale: 1.0,
          ground_offset: 0,
          thumbnail: assets.thumbnail_url || '',
          spz: {
            low: spzUrls['100k'] || '',
            medium: spzUrls['500k'] || '',
            high: spzUrls['full_res'] || ''
          }
        };
        SCENES.push(newScene);
        SCENE_CN[worldId] = w.display_name || prompt.substring(0, 30);
        buildGallery();
        loadWorld(worldId, quality);
        toggleCreate();
        status.textContent = '已加载到查看器';
      };
    }

  } catch (e) {
    status.textContent = '错误: ' + e.message;
    console.error('Generation failed:', e);
  } finally {
    btn.disabled = false;
    btn.textContent = '生成世界';
  }
};

init().catch(e => {
  console.error('Init failed:', e);
  setLoading(true, '初始化失败: ' + e.message, 0);
});
</script>
</body>
</html>`;
};
