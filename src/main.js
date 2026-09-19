import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MaterialFoundry } from './engine/MaterialFoundry.js';
import { LightingRig } from './engine/LightingRig.js';
import { WorldCompiler } from './engine/WorldCompiler.js';
import { buildForgeHeroTrio } from './foundry/ForgeBuilder.js';
import { buildMedievalTavern } from './foundry/TavernBuilder.js';
import {
  ManifestForgeTrio,
  ManifestMedievalTavern,
  ManifestAlchemistLab,
  ManifestDungeonArmory,
  ManifestHermitLibrary,
  ManifestTokyoNintendoOffice,
  ManifestWinterholdCollege
} from './presets/manifests.js';
import { RivaTunerOSD } from './engine/RivaTunerOSD.js';
import { ArtisanProfiler } from './engine/ArtisanProfiler.js';

/* ==========================================================================
   ARTISAN 3D STUDIO — PRODUCTION ENGINE RUNTIME (COMPASS V2)
   ========================================================================== */

let scene, camera, renderer, controls;
let materials, lighting, compiler, rtss, profiler;
let currentScene = 'winterhold';
let currentLightingPreset = 'dusk';
let isWireframe = false;
let activeWorldGroup = null;
let shadowBakeFrames = 4;
let sceneWarmupFrames = 90; // Suppress false-positive panic drops during shader compilation hitch
let dprPreset = 'balanced'; // 'auto' | 'perf' | 'balanced' | 'ultra' (defaults to 1.0x native crispness)
let lastDPRAdjustment = 0;
let isSoftwareRasterizer = false;
let lastForwardRenderMs = 0; // Tracks actual GPU forward render pass duration

export function requestShadowBake(frames = 3) {
  shadowBakeFrames = Math.max(shadowBakeFrames, frames);
}

// Telemetry state
let lastTime = performance.now();
let frames = 0;
let fps = 60;

function init() {
  const container = document.getElementById('viewport-container');
  const canvas = document.getElementById('webgl');

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1c2128);

  // Camera
  camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 2.4, 4.6);

  // Renderer with High-Visibility Tone Mapping
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

  // Detect Software Rasterizer (WARP / Microsoft Basic Render Driver fallback)
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const unmasked = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '';
      if (/Basic Render Driver|Software|WARP|SwiftShader/i.test(unmasked)) {
        isSoftwareRasterizer = true;
      }
    }
  } catch (e) {}

  // Safe DPR initialization: 0.75x for software fallback, 1.0x native for hardware GPU
  const initialDpr = isSoftwareRasterizer ? 0.75 : 1.0;
  renderer.setPixelRatio(initialDpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // Hardware-accelerated PCF depth comparison
  renderer.shadowMap.autoUpdate = false; // Static shadow map caching (eliminates hundreds of redundant depth passes)
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02; // Fine-tuned natural exposure with rich blacks and crisp specular pop

  // Display Software Rasterizer Warning Banner if active
  if (isSoftwareRasterizer) {
    const banner = document.createElement('div');
    banner.id = 'software-rasterizer-banner';
    banner.style.cssText = 'position:fixed;top:54px;left:50%;transform:translateX(-50%);z-index:9998;background:rgba(220,38,38,0.92);color:#fff;padding:8px 18px;border-radius:8px;font-size:12px;font-family:sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.6);display:flex;align-items:center;gap:12px;border:1px solid rgba(255,255,255,0.2);';
    banner.innerHTML = '<span>⚠️ <b>CPU Software Rasterizer Active (Microsoft Basic Render Driver)</b> — Chrome WebGL hardware acceleration crashed or is disabled. Restart Chrome or re-enable "Use graphics acceleration when available" in <code>chrome://settings/system</code> to restore 60 FPS Intel UHD performance.</span><button onclick="this.parentElement.remove()" style="background:rgba(255,255,255,0.25);border:none;color:#fff;padding:2px 8px;border-radius:4px;cursor:pointer;font-weight:bold;">✕</button>';
    document.body.appendChild(banner);
  }

  // Procedural Studio Environment Map (Continuous 360° PBR ambient reflections & irradiance)
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
  const roomEnv = new RoomEnvironment();
  scene.environment = pmremGenerator.fromScene(roomEnv, 0.04).texture;

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0.7, 0);
  controls.maxPolarAngle = Math.PI / 2 + 0.02;
  // NOTE: Static shadow map caching is preserved during camera orbit.
  // View-matrix changes do NOT invalidate world-space shadow depth frustums.

  // Material Foundry & Lighting & Compiler
  materials = new MaterialFoundry();
  lighting = new LightingRig(scene);
  compiler = new WorldCompiler(materials);

  // Setup DOM Event Listeners
  setupEventListeners();

  // Load initial scene
  loadScene('tokyo');

  // Check URL query parameters for angle preset
  const urlParams = new URLSearchParams(window.location.search);
  const requestedAngle = urlParams.get('angle');
  if (requestedAngle) {
    setTimeout(() => setCameraAngle(requestedAngle), 50);
  }

  window.setCameraAngle = setCameraAngle;

  // Initialize RivaTuner / RTSS Hardware OSD
  rtss = new RivaTunerOSD(renderer, scene, camera);

  // Initialize Artisan Profiler (Mainframe Sysmon / Zero-Trust Diagnostic Engine)
  profiler = new ArtisanProfiler(renderer, scene, camera, controls, lighting);
  profiler.bindUI();

  window.__artisan = { 
    setCameraAngle, 
    loadScene, 
    renderer, 
    scene, 
    camera, 
    controls, 
    rtss, 
    profiler, 
    activeWorldGroup,
    applyDPRPreset,
    toggleDPR
  };

  // Populate LLM prompt template
  setupLLMPromptBox();

  // Initialize DPR button UI
  updateDPRButtonUI();

  // Window resize handler
  window.addEventListener('resize', onWindowResize);

  // MCP WebSocket Bridge — receives live scenes from the Artisan 3D MCP Server
  setupMCPBridge();

  // Start render loop
  requestAnimationFrame(renderLoop);
}

