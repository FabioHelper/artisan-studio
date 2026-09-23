// fx/particles.js — the living air: golden dust motes indoors, fireflies and
// slow snow outside. All GPU-cheap Points with tiny CPU drift.
import * as THREE from 'three';
import { ctx } from '../core/ctx.js';
import { P } from '../core/palette.js';
import { HALL } from '../world/hall.js';

function makePoints(n, color, size, opacity) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const mat = new THREE.PointsMaterial({
    color, size, transparent: true, opacity,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  return new THREE.Points(geo, mat);
}

export function createParticles() {
  const g = new THREE.Group();
  const HD = HALL.d / 2;

  // ── dust motes in the hall ──
  const ND = 160;
  const dust = makePoints(ND, 0xffe0b0, 0.045, 0.55);
  const dp = dust.geometry.attributes.position.array;
  const dv = [];
  for (let i = 0; i < ND; i++) {
    dp[i * 3] = (Math.random() - 0.5) * (HALL.w - 2);
    dp[i * 3 + 1] = 0.4 + Math.random() * (HALL.h - 1.5);
    dp[i * 3 + 2] = (Math.random() - 0.5) * (HALL.d - 2);
    dv.push(Math.random() * Math.PI * 2);
  }
  g.add(dust);

  // ── fireflies in the garden ──
  const NF = 70;
  const flies = makePoints(NF, P.firefly, 0.14, 0.9);
  const fp = flies.geometry.attributes.position.array;
  const fseed = [];
  for (let i = 0; i < NF; i++) {
    fp[i * 3] = (Math.random() - 0.5) * 70;
    fp[i * 3 + 1] = 0.5 + Math.random() * 3.2;
    fp[i * 3 + 2] = -HD - 2 - Math.random() * 34;
    fseed.push(Math.random() * 100);
  }
  g.add(flies);

  // ── slow snowfall ──
  const NS = 420;
  const snow = makePoints(NS, 0xe8f2f8, 0.09, 0.7);
  snow.material.blending = THREE.NormalBlending;
  const sp = snow.geometry.attributes.position.array;
  for (let i = 0; i < NS; i++) {
    sp[i * 3] = (Math.random() - 0.5) * 110;
    sp[i * 3 + 1] = Math.random() * 30;
    sp[i * 3 + 2] = -HD + 10 - Math.random() * 80;
  }
  g.add(snow);

  ctx.animations.push((dt, t) => {
    for (let i = 0; i < ND; i++) {
      dp[i * 3] += Math.sin(t * 0.35 + dv[i]) * dt * 0.05;
      dp[i * 3 + 1] += Math.cos(t * 0.22 + dv[i] * 2.1) * dt * 0.04;
      dp[i * 3 + 2] += Math.sin(t * 0.28 + dv[i] * 0.7) * dt * 0.05;
    }
    dust.geometry.attributes.position.needsUpdate = true;

    for (let i = 0; i < NF; i++) {
      const s = fseed[i];
      fp[i * 3] += Math.sin(t * 0.7 + s) * dt * 0.5;
      fp[i * 3 + 1] += Math.cos(t * 0.9 + s * 1.3) * dt * 0.3;
      fp[i * 3 + 2] += Math.cos(t * 0.5 + s * 0.7) * dt * 0.5;
    }
    flies.geometry.attributes.position.needsUpdate = true;
    flies.material.opacity = 0.65 + Math.sin(t * 2.2) * 0.25;

    for (let i = 0; i < NS; i++) {
      sp[i * 3 + 1] -= dt * (0.55 + (i % 5) * 0.11);
      sp[i * 3] += Math.sin(t * 0.6 + i) * dt * 0.18;
      if (sp[i * 3 + 1] < 0) sp[i * 3 + 1] = 26 + Math.random() * 4;
    }
    snow.geometry.attributes.position.needsUpdate = true;
  });

  return g;
}
