// main.js — The Fantastic World: boot, physics, camera, day-to-day heartbeat.
// Architecture: shared-ctx modular pattern, born from the arcane_room
// modularization (projects/fantastic-world — parity-cab verified).
import * as THREE from 'three';
import { ctx } from './core/ctx.js';
import { P } from './core/palette.js';
import { createHall, HALL } from './world/hall.js';
import { createProps } from './world/props.js';
import { createSky } from './world/sky.js';
import { createExterior } from './world/exterior.js';
import { setupLighting, setupPost } from './fx/lighting.js';
import { createParticles } from './fx/particles.js';
import { setupControls, readMoveInput } from './player/controls.js';
import { createAvatar } from './player/avatar.js';
import { checkFocus } from './interaction/interaction.js';
import { bindVeil, showPlace } from './ui/hud.js';
import { setupBridge } from './ui/bridge.js';
import { startAmbience, setOutdoorMix } from './audio/ambience.js';

const HD = HALL.d / 2;
const EYE = 1.62, RADIUS = 0.35;
const WALK = 3.1, RUN = 5.6;

let animFrameId = null;
let isRunning = false;

export function bootFantasticWorld({ customRenderer = null, customCanvas = null } = {}) {
  if (isRunning) return;
  isRunning = true;

  ctx.scene = new THREE.Scene();
  ctx.scene.name = 'The_Fantastic_World_Scene';
  ctx.scene.fog = new THREE.FogExp2(P.fog, 0.0085);

  ctx.camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.08, 520);

  const effectiveDpr = window.__artisan?.computeEffectiveDPR ? window.__artisan.computeEffectiveDPR() : Math.min(window.devicePixelRatio || 1.0, 1.0);

  if (customRenderer) {
    ctx.renderer = customRenderer;
    ctx.renderer.setSize(innerWidth, innerHeight);
    ctx.renderer.setPixelRatio(effectiveDpr);
    ctx.renderer.shadowMap.enabled = true;
    ctx.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    ctx.renderer.shadowMap.autoUpdate = false;
    ctx.renderer.shadowMap.needsUpdate = true;
    ctx.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    ctx.renderer.toneMappingExposure = 1.05;
  } else {
    ctx.renderer = new THREE.WebGLRenderer({ 
      canvas: customCanvas || undefined, 
      antialias: true, 
      powerPreference: 'high-performance' 
    });
    ctx.renderer.setSize(innerWidth, innerHeight);
    ctx.renderer.setPixelRatio(effectiveDpr);
    ctx.renderer.shadowMap.enabled = true;
    ctx.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    ctx.renderer.shadowMap.autoUpdate = false;
    ctx.renderer.shadowMap.needsUpdate = true;
    ctx.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    ctx.renderer.toneMappingExposure = 1.05;
    if (!customCanvas && !customRenderer) {
      document.body.appendChild(ctx.renderer.domElement);
    }
  }

  // player rig
  ctx.player = new THREE.Group();
  ctx.player.name = 'Explorer_Avatar_Rig';
  ctx.player.position.set(0, 0, 6.5);
  ctx.yaw = Math.PI;                    // face the north arch (into the hall)
  ctx.scene.add(ctx.player);
  ctx.player.add(createAvatar());

  // world
  const sky = createSky();
  sky.name = 'Sky_Dome_Celestial_Moon';
  ctx.scene.add(sky);

  const hall = createHall();
  hall.name = 'Great_Hall_Architecture';
  ctx.scene.add(hall);

  const props = createProps();
  props.name = 'Hall_Props_And_Furniture';
  ctx.scene.add(props);

  const exterior = createExterior();
  exterior.name = 'Exterior_Terrain_Pond_Stairs';
  ctx.scene.add(exterior);

  const particles = createParticles();
  particles.name = 'Particle_Simulation_Motes';
  ctx.scene.add(particles);

  setupLighting();
  setupPost();
  setupControls();

  // The bridge is a dev tool. If it cannot start — server down, storage denied,
  // a sandbox that forbids something — the world must still open. Anything
  // between here and bindVeil() that throws would leave the veil unclickable.
  try { setupBridge(); } catch (e) { console.warn('[bridge] unavailable:', e); }

  window.addEventListener('resize', onResize);

  // Unhide and reset HUD elements
  const veil = document.getElementById('veil');
  if (veil) {
    veil.style.display = 'flex';
    veil.classList.remove('gone');
  }
  const reticle = document.getElementById('reticle');
  if (reticle) reticle.style.display = 'block';
  const placeCard = document.getElementById('place-card');
  if (placeCard) placeCard.style.display = 'block';
  const hintBar = document.getElementById('hint-bar');
  if (hintBar) hintBar.style.display = 'block';
  const readCard = document.getElementById('read-card');
  if (readCard) readCard.style.display = 'block';
  const vignette = document.getElementById('vignette');
  if (vignette) vignette.style.display = 'block';

  bindVeil(() => {
    startAmbience();
    if (!ctx.isTouch) {
      const p = ctx.renderer.domElement.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
    setTimeout(() => showPlace('The Fantastic Hall'), 900);
  });

  window.__fantasticCtx = ctx;
  window.__fantasticWorldActive = true;

  animate();
}