export function setCameraAngle(angle) {
  if (!camera || !controls) return;
  if (angle === 'hero') {
    camera.position.set(3.4, 2.6, 3.6);
    controls.target.set(0, 1.2, 0);
  } else if (angle === 'enchanter') {
    // Macro close-up on the sculpted skull, sweeping horns, grand soul gem, candles, and grimoire
    camera.position.set(-0.62, 1.34, 0.48);
    controls.target.set(-1.25, 1.10, -0.50);
  } else if (angle === 'shelf') {
    // Macro close-up on the Arcanaeum Grimoires, leaning books, and scrolls
    camera.position.set(-1.05, 1.45, 0.95);
    controls.target.set(-1.95, 1.35, 0.9);
  } else if (angle === 'aurora') {
    // Eye-level view across rune floor through lancet arches to Aurora Borealis
    camera.position.set(0, 1.15, 1.95);
    controls.target.set(0, 2.05, -2.2);
  }
  controls.update();
  requestShadowBake(2);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function loadScene(mode) {
  currentScene = mode;

  // Update button states
  const presets = ['trio', 'tavern', 'alchemist', 'armory', 'library', 'tokyo', 'winterhold'];
  presets.forEach(p => {
    const el = document.getElementById(`btn-scene-${p}`);
    if (el) el.classList.toggle('active', mode === p);
  });

  if (activeWorldGroup) {
    scene.remove(activeWorldGroup);
    activeWorldGroup.traverse(child => {
      if (child.isMesh && child.geometry) {
        child.geometry.dispose();
      }
    });
  }
  sceneWarmupFrames = 90;

  if (mode === 'trio') {
    const compiled = compiler.compile(ManifestForgeTrio);
    activeWorldGroup = compiled.group;
    camera.position.set(0, 2.4, 4.6);
    controls.target.set(0, 0.7, 0);
    lighting.setHearthPosition(-1.6, 0.6, -0.4);
    document.getElementById('manifest-editor').value = JSON.stringify(ManifestForgeTrio, null, 2);
  } else if (mode === 'tavern') {
    const compiled = compiler.compile(ManifestMedievalTavern);
    activeWorldGroup = compiled.group;
    camera.position.set(4.4, 3.8, 5.2);
    controls.target.set(0, 1.1, -0.2);
    lighting.setHearthPosition(1.7, 0.45, -1.9);
    document.getElementById('manifest-editor').value = JSON.stringify(ManifestMedievalTavern, null, 2);
  } else if (mode === 'alchemist') {
    const compiled = compiler.compile(ManifestAlchemistLab);
    activeWorldGroup = compiled.group;
    camera.position.set(0, 3.2, 5.0);
    controls.target.set(0, 0.9, 0);
    lighting.setHearthPosition(1.4, 0.5, -0.6);
    document.getElementById('manifest-editor').value = JSON.stringify(ManifestAlchemistLab, null, 2);
  } else if (mode === 'armory') {
    const compiled = compiler.compile(ManifestDungeonArmory);
    activeWorldGroup = compiled.group;
    camera.position.set(0, 3.0, 4.6);
    controls.target.set(0, 0.8, 0);
    lighting.setHearthPosition(0.2, 0.5, 0.2);
    document.getElementById('manifest-editor').value = JSON.stringify(ManifestDungeonArmory, null, 2);
  } else if (mode === 'library') {
    const compiled = compiler.compile(ManifestHermitLibrary);
    activeWorldGroup = compiled.group;
    camera.position.set(0, 3.6, 5.2);
    controls.target.set(0, 1.0, 0);
    lighting.setHearthPosition(1.6, 0.6, -1.4);
    document.getElementById('manifest-editor').value = JSON.stringify(ManifestHermitLibrary, null, 2);
  } else if (mode === 'tokyo') {
    const compiled = compiler.compile(ManifestTokyoNintendoOffice);
    activeWorldGroup = compiled.group;
    camera.position.set(3.4, 2.6, 3.6);
    controls.target.set(0, 1.2, 0);
    controls.minDistance = 1.2;
    controls.maxDistance = 10.0;
    lighting.setSceneProfile('tokyo', currentLightingPreset);
    document.getElementById('manifest-editor').value = JSON.stringify(ManifestTokyoNintendoOffice, null, 2);
  } else if (mode === 'winterhold') {
    const compiled = compiler.compile(ManifestWinterholdCollege);
    activeWorldGroup = compiled.group;
    camera.position.set(3.4, 2.6, 3.6);
    controls.target.set(0, 1.2, 0);
    controls.minDistance = 1.2;
    controls.maxDistance = 12.0;
    lighting.setSceneProfile('winterhold', currentLightingPreset);
    document.getElementById('manifest-editor').value = JSON.stringify(ManifestWinterholdCollege, null, 2);
  }

  scene.add(activeWorldGroup);
  if (window.__artisan) window.__artisan.activeWorldGroup = activeWorldGroup;
  if (controls) controls.update();
  materials.setWireframe(isWireframe);
  requestShadowBake(4);
  updateTelemetry();
}

function setLighting(preset) {
  currentLightingPreset = preset;
  document.getElementById('btn-lighting-dusk').classList.toggle('active', preset === 'dusk');
  document.getElementById('btn-lighting-hearth').classList.toggle('active', preset === 'hearth');
  const dayBtn = document.getElementById('btn-lighting-day');
  if (dayBtn) dayBtn.classList.toggle('active', preset === 'day');

  lighting.setSceneProfile(currentScene, preset);
  requestShadowBake(3);
}

function toggleWireframe() {
  isWireframe = !isWireframe;
  document.getElementById('btn-toggle-lod').classList.toggle('active', isWireframe);
  materials.setWireframe(isWireframe);
}

function applyDPRPreset(preset) {
  dprPreset = preset;
  let targetDpr = 1.0;
  if (preset === 'auto') {
    targetDpr = isSoftwareRasterizer ? 0.75 : 1.0;
  } else if (preset === 'perf') {
    targetDpr = isSoftwareRasterizer ? 0.65 : 0.85;
  } else if (preset === 'balanced') {
    targetDpr = isSoftwareRasterizer ? 0.75 : 1.0;
  } else if (preset === 'ultra') {
    targetDpr = isSoftwareRasterizer ? 0.85 : Math.min(window.devicePixelRatio, 1.5);
  }
  renderer.setPixelRatio(targetDpr);
  requestShadowBake(2);
  updateDPRButtonUI();
}

function updateDPRButtonUI() {
  const btn = document.getElementById('btn-toggle-dpr');
  if (!btn) return;
  const currentDpr = renderer.getPixelRatio();
  if (isSoftwareRasterizer) {
    btn.innerText = `⚠️ WARP CPU (${currentDpr.toFixed(2)}x)`;
    btn.style.color = '#f87171';
    btn.style.borderColor = 'rgba(239, 68, 68, 0.6)';
    btn.classList.add('active');
    return;
  }
  if (dprPreset === 'auto') {
    btn.innerText = `⚡ Auto 60 FPS (${currentDpr.toFixed(2)}x)`;
    btn.style.color = '#34d399';
    btn.style.borderColor = 'rgba(52, 211, 153, 0.6)';
    btn.classList.add('active');
  } else if (dprPreset === 'perf') {
    btn.innerText = `🚀 Performance (${currentDpr.toFixed(2)}x)`;
    btn.style.color = '#38bdf8';
    btn.style.borderColor = 'rgba(56, 189, 248, 0.5)';
    btn.classList.add('active');
  } else if (dprPreset === 'balanced') {
    btn.innerText = '💎 1.0x Balanced (Crisp)';
    btn.style.color = '#fbbf24';
    btn.style.borderColor = 'rgba(251, 191, 36, 0.5)';
    btn.classList.remove('active');
  } else {
    btn.innerText = `✨ ${currentDpr.toFixed(1)}x Ultra (HiDPI)`;
    btn.style.color = '#c084fc';
    btn.style.borderColor = 'rgba(192, 132, 252, 0.5)';
    btn.classList.remove('active');
  }
}

function toggleDPR() {
  if (dprPreset === 'auto') {
    applyDPRPreset('perf');
  } else if (dprPreset === 'perf') {
    applyDPRPreset('balanced');
  } else if (dprPreset === 'balanced') {
    applyDPRPreset('ultra');
  } else {
    applyDPRPreset('auto');
  }
}

function updateTelemetry() {
  const realCalls = renderer?.info?.render?.calls ?? 0;
  const realTris = renderer?.info?.render?.triangles ?? 0;

  const elCalls = document.getElementById('hud-drawcalls');
  if (elCalls) elCalls.innerText = String(realCalls);

  const elTris = document.getElementById('hud-triangles');
  if (elTris) elTris.innerText = (realTris / 1000).toFixed(1) + 'k';

  const elFps = document.getElementById('hud-fps');
  if (elFps) elFps.innerText = String(Math.round(fps));
}

function setupEventListeners() {
  // Pill button triggers
  document.getElementById('btn-scene-trio').addEventListener('click', () => loadScene('trio'));
  document.getElementById('btn-scene-tavern').addEventListener('click', () => loadScene('tavern'));
  document.getElementById('btn-scene-alchemist').addEventListener('click', () => loadScene('alchemist'));
  document.getElementById('btn-scene-armory').addEventListener('click', () => loadScene('armory'));
  document.getElementById('btn-scene-library').addEventListener('click', () => loadScene('library'));
  document.getElementById('btn-scene-tokyo')?.addEventListener('click', () => loadScene('tokyo'));
  document.getElementById('btn-scene-winterhold')?.addEventListener('click', () => loadScene('winterhold'));

  document.getElementById('btn-lighting-dusk').addEventListener('click', () => setLighting('dusk'));
  document.getElementById('btn-lighting-hearth').addEventListener('click', () => setLighting('hearth'));
  const dayBtn = document.getElementById('btn-lighting-day');
  if (dayBtn) dayBtn.addEventListener('click', () => setLighting('day'));

  document.getElementById('btn-toggle-lod').addEventListener('click', toggleWireframe);
  document.getElementById('btn-toggle-dpr')?.addEventListener('click', toggleDPR);
  document.getElementById('btn-toggle-rtss')?.addEventListener('click', () => rtss?.toggle());

  // Camera angle buttons
  document.getElementById('btn-cam-hero')?.addEventListener('click', () => setCameraAngle('hero'));
  document.getElementById('btn-cam-enchanter')?.addEventListener('click', () => setCameraAngle('enchanter'));
  document.getElementById('btn-cam-shelf')?.addEventListener('click', () => setCameraAngle('shelf'));
  document.getElementById('btn-cam-aurora')?.addEventListener('click', () => setCameraAngle('aurora'));

  // Drawer Toggle
  const drawer = document.getElementById('studio-drawer');
  document.getElementById('btn-toggle-drawer').addEventListener('click', () => {
    drawer.classList.toggle('collapsed');
  });

  // Drawer Tab Switching
  document.querySelectorAll('.drawer-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');

      const target = e.target.dataset.tab;
      document.getElementById('tab-manifest').style.display = target === 'manifest' ? 'flex' : 'none';
      document.getElementById('tab-roi').style.display = target === 'roi' ? 'flex' : 'none';
      document.getElementById('tab-llm').style.display = target === 'llm' ? 'flex' : 'none';
      const taskmgrTab = document.getElementById('tab-taskmgr');
      if (taskmgrTab) {
        taskmgrTab.style.display = target === 'taskmgr' ? 'flex' : 'none';
        if (target === 'taskmgr' && profiler) {
          profiler.renderProcessTable();
          profiler.updateLiveMeters();
        }
      }
    });
  });

  // Compile manifest button
  const statusBox = document.getElementById('compiler-status-box');

  document.getElementById('btn-compile-manifest').addEventListener('click', () => {
    try {
      const text = document.getElementById('manifest-editor').value;
      const parsed = JSON.parse(text);

      const compiled = compiler.compile(parsed);

      if (activeWorldGroup) {
        scene.remove(activeWorldGroup);
      }
      activeWorldGroup = compiled.group;
      scene.add(activeWorldGroup);

      materials.setWireframe(isWireframe);
      updateTelemetry();

      statusBox.style.display = 'block';
      statusBox.style.background = 'rgba(16, 185, 129, 0.15)';
      statusBox.style.border = '1px solid #10b981';
      statusBox.style.color = '#34d399';
      statusBox.innerHTML = `<b>✓ World Compiled Successfully</b><br>Entities: ${compiled.entityCount} · Laws Validated · 0 Errors`;
    } catch (err) {
      statusBox.style.display = 'block';
      statusBox.style.background = 'rgba(239, 68, 68, 0.15)';
      statusBox.style.border = '1px solid #ef4444';
      statusBox.style.color = '#f87171';
      statusBox.innerHTML = `<b>✗ Compilation Error:</b><br>${err.message}`;
    }
  });

  // Quick Injectors
  const injectAsset = (asset) => {
    try {
      const current = JSON.parse(document.getElementById('manifest-editor').value);
      current.entities.push(asset);
      document.getElementById('manifest-editor').value = JSON.stringify(current, null, 2);
      document.getElementById('btn-compile-manifest').click();
    } catch (e) {
      alert('Could not inject: ' + e.message);
    }
  };

  document.getElementById('btn-inject-barrel')?.addEventListener('click', () => {
    const offset = (Math.random() - 0.5) * 2;
    injectAsset({
      id: `prop.barrel.oak.${Date.now().toString().slice(-3)}`,
      kind: 'prop',
      transform: { positionM: [offset, 0, 1.2], rotationDeg: [0, Math.floor(Math.random() * 360), 0], scale: [1, 1, 1] },
      assetRef: 'storage.barrel',
      materialRefs: ['wood.weathered_oak', 'metal.forged_iron'],
      seed: Math.floor(Math.random() * 999),
      relationships: [{ type: 'supported_by', target: 'ground.stone' }]
    });
  });

  document.getElementById('btn-inject-lantern')?.addEventListener('click', () => {
    const offset = (Math.random() - 0.5) * 1.5;
    injectAsset({
      id: `prop.lantern.iron.${Date.now().toString().slice(-3)}`,
      kind: 'prop',
      transform: { positionM: [offset, 0, 0.8], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
      assetRef: 'lighting.lantern',
      materialRefs: ['metal.forged_iron', 'ember'],
      seed: Math.floor(Math.random() * 999),
      relationships: [{ type: 'supported_by', target: 'ground.stone' }]
    });
  });

  document.getElementById('btn-inject-chest')?.addEventListener('click', () => {
    injectAsset({
      id: `prop.chest.oak.${Date.now().toString().slice(-3)}`,
      kind: 'prop',
      transform: { positionM: [-1.2, 0, 1.0], rotationDeg: [0, 15, 0], scale: [1, 1, 1] },
      assetRef: 'storage.chest',
      materialRefs: ['wood.weathered_oak', 'metal.forged_iron'],
      seed: Math.floor(Math.random() * 999),
      relationships: [{ type: 'supported_by', target: 'ground.stone' }]
    });
  });

  document.getElementById('btn-inject-bookshelf')?.addEventListener('click', () => {
    injectAsset({
      id: `prop.bookshelf.oak.${Date.now().toString().slice(-3)}`,
      kind: 'prop',
      transform: { positionM: [-2.0, 0, 0], rotationDeg: [0, 90, 0], scale: [1, 1, 1] },
      assetRef: 'furniture.bookshelf',
      materialRefs: ['wood.dark_oak'],
      seed: Math.floor(Math.random() * 999),
      relationships: [{ type: 'supported_by', target: 'ground.stone' }]
    });
  });

  document.getElementById('btn-inject-cauldron')?.addEventListener('click', () => {
    injectAsset({
      id: `prop.cauldron.iron.${Date.now().toString().slice(-3)}`,
      kind: 'prop',
      transform: { positionM: [1.6, 0, 0.5], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
      assetRef: 'kitchen.cauldron',
      materialRefs: ['metal.forged_iron', 'ember'],
      seed: Math.floor(Math.random() * 999),
      relationships: [{ type: 'supported_by', target: 'ground.stone' }]
    });
  });

  document.getElementById('btn-inject-rack')?.addEventListener('click', () => {
    injectAsset({
      id: `prop.weapon_rack.${Date.now().toString().slice(-3)}`,
      kind: 'prop',
      transform: { positionM: [0.8, 0, -1.5], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
      assetRef: 'workshop.weapon_rack',
      materialRefs: ['wood.dark_oak', 'metal.forged_iron'],
      seed: Math.floor(Math.random() * 999),
      relationships: [{ type: 'supported_by', target: 'ground.stone' }]
    });
  });

  // Reset manifest button
  document.getElementById('btn-reset-manifest').addEventListener('click', () => {
    statusBox.style.display = 'none';
    loadScene(currentScene);
  });

  // Copy LLM prompt
  document.getElementById('btn-copy-llm-prompt').addEventListener('click', () => {
    const promptBox = document.getElementById('llm-prompt-box');
    promptBox.select();
    navigator.clipboard.writeText(promptBox.value);
    alert('Artisan LLM System Prompt copied to clipboard!');
  });
}

function setupLLMPromptBox() {
  const prompt = `# ARTISAN 3D WORLD COMPASS — UNIVERSAL LLM AUTHOR CONTRACT

You are an expert artisan 3D worldbuilder. Output ONLY a valid JSON manifest conforming to the World Compass v2 protocol. DO NOT write Three.js code.

UNIVERSAL ASSET ARCHETYPES:
- Architecture: "forge.stone_chimney_family", "arch.hearth", "arch.fireplace", "arch.floor", "arch.wall"
- Furniture: "furniture.table", "furniture.desk", "furniture.bench", "furniture.bookshelf"
- Workshop: "anvil.forged_iron_01", "bellows.leather_iron_01", "workshop.weapon_rack", "kitchen.cauldron"
- Storage: "storage.chest", "storage.barrel", "storage.crate"
- Lighting: "lighting.lantern"
- Decor: "decor.woven_rug", "painting.sun_mountain_01"

ALLOWED MATERIAL FAMILIES:
- wood.dark_oak, wood.weathered_oak, wood.floor_oak
- plaster.lime_warm, stone.rough_local, stone.hearth
- metal.forged_iron, metal.polished_iron, leather.worn, ember
- cloth.woven_cushion, cloth.woven_rug, ceramic.dish

SPATIAL LAWS:
1. Units: meters. Up: +Y, East: +X, South: +Z.
2. Every prop MUST have "relationships": [{"type": "supported_by", "target": "<parent_or_ground>"}]
3. Human proportions: tables ~0.75m high, chairs ~0.45m high, ceilings ~2.8m high.

OUTPUT FORMAT:
{
  "worldId": "your_scene_id",
  "version": 1,
  "units": "meter",
  "axis": { "handedness": "right", "up": "+Y", "east": "+X", "south": "+Z" },
  "entities": [
    {
      "id": "prop.anvil.blacksmith.001",
      "kind": "prop",
      "transform": { "positionM": [0, 0, 0], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "anvil.forged_iron_01",
      "materialRefs": ["metal.forged_iron", "wood.dark_oak"],
      "seed": 137,
      "relationships": [{ "type": "supported_by", "target": "ground.stone" }]
    }
  ]
}`;
  document.getElementById('llm-prompt-box').value = prompt;
}

/* ==========================================================================
   MCP WEBSOCKET BRIDGE — Live Preview from Artisan 3D MCP Server
   ========================================================================== */

function setupMCPBridge() {
  const MCP_WS_URL = 'ws://localhost:9900';
  let ws = null;
  let reconnectDelay = 1000;
  let mcpIndicator = document.getElementById('mcp-indicator');
  if (!mcpIndicator) {
    mcpIndicator = document.createElement('div');
    mcpIndicator.id = 'mcp-indicator';
    mcpIndicator.style.cssText = 'position:fixed;top:12px;left:12px;display:flex;align-items:center;gap:6px;padding:6px 14px;border-radius:20px;background:rgba(20,22,28,0.92);border:1px solid rgba(255,255,255,0.08);font-size:11px;font-family:monospace;color:#888;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.5);transition:all 0.3s;';
    mcpIndicator.innerHTML = '<span id="mcp-dot" style="width:8px;height:8px;border-radius:50%;background:#555;display:inline-block;"></span><span id="mcp-label">MCP: STANDBY</span>';
    document.body.appendChild(mcpIndicator);
  }

  function setStatus(connected) {
    const dot = document.getElementById('mcp-dot');
    const label = document.getElementById('mcp-label');
    if (!dot || !label) return;
    if (connected) {
      dot.style.background = '#10b981';
      dot.style.boxShadow = '0 0 8px #10b981';
      label.textContent = 'MCP: CONNECTED';
      label.style.color = '#34d399';
    } else {
      dot.style.background = '#64748b';
      dot.style.boxShadow = 'none';
      label.textContent = 'MCP: STANDBY';
      label.style.color = '#8492a6';
    }
  }

  function connect() {
    try {
      ws = new WebSocket(MCP_WS_URL);

      ws.onopen = () => {
        console.log('[MCP Bridge] Connected to Artisan 3D MCP Server');
        setStatus(true);
        reconnectDelay = 1000; // Reset backoff
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);

          // Command: RUN_AUDIT
          if (msg.type === 'RUN_AUDIT') {
            console.log('[MCP Bridge] Executing empirical audit requested by MCP server...');
            let report = null;
            if (profiler) {
              report = await profiler.runAudit();
            }
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'AUDIT_RESULT',
                id: msg.id,
                report
              }));
            }
            return;
          }

          // Command: GET_TELEMETRY
          if (msg.type === 'GET_TELEMETRY') {
            const telemetry = rtss ? rtss.getTelemetry() : {
              fps,
              calls: renderer?.info?.render?.calls ?? 0,
              triangles: renderer?.info?.render?.triangles ?? 0,
              pixelRatio: renderer?.getPixelRatio() ?? 1.0,
              viewport: `${window.innerWidth}x${window.innerHeight}`
            };
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'TELEMETRY_RESULT',
                id: msg.id,
                telemetry
              }));
            }
            return;
          }

          // Command: CAPTURE_SCREENSHOT
          if (msg.type === 'CAPTURE_SCREENSHOT') {
            if (msg.angle && window.setCameraAngle) {
              window.setCameraAngle(msg.angle);
              await new Promise(r => setTimeout(r, 200));
            }
            renderer.render(scene, camera);
            const dataUrl = renderer.domElement.toDataURL('image/png');
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'SCREENSHOT_RESULT',
                id: msg.id,
                dataUrl
              }));
            }
            return;
          }

          // Command: SET_SCENE
          if (msg.type === 'SET_SCENE') {
            loadScene(msg.scene);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'SCENE_RESULT',
                id: msg.id,
                scene: msg.scene
              }));
            }
            return;
          }

          // Otherwise, message is a Scene Manifest to compile & render
          const manifest = msg;
          console.log('[MCP Bridge] Received manifest:', manifest.worldId, 'v' + manifest.version, `(${manifest.entities?.length || 0} entities)`);

          // Handle lighting preset from manifest
          if (manifest.lighting && manifest.lighting !== currentLightingPreset) {
            setLighting(manifest.lighting);
          }

          // Compile and render the scene
          const compiled = compiler.compile(manifest);

          if (activeWorldGroup) {
            scene.remove(activeWorldGroup);
          }
          activeWorldGroup = compiled.group;
          scene.add(activeWorldGroup);
          materials.setWireframe(isWireframe);
          updateTelemetry();

          // Update manifest editor to show the received manifest
          const editorEl = document.getElementById('manifest-editor');
          if (editorEl) {
            editorEl.value = JSON.stringify(manifest, null, 2);
          }

          // Show compilation toast
          const statusBox = document.getElementById('compiler-status-box');
          if (statusBox) {
            statusBox.style.display = 'block';
            statusBox.style.background = 'rgba(16, 185, 129, 0.15)';
            statusBox.style.border = '1px solid #10b981';
            statusBox.style.color = '#34d399';
            statusBox.innerHTML = `<b>✓ MCP Live Preview Updated</b><br>World: ${manifest.worldId} · Entities: ${manifest.entities?.length || 0} · v${manifest.version}`;
          }

        } catch (err) {
          console.error('[MCP Bridge] Failed to process message:', err);
          const statusBox = document.getElementById('compiler-status-box');
          if (statusBox) {
            statusBox.style.display = 'block';
            statusBox.style.background = 'rgba(239, 68, 68, 0.15)';
            statusBox.style.border = '1px solid #ef4444';
            statusBox.style.color = '#f87171';
            statusBox.innerHTML = `<b>✗ MCP Processing Error:</b><br>${err.message}`;
          }
        }
      };

      ws.onclose = () => {
        console.log('[MCP Bridge] Disconnected. Reconnecting in', reconnectDelay, 'ms...');
        setStatus(false);
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 1.5, 10000); // Exponential backoff, max 10s
      };

      ws.onerror = (err) => {
        // Silently handle — onclose will trigger reconnect
        ws.close();
      };
    } catch (e) {
      // WebSocket constructor can throw if URL is invalid
      setTimeout(connect, reconnectDelay);
    }
  }

  connect();
}

