// player/controls.js — unified input: pointer-lock mouse look + WASD (desktop),
// drag-look + joystick (touch). V toggles first/third person. E interacts.
//
// Camera contract: looking around must ALWAYS work. Pointer lock is the
// preferred path (infinite travel, no cursor), but it can be refused for
// reasons the player can't see — an iframe without allow-pointer-lock, a
// browser that wants a fresh gesture, a window that just lost focus, or a
// stray Esc. So drag-to-look is a permanent fallback, not an error path: if
// the pointer isn't locked, holding the left button and moving still turns
// the head. The player is never stuck staring at a wall.
import * as THREE from 'three';
import { ctx } from '../core/ctx.js';
import { interact, stopSitting } from '../interaction/interaction.js';
import { showHint, hideHint } from '../ui/hud.js';

const keys = new Set();
let joyTouch = null, lookTouch = null;
const joyCenter = { x: 0, y: 0 };
const lastLook = { x: 0, y: 0 };

// Drag-look state (used only while the pointer is NOT locked)
let dragging = false, dragMoved = false;
const dragLast = { x: 0, y: 0 };
const DRAG_SLOP = 4;          // px before a press counts as a look, not a click
const PITCH_LIMIT = 1.45;     // ~83°, keeps the horizon from flipping

const SENS_KEY = 'fw.lookSensitivity';

// Storage is a PRIVILEGE, not a given. In a sandboxed iframe without
// allow-same-origin — which is exactly how artifact-system runs artifacts —
// merely *reading* localStorage throws SecurityError. A remembered preference
// must never be able to stop the world from booting.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* opaque origin */ } },
};

export function setupControls() {
  ctx.isTouch = matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window;
  if (ctx.isTouch) document.body.classList.add('touch');

  // Sensitivity is tunable live from the console: ctx.lookSensitivity = 0.003
  const saved = parseFloat(store.get(SENS_KEY) || '');
  ctx.lookSensitivity = Number.isFinite(saved) && saved > 0 ? saved : 0.0022;
  ctx.setLookSensitivity = (v) => {
    ctx.lookSensitivity = Math.min(Math.max(v, 0.0004), 0.02);
    store.set(SENS_KEY, String(ctx.lookSensitivity));
    return ctx.lookSensitivity;
  };

  addEventListener('keydown', (e) => {
    if (ctx.reading || ctx.bridging) return;   // typing a letter ≠ walking
    keys.add(e.code);
    if (e.code === 'KeyV') togglePerson();
    if (e.code === 'KeyE') interact();
    if (e.code.startsWith('Arrow')) e.preventDefault();
  });
  // Keys must not stay stuck down when focus leaves mid-stride.
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); ctx.moveInput.set(0, 0); dragging = false; });

  if (!ctx.isTouch) setupDesktop(); else setupTouch();
}

function applyLook(dx, dy) {
  const s = ctx.lookSensitivity;
  ctx.yaw -= dx * s;
  ctx.pitch = THREE.MathUtils.clamp(ctx.pitch - dy * s, -PITCH_LIMIT, PITCH_LIMIT);
}

/** Tell the player how to look around right now — the answer changes with state. */
function lookHint() {
  if (ctx.reading || ctx.bridging || ctx.isTouch) return;
  if (ctx.pointerLocked) hideHint(true);
  else showHint('<b>click</b> to capture the mouse &nbsp;·&nbsp; or <b>drag</b> to look');
}

