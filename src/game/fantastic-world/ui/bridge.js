// ui/bridge.js — "A Letter to the Keeper": a sheet of paper you hold up in
// front of you, write on, and send out of the world. The text travels to the
// artifact-system server (/api/bridge), where Claude reads it — so the world
// can be changed from inside the world.
//
// This is a client for the artifact-system's UNIVERSAL bridge feature: title,
// hotkey and cadence all come from the server config, so the same file drops
// into any artifact and is tuned centrally from the artifact-system UI.
//
// Cost discipline — a console left open all day should cost ~nothing:
//   · replies are polled with ETag → idle polls answer 304, empty body
//   · cadence backs off from pollMs to idlePollMs after a stretch of silence,
//     and snaps back to fast the moment anything is said
//   · polling stops entirely while the tab is hidden
import { ctx } from '../core/ctx.js';
import { hideHint } from './hud.js';

const PROJECT = 'fantastic-world';
// Port 4201 is the artifact/WS server. Host is derived from wherever this page
// was served, so it works on localhost, over the LAN, and inside the
// artifact-system iframe (opaque-origin srcdoc → hostname is '' → localhost).
const HOST = location.hostname || 'localhost';
const API = `http://${HOST}:4201/api/bridge`;
const Q = `?project=${encodeURIComponent(PROJECT)}`;

const cfg = {
  enabled: true,
  title: 'A Letter to the Keeper',
  subtitle: 'your words leave the hall',
  placeholder: 'Write what should change in this world…',
  hotkey: 'KeyT',
  pollMs: 4000,
  idlePollMs: 30000,
  maxChars: 4000,
};

let paper = null, sheet = null, field = null, status = null, log = null;
let lastReplyAt = new Date().toISOString();
let replyTag = null;         // ETag — lets the server answer 304 on idle
let replyTimer = null;
let quietSince = Date.now(); // drives the back-off
let statusTimer = null;

export async function setupBridge() {
  paper = document.getElementById('bridge');
  if (!paper) return;
  sheet = paper.querySelector('.sheet');
  field = paper.querySelector('textarea');
  status = paper.querySelector('.status');
  log = paper.querySelector('.log');

  await loadConfig();
  if (!cfg.enabled) return;

  paper.querySelector('.send').addEventListener('click', send);
  paper.querySelector('.dismiss').addEventListener('click', close);

  // Typing must never leak into the world (walking, interacting, pointer lock).
  field.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });

  // Global toggle. Capture phase so it fires before the movement handler.
  addEventListener('keydown', (e) => {
    if (ctx.reading) return;
    if (!ctx.bridging && e.code === cfg.hotkey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); open();
    } else if (ctx.bridging && e.key === 'Escape') {
      e.preventDefault(); close();
    }
  }, true);

  // A hidden tab has nobody reading it — stop spending requests on it.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(replyTimer);
    else { quietSince = Date.now(); schedulePoll(0); }
  });

  schedulePoll(0);
}

async function loadConfig() {
  try {
    const r = await fetch(`${API}/config${Q}`, { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (j && j.config) Object.assign(cfg, j.config);
  } catch (_) { /* server down → ship with the built-in defaults */ }
  // Config owns the copy, so the artifact-system can rebrand any artifact's
  // console without touching this file.
  paper.querySelector('h3').textContent = cfg.title;
  paper.querySelector('.sub').textContent = cfg.subtitle;
  field.placeholder = cfg.placeholder;
  field.maxLength = cfg.maxChars;
}

export function open() {
  if (ctx.bridging || !cfg.enabled) return;
  ctx.bridging = true;
  paper.classList.add('show');
  hideHint(true);   // clear the world's hint at once — don't fade under the page
  if (document.pointerLockElement) document.exitPointerLock();
  setStatus('the ink is ready', 'calm');
  quietSince = Date.now();
  schedulePoll(0);                       // catch up the moment it opens
  setTimeout(() => field.focus(), 420);  // after the page finishes unfurling
}

export function close() {
  if (!ctx.bridging) return;
  paper.classList.remove('show');
  field.blur();
  // Small delay so the Esc/click that closed it can't re-trigger the world.
  setTimeout(() => { ctx.bridging = false; }, 140);
}

function setStatus(msg, kind = 'calm', revertMs = 0) {
  clearTimeout(statusTimer);
  status.textContent = msg;
  status.className = 'status ' + kind;
  if (revertMs) statusTimer = setTimeout(() => setStatus('the ink is ready', 'calm'), revertMs);
}

async function send() {
  const text = field.value.trim();
  if (!text) { setStatus('the page is still blank', 'warn', 2400); return; }
  setStatus('sending…', 'calm');
  paper.classList.add('sending');
  setTimeout(() => paper.classList.remove('sending'), 520);
  try {
    const r = await fetch(API + Q, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, from: PROJECT }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    field.value = '';
    setStatus('sent — it left the hall', 'ok', 4000);
    addLine('you', text);
    quietSince = Date.now();   // conversation is warm → poll fast again
    schedulePoll(cfg.pollMs);
  } catch (e) {
    setStatus(`could not send: ${e.message}`, 'err');
  }
}

function addLine(who, text) {
  const line = document.createElement('div');
  line.className = 'line ' + who;
  line.textContent = (who === 'you' ? '✒ ' : '❧ ') + text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function schedulePoll(delay) {
  clearTimeout(replyTimer);
  replyTimer = setTimeout(pollReplies, delay);
}

// Claude writes back via POST /api/bridge/reply — those land here.
async function pollReplies() {
  if (document.hidden) return;                     // rescheduled on visibility
  try {
    const headers = replyTag ? { 'If-None-Match': replyTag } : {};
    const r = await fetch(`${API}/reply${Q}&since=${encodeURIComponent(lastReplyAt)}`, { headers });
    if (r.status !== 304 && r.ok) {
      const tag = r.headers.get('ETag');
      if (tag) replyTag = tag;
      const j = await r.json();
      for (const m of (j.messages || [])) {
        addLine('keeper', m.text);
        lastReplyAt = m.at;
        quietSince = Date.now();
        if (!ctx.bridging) setStatus(`the Keeper wrote back — press ${keyLabel()}`, 'ok');
      }
    }
  } catch (_) { /* server down: stay quiet, keep trying */ }
  // Warm conversation → fast. Long silence → slow down and stop burning cycles.
  const idle = Date.now() - quietSince > 120000;
  schedulePoll(idle ? cfg.idlePollMs : cfg.pollMs);
}

function keyLabel() {
  return cfg.hotkey.startsWith('Key') ? cfg.hotkey.slice(3) : cfg.hotkey;
}