function renderLoop(time) {
  requestAnimationFrame(renderLoop);

  if (sceneWarmupFrames > 0) {
    sceneWarmupFrames--;
  }

  if (profiler) profiler.onFrameStart();

  // Manage static shadow map bake / cache (Zero shadow passes when cached)
  if (profiler) profiler.startStage('ShadowPass');
  if (shadowBakeFrames > 0) {
    renderer.shadowMap.needsUpdate = true;
    shadowBakeFrames--;
  }
  if (profiler) profiler.endStage('ShadowPass');

  // Update lighting fire flicker
  if (profiler) profiler.startStage('Lighting');
  lighting.update(time * 0.001);
  if (profiler) profiler.endStage('Lighting');

  // Update camera controls
  if (profiler) profiler.startStage('Controls');
  controls.update();
  if (profiler) profiler.endStage('Controls');

  // Render frame (Main PBR forward draw pass)
  if (profiler) profiler.startStage('ForwardRender');
  const tRenderStart = performance.now();
  renderer.render(scene, camera);
  lastForwardRenderMs = performance.now() - tRenderStart;
  if (profiler) profiler.endStage('ForwardRender');

  // Update RivaTuner / RTSS Hardware OSD & Engine Telemetry
  if (profiler) profiler.startStage('Telemetry');
  if (rtss) {
    rtss.update(time, shadowBakeFrames, lastForwardRenderMs);
  }

  // FPS & Real-time hardware telemetry calculation
  frames++;
  const now = performance.now();
  if (now >= lastTime + 500) {
    fps = (frames * 1000) / (now - lastTime);
    updateTelemetry();

    // Autonomic 60 FPS Dynamic Scaler (Mainframe Engine Throttle)
    // EMPIRICAL SAFETY: Only throttle if the GPU forward pass is ACTUALLY taking > 13.5ms.
    // If frametime is 33.3ms (30 FPS) due to Windows Battery Saver / Chrome Energy Saver
    // but the GPU takes only ~2ms, degrading resolution is useless and ruins image fidelity.
    const isGpuOverloaded = lastForwardRenderMs > 13.5;
    if (dprPreset === 'auto' && sceneWarmupFrames === 0 && now - lastDPRAdjustment > 1000) {
      const currentDpr = renderer.getPixelRatio();
      const maxAllowedDpr = isSoftwareRasterizer ? 0.75 : Math.min(window.devicePixelRatio, 1.25);
      const minAllowedDpr = isSoftwareRasterizer ? 0.65 : 0.75;

      if (fps < 40 && isGpuOverloaded && currentDpr > minAllowedDpr) {
        // Immediate panic drop only when GPU is genuinely overloaded
        renderer.setPixelRatio(minAllowedDpr);
        lastDPRAdjustment = now;
        updateDPRButtonUI();
        requestShadowBake(1);
      } else if (fps < 54 && isGpuOverloaded && currentDpr > minAllowedDpr) {
        const nextDpr = Math.max(minAllowedDpr, Math.round((currentDpr - 0.05) * 100) / 100);
        renderer.setPixelRatio(nextDpr);
        lastDPRAdjustment = now;
        updateDPRButtonUI();
        requestShadowBake(1);
      } else if (fps > 58.5 && currentDpr < maxAllowedDpr) {
        const nextDpr = Math.min(maxAllowedDpr, Math.round((currentDpr + 0.05) * 100) / 100);
        renderer.setPixelRatio(nextDpr);
        lastDPRAdjustment = now;
        updateDPRButtonUI();
        requestShadowBake(1);
      }
    }

    frames = 0;
    lastTime = now;
  }
  if (profiler) profiler.endStage('Telemetry');

  if (profiler) profiler.onFrameEnd();
}

// Boot application with error boundary
try {
  init();
} catch (err) {
  console.error('CRITICAL BOOT ERROR:', err);
  const errDiv = document.createElement('div');
  errDiv.style = 'position:fixed;top:20px;left:20px;right:20px;background:#ef4444;color:#fff;padding:16px;border-radius:10px;z-index:9999;font-family:sans-serif;font-weight:bold;white-space:pre-wrap;';
  errDiv.innerText = 'Studio Boot Error: ' + err.message + '\n' + err.stack;
  document.body.appendChild(errDiv);
}