function setupDesktop() {
  const canvas = ctx.renderer.domElement;

  // The intro veil owns the very first gesture. If we also grab pointer lock on
  // that same mouseup, the lock engages mid-sequence and the browser never
  // delivers the veil's click — the player clicks to enter and nothing happens.
  const veilUp = () => {
    const v = document.getElementById('veil');
    return !!v && !v.classList.contains('gone');
  };

  const tryLock = () => {
    if (ctx.reading || ctx.bridging || ctx.pointerLocked || veilUp()) return;
    // May reject (iframe policy, missing gesture). Drag-look covers us either way.
    const p = canvas.requestPointerLock?.();
    if (p && typeof p.catch === 'function') p.catch(() => lookHint());
  };

  document.addEventListener('pointerlockchange', () => {
    ctx.pointerLocked = document.pointerLockElement === canvas;
    document.getElementById('reticle').classList.toggle('show', ctx.pointerLocked);
    if (ctx.pointerLocked) hideHint(true); else lookHint();
  });
  // Fires when the browser refuses the lock — the silent failure we're covering.
  document.addEventListener('pointerlockerror', () => {
    ctx.pointerLocked = false;
    lookHint();
  });

  addEventListener('mousemove', (e) => {
    if (ctx.reading || ctx.bridging) return;
    if (ctx.pointerLocked) {
      applyLook(e.movementX, e.movementY);
    } else if (dragging) {
      const dx = e.clientX - dragLast.x, dy = e.clientY - dragLast.y;
      if (!dragMoved && Math.hypot(dx, dy) > DRAG_SLOP) dragMoved = true;
      if (dragMoved) applyLook(dx, dy);
      dragLast.x = e.clientX; dragLast.y = e.clientY;
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || ctx.reading || ctx.bridging) return;
    if (ctx.pointerLocked) { interact(); return; }
    dragging = true; dragMoved = false;
    dragLast.x = e.clientX; dragLast.y = e.clientY;
    canvas.style.cursor = 'grabbing';
  });

  // Release on window so a drag that wanders off the canvas still ends cleanly.
  addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    const wasDrag = dragMoved;
    dragging = false; dragMoved = false;
    canvas.style.cursor = '';
    // A press that never moved is a click — the gesture browsers want for
    // pointer lock. Only claim it when the press actually landed on the world,
    // never on an overlay (veil, letter, reading card) that owns its own click.
    if (!wasDrag && e.target === canvas &&
        !ctx.pointerLocked && !ctx.reading && !ctx.bridging) tryLock();
  });

  // Losing focus drops the lock silently; re-advertise how to get it back.
  addEventListener('blur', () => { if (!ctx.pointerLocked) lookHint(); });
}

function setupTouch() {
  const joy = document.getElementById('joy');
  const knob = joy.querySelector('.knob');
  const act = document.getElementById('act');
  const rect = () => {
    const r = joy.getBoundingClientRect();
    joyCenter.x = r.left + r.width / 2; joyCenter.y = r.top + r.height / 2;
    return r;
  };
  addEventListener('touchstart', (e) => {
    if (ctx.reading || ctx.bridging) return;
    for (const t of e.changedTouches) {
      const r = rect();
      if (t.clientX < innerWidth * 0.45 && t.clientY > innerHeight * 0.5 && joyTouch === null) {
        joyTouch = t.identifier;
      } else if (lookTouch === null) {
        lookTouch = t.identifier;
        lastLook.x = t.clientX; lastLook.y = t.clientY;
      }
    }
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (ctx.reading || ctx.bridging) return;
    for (const t of e.changedTouches) {
      if (t.identifier === joyTouch) {
        const dx = t.clientX - joyCenter.x, dy = t.clientY - joyCenter.y;
        const len = Math.min(Math.hypot(dx, dy), 46);
        const a = Math.atan2(dy, dx);
        knob.style.transform = `translate(calc(-50% + ${Math.cos(a) * len}px), calc(-50% + ${Math.sin(a) * len}px))`;
        ctx.moveInput.set(Math.cos(a) * (len / 46), -Math.sin(a) * (len / 46));
      } else if (t.identifier === lookTouch) {
        // Touch wants a coarser feel than the mouse.
        ctx.yaw -= (t.clientX - lastLook.x) * (ctx.lookSensitivity * 2.3);
        ctx.pitch = THREE.MathUtils.clamp(
          ctx.pitch - (t.clientY - lastLook.y) * (ctx.lookSensitivity * 2.3), -PITCH_LIMIT, PITCH_LIMIT);
        lastLook.x = t.clientX; lastLook.y = t.clientY;
      }
    }
  }, { passive: true });
  addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyTouch) {
        joyTouch = null; ctx.moveInput.set(0, 0);
        knob.style.transform = 'translate(-50%,-50%)';
      }
      if (t.identifier === lookTouch) lookTouch = null;
    }
  });
  act.addEventListener('touchstart', (e) => { e.stopPropagation(); interact(); }, { passive: true });
}

export function togglePerson() {
  ctx.thirdPerson = !ctx.thirdPerson;
  if (ctx.avatar) ctx.avatar.visible = ctx.thirdPerson;
  if (ctx.avatarLanternLight) ctx.avatarLanternLight.visible = ctx.thirdPerson;
}

export function readMoveInput() {
  if (!ctx.isTouch) {
    const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    ctx.moveInput.set(s, f);
    ctx.running = keys.has('ShiftLeft') || keys.has('ShiftRight');
  }
  if ((ctx.moveInput.x || ctx.moveInput.y) && ctx.sitting) stopSitting();
  return ctx.moveInput;
}

export function teardownControls() {
  keys.clear();
  if (document.pointerLockElement) {
    try { document.exitPointerLock(); } catch (_) {}
  }
}

