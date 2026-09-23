// ui/hud.js — the quiet interface: intro veil, drifting place cards,
// hint bar, and the reading card.
import { ctx } from '../core/ctx.js';

const $ = (id) => document.getElementById(id);
let placeTimer = null, hintSticky = false;

export function bindVeil(onEnter) {
  const veil = $('veil');
  veil.addEventListener('click', () => {
    if (veil.classList.contains('gone')) return;
    veil.classList.add('gone');
    onEnter();
  }, { once: false });
}

export function showPlace(name) {
  const card = $('place-card');
  card.querySelector('.name').textContent = name;
  card.classList.add('show');
  clearTimeout(placeTimer);
  placeTimer = setTimeout(() => card.classList.remove('show'), 4200);
}

export function showHint(html, sticky = false) {
  const bar = $('hint-bar');
  bar.innerHTML = html;
  bar.classList.add('show');
  hintSticky = sticky;
}
export function hideHint(force = false) {
  if (hintSticky && !force) return;
  hintSticky = false;
  $('hint-bar').classList.remove('show');
}

export function showRead(title, text) {
  ctx.reading = true;
  const card = $('read-card');
  card.querySelector('h3').textContent = title;
  card.querySelector('p').textContent = text;
  card.classList.add('show');
  if (document.pointerLockElement) document.exitPointerLock();
  setTimeout(() => {
    addEventListener('pointerdown', closeRead, { once: true });
    addEventListener('keydown', closeRead, { once: true });
  }, 250);
}
function closeRead() {
  $('read-card').classList.remove('show');
  setTimeout(() => { ctx.reading = false; }, 120);
}
