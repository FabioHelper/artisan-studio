// interaction/interaction.js — the reticle's reach: raycast focus, glow
// highlight, and the three verbs of a calm world — sit, read, spin.
import * as THREE from 'three';
import { ctx } from '../core/ctx.js';
import { showHint, hideHint, showRead } from '../ui/hud.js';
import { chime } from '../audio/ambience.js';

const raycaster = new THREE.Raycaster();
raycaster.far = 5.5;
const centre = new THREE.Vector2(0, 0);
let sitReturn = null;

export function checkFocus() {
  if (ctx.reading || ctx.sitting || ctx.bridging) { setFocus(null); return; }
  raycaster.setFromCamera(centre, ctx.camera);
  const hits = raycaster.intersectObjects(ctx.interactables, false);
  setFocus(hits.length ? hits[0].object : null);
}

function setFocus(obj) {
  if (ctx.focus === obj) return;
  if (ctx.focus) glow(ctx.focus, false);
  ctx.focus = obj;
  if (obj) {
    glow(obj, true);
    const key = ctx.isTouch ? '🖐️' : 'E';
    showHint(`<b>${key}</b> &nbsp;${obj.userData.interact.label}`);
  } else hideHint();
}

function glow(obj, on) {
  const m = obj.material;
  if (!m || !m.emissive) return;
  if (on) {
    obj.userData._e0 = m.emissive.getHex();
    obj.userData._ei0 = m.emissiveIntensity;
    m.emissive.setHex(0xd9a86c); m.emissiveIntensity = 0.35;
  } else {
    m.emissive.setHex(obj.userData._e0 ?? 0x000000);
    m.emissiveIntensity = obj.userData._ei0 ?? 1;
  }
}

export function interact() {
  if (ctx.reading) return;
  if (ctx.sitting) { stopSitting(); return; }
  const obj = ctx.focus;
  if (!obj) return;
  const it = obj.userData.interact;
  chime(it.kind);
  if (it.kind === 'read') {
    showRead(it.title, it.text);
  } else if (it.kind === 'spin') {
    (it.target || obj).userData.spinBoost = 3.2;
  } else if (it.kind === 'sit') {
    sitReturn = ctx.player.position.clone();
    ctx.sitting = true;
    ctx.player.position.set(it.pos.x, it.pos.y, it.pos.z);
    const d = it.lookAt.clone().sub(new THREE.Vector3(it.pos.x, it.pos.y + 1.5, it.pos.z));
    ctx.yaw = Math.atan2(-d.x, -d.z);
    ctx.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) * 0.6;
    showHint(ctx.isTouch ? '<b>🖐️</b>&nbsp; stand up' : '<b>E</b>&nbsp; or move to stand up', true);
  }
}

export function stopSitting() {
  if (!ctx.sitting) return;
  ctx.sitting = false;
  if (sitReturn) ctx.player.position.copy(sitReturn);
  hideHint(true);
}