export function teardownFantasticWorld() {
  if (!isRunning) return;
  isRunning = false;
  window.__fantasticWorldActive = false;
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  window.removeEventListener('resize', onResize);
  // Hide HUD elements
  ['veil', 'reticle', 'place-card', 'hint-bar', 'read-card', 'bridge', 'vignette'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  if (document.pointerLockElement) {
    document.exitPointerLock();
  }
}


// exterior ground height — MUST mirror world/exterior.js displacement
function groundHeight(x, z) {
  if (z > -HD) return 0;                       // inside the hall
  const d = Math.hypot(x, z);
  let h = Math.sin(x * 0.08) * Math.cos(-z * 0.07) * 0.55 + Math.sin(x * 0.021 + 3) * 1.1;
  h *= THREE.MathUtils.smoothstep(d, 6, 26);
  return h;
}

// ── zones ──
const zones = [
  { name: 'The Dream Garden', test: (p) => p.z < -HD - 1.5 && p.z > -HD - 22 },
  { name: 'The Mirror Pond', test: (p) => Math.hypot(p.x - 1.2, p.z + HD + 27.5) < 10 },
  { name: 'The Luminous Stairs', test: (p) => Math.hypot(p.x - 16.5, p.z + HD + 25) < 7 },
  { name: 'The Fantastic Hall', test: (p) => p.z > -HD },
];
let currentZone = 'The Fantastic Hall';

function updateZone() {
  const p = ctx.player.position;
  for (const z of zones) {
    if (z.test(p)) {
      if (z.name !== currentZone) {
        currentZone = z.name;
        showPlace(z.name);
        setOutdoorMix(z.name !== 'The Fantastic Hall');
      }
      return;
    }
  }
}

// ── movement & collision ──
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), wish = new THREE.Vector3();

function movePlayer(dt) {
  readMoveInput();
  if (ctx.sitting || ctx.reading || ctx.bridging) { ctx.velocity.set(0, 0, 0); return; }

  fwd.set(-Math.sin(ctx.yaw), 0, -Math.cos(ctx.yaw));
  right.set(-fwd.z, 0, fwd.x);
  wish.set(0, 0, 0)
    .addScaledVector(fwd, ctx.moveInput.y)
    .addScaledVector(right, ctx.moveInput.x);
  if (wish.lengthSq() > 1) wish.normalize();

  const speed = ctx.running ? RUN : WALK;
  ctx.velocity.x = THREE.MathUtils.damp(ctx.velocity.x, wish.x * speed, 9, dt);
  ctx.velocity.z = THREE.MathUtils.damp(ctx.velocity.z, wish.z * speed, 9, dt);

  const p = ctx.player.position;
  p.x += ctx.velocity.x * dt;
  p.z += ctx.velocity.z * dt;

  // circle colliders
  for (const c of ctx.colliders) {
    const dx = p.x - c.x, dz = p.z - c.z;
    const d2 = dx * dx + dz * dz, min = c.r + RADIUS;
    if (d2 < min * min && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      p.x = c.x + (dx / d) * min;
      p.z = c.z + (dz / d) * min;
    }
  }
  // wall AABBs — push out along least penetration
  for (const w of ctx.walls) {
    if (p.x > w.minX - RADIUS && p.x < w.maxX + RADIUS &&
        p.z > w.minZ - RADIUS && p.z < w.maxZ + RADIUS) {
      const pushL = (p.x - (w.minX - RADIUS));
      const pushR = ((w.maxX + RADIUS) - p.x);
      const pushN = (p.z - (w.minZ - RADIUS));
      const pushF = ((w.maxZ + RADIUS) - p.z);
      const m = Math.min(pushL, pushR, pushN, pushF);
      if (m === pushL) p.x = w.minX - RADIUS;
      else if (m === pushR) p.x = w.maxX + RADIUS;
      else if (m === pushN) p.z = w.minZ - RADIUS;
      else p.z = w.maxZ + RADIUS;
    }
  }
  // world bounds
  p.x = THREE.MathUtils.clamp(p.x, ctx.bounds.minX, ctx.bounds.maxX);
  p.z = THREE.MathUtils.clamp(p.z, ctx.bounds.minZ, ctx.bounds.maxZ);

  // stick to the ground
  const gh = groundHeight(p.x, p.z);
  p.y = THREE.MathUtils.damp(p.y, gh, 12, dt);
}

// ── camera ──
const camTarget = new THREE.Vector3(), camPos = new THREE.Vector3();
let headBob = 0;

