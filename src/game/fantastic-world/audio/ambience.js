// audio/ambience.js — generative calm: a slow warm pad (stacked detuned
// triangles through a breathing lowpass), soft wind noise, distant chimes.
// Zero assets; pure WebAudio. Starts only after the user's entry gesture.
import { ctx } from '../core/ctx.js';

let ac = null, master = null, padFilter = null;

const PAD_NOTES = [110, 164.81, 196, 246.94, 293.66]; // A2 E3 G3 B3 D4 — Aadd9-ish calm

export function startAmbience() {
  if (ac) return;
  ac = new (window.AudioContext || window.webkitAudioContext)();
  master = ac.createGain();
  master.gain.value = 0;
  master.connect(ac.destination);
  master.gain.linearRampToValueAtTime(0.5, ac.currentTime + 6);

  // ── pad ──
  padFilter = ac.createBiquadFilter();
  padFilter.type = 'lowpass'; padFilter.frequency.value = 420; padFilter.Q.value = 0.6;
  const padGain = ac.createGain(); padGain.gain.value = 0.16;
  padFilter.connect(padGain); padGain.connect(master);
  for (const f of PAD_NOTES) {
    for (const det of [-4, 3]) {
      const o = ac.createOscillator();
      o.type = 'triangle'; o.frequency.value = f; o.detune.value = det;
      const g = ac.createGain(); g.gain.value = 0.35 / PAD_NOTES.length;
      o.connect(g); g.connect(padFilter); o.start();
    }
  }
  // filter breath
  const lfo = ac.createOscillator(); lfo.frequency.value = 0.05;
  const lfoG = ac.createGain(); lfoG.gain.value = 190;
  lfo.connect(lfoG); lfoG.connect(padFilter.frequency); lfo.start();

  // ── wind (filtered noise, slow swell) ──
  const len = ac.sampleRate * 4;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource(); noise.buffer = buf; noise.loop = true;
  const nf = ac.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 300; nf.Q.value = 0.4;
  const ng = ac.createGain(); ng.gain.value = 0.05;
  noise.connect(nf); nf.connect(ng); ng.connect(master); noise.start();
  const wLfo = ac.createOscillator(); wLfo.frequency.value = 0.07;
  const wLfoG = ac.createGain(); wLfoG.gain.value = 0.028;
  wLfo.connect(wLfoG); wLfoG.connect(ng.gain); wLfo.start();

  // ── occasional distant chime ──
  const scheduleChime = () => {
    if (!ac) return;
    softBell(392 * [0.5, 1, 1.5, 2][(Math.random() * 4) | 0], 0.05, 6);
    setTimeout(scheduleChime, 9000 + Math.random() * 16000);
  };
  setTimeout(scheduleChime, 7000);

  ctx.audioReady = true;
}

function softBell(freq, vol, decay) {
  const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
  const h = ac.createOscillator(); h.type = 'sine'; h.frequency.value = freq * 2.76;
  const g = ac.createGain(); const hg = ac.createGain();
  g.gain.setValueAtTime(vol, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + decay);
  hg.gain.setValueAtTime(vol * 0.3, ac.currentTime);
  hg.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + decay * 0.5);
  o.connect(g); h.connect(hg); g.connect(master); hg.connect(master);
  o.start(); h.start();
  o.stop(ac.currentTime + decay + 0.1); h.stop(ac.currentTime + decay + 0.1);
}

// interaction feedback — tiny, kind sounds
export function chime(kind) {
  if (!ac) return;
  if (kind === 'read') softBell(523.25, 0.07, 2.2);
  else if (kind === 'spin') softBell(659.25, 0.06, 1.4);
  else softBell(440, 0.06, 1.8);
}

// crossfade the pad brighter indoors, windier outdoors
export function setOutdoorMix(outdoor) {
  if (!padFilter) return;
  const target = outdoor ? 320 : 460;
  padFilter.frequency.linearRampToValueAtTime(target, ac.currentTime + 1.5);
}

export function setMasterVolume(val) {
  if (!master || !ac) return;
  master.gain.setValueAtTime(Math.max(0, Math.min(1, val)), ac.currentTime);
}

export function stopAmbience() {
  if (!ac) return;
  try { ac.close(); } catch (_) {}
  ac = null;
  master = null;
  padFilter = null;
  ctx.audioReady = false;
}