function updateCamera(dt) {
  const p = ctx.player.position;
  const speed = Math.hypot(ctx.velocity.x, ctx.velocity.z);
  headBob += dt * (4 + speed * 2.4);
  const bobY = (!ctx.thirdPerson && speed > 0.3) ? Math.sin(headBob * 2.1) * 0.028 * Math.min(speed / WALK, 1.4) : 0;

  if (ctx.avatar) {
    ctx.avatar.rotation.y = ctx.yaw + Math.PI;
  }

  if (ctx.thirdPerson) {
    const dist = 3.8, h = 1.9 - ctx.pitch * 1.1;
    camPos.set(
      p.x + Math.sin(ctx.yaw) * dist,
      p.y + Math.max(0.5, h),
      p.z + Math.cos(ctx.yaw) * dist);
    ctx.camera.position.lerp(camPos, 1 - Math.exp(-10 * dt));
    camTarget.set(p.x, p.y + 1.35, p.z);
    ctx.camera.lookAt(camTarget);
  } else {
    ctx.camera.position.set(p.x, p.y + EYE + bobY, p.z);
    ctx.camera.rotation.set(0, 0, 0, 'YXZ');
    ctx.camera.rotation.order = 'YXZ';
    ctx.camera.rotation.y = ctx.yaw;
    ctx.camera.rotation.x = ctx.pitch;
  }
}

let shadowBakeFrames = 6;
let gameFrames = 0;
let gameLastTime = performance.now();
let gameLastDprAdjustment = 0;

// ── loop ──
function animate() {
  if (!isRunning) return;
  animFrameId = requestAnimationFrame(animate);
  const dt = Math.min(ctx.clock.getDelta(), 0.05);
  const t = ctx.clock.elapsedTime;

  if (shadowBakeFrames > 0) {
    ctx.renderer.shadowMap.needsUpdate = true;
    shadowBakeFrames--;
  }

  const profiler = window.__artisan?.profiler;
  if (profiler) profiler.onFrameStart();

  if (profiler) profiler.startStage('Controls');
  movePlayer(dt);
  updateCamera(dt);
  if (profiler) profiler.endStage('Controls');

  if (profiler) profiler.startStage('Lighting');
  updateZone();
  checkFocus();
  for (const fn of ctx.animations) fn(dt, t);
  if (profiler) profiler.endStage('Lighting');

  if (profiler) profiler.startStage('ForwardRender');
  const tRenderStart = performance.now();
  if (ctx.composer && !window.__artisanDisableBloom) {
    ctx.composer.render();
  } else {
    ctx.renderer.render(ctx.scene, ctx.camera);
  }
  const lastRenderMs = performance.now() - tRenderStart;
  if (profiler) profiler.endStage('ForwardRender');

  if (profiler) profiler.startStage('Telemetry');
  if (window.__artisan?.rtss) {
    window.__artisan.rtss.update(performance.now(), 0, lastRenderMs);
  }
  if (profiler) profiler.endStage('Telemetry');

  if (profiler) profiler.onFrameEnd();

  // Autonomic 60 FPS Dynamic Scaler for Game Mode
  gameFrames++;
  const now = performance.now();
  if (now >= gameLastTime + 500) {
    const currentFps = (gameFrames * 1000) / (now - gameLastTime);
    const preset = window.__artisan?.getDPRPreset?.();
    if ((preset === 'auto' || preset === 'perf') && now - gameLastDprAdjustment > 1000) {
      const currentDpr = ctx.renderer.getPixelRatio();
      const budgetDpr = window.__artisan?.computeEffectiveDPR ? window.__artisan.computeEffectiveDPR(preset) : (preset === 'perf' ? 0.85 : 1.0);
      const minDpr = preset === 'perf' ? 0.65 : 0.70;
      const maxDpr = budgetDpr;

      if (currentFps < 52 && currentDpr > minDpr) {
        const nextDpr = Math.max(minDpr, Math.round((currentDpr - 0.05) * 100) / 100);
        ctx.renderer.setPixelRatio(nextDpr);
        if (ctx.composer) ctx.composer.setPixelRatio(nextDpr);
        gameLastDprAdjustment = now;
      } else if (currentFps > 58.5 && currentDpr < maxDpr) {
        const nextDpr = Math.min(maxDpr, Math.round((currentDpr + 0.05) * 100) / 100);
        ctx.renderer.setPixelRatio(nextDpr);
        if (ctx.composer) ctx.composer.setPixelRatio(nextDpr);
        gameLastDprAdjustment = now;
      }
    }
    gameFrames = 0;
    gameLastTime = now;
  }
}

function onResize() {
  const effectiveDpr = window.__artisan?.computeEffectiveDPR ? window.__artisan.computeEffectiveDPR() : Math.min(window.devicePixelRatio || 1.0, 1.0);
  ctx.camera.aspect = innerWidth / innerHeight;
  ctx.camera.updateProjectionMatrix();
  ctx.renderer.setPixelRatio(effectiveDpr);
  ctx.renderer.setSize(innerWidth, innerHeight);
  if (ctx.composer) {
    ctx.composer.setPixelRatio(effectiveDpr);
    ctx.composer.setSize(innerWidth, innerHeight);
  }
  shadowBakeFrames = 3;
}

export { ctx };


