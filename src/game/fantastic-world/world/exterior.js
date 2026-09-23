// world/exterior.js — the dream garden: snowy meadow, lantern-lit path from the
// hall door to a still mirror-pond, instanced snow pines, and the Luminous
// Stairs descending toward a sea of light (reference images 1 & 5).
import * as THREE from 'three';
import { ctx } from '../core/ctx.js';
import { P } from '../core/palette.js';
import { HALL } from './hall.js';
import { glowTex } from './sky.js';

const HD = HALL.d / 2, HW = HALL.w / 2;

export function createExterior() {
  const g = new THREE.Group();
  g.name = 'DreamGarden';

  // ── ground: gently undulating snow ──
  const groundGeo = new THREE.PlaneGeometry(130, 130, 64, 64);
  const gp = groundGeo.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), y = gp.getY(i);           // plane local (x, y) -> world (x, -z)
    const d = Math.hypot(x, y);
    let h = Math.sin(x * 0.08) * Math.cos(y * 0.07) * 0.55 + Math.sin(x * 0.021 + 3) * 1.1;
    h *= THREE.MathUtils.smoothstep(d, 6, 26);      // flat near the hall
    gp.setZ(i, h);
  }
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo,
    new THREE.MeshStandardMaterial({ color: P.snow, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  g.add(ground);

  // ── stone path: door → pond ──
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8fa0ad, roughness: 0.9 });
  const stoneGeo = new THREE.CylinderGeometry(0.55, 0.6, 0.12, 7);
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const x = Math.sin(t * 2.6) * 2.2;
    const z = -HD - 1.6 - t * 22;
    const s = new THREE.Mesh(stoneGeo, stoneMat);
    s.position.set(x + (Math.random() - 0.5) * 0.3, 0.05, z);
    s.rotation.y = Math.random() * Math.PI;
    s.scale.setScalar(0.85 + Math.random() * 0.35);
    g.add(s);
  }

  // ── mirror pond with drowned moon ──
  const pondZ = -HD - 27.5;
  const pond = new THREE.Mesh(new THREE.CircleGeometry(6.4, 48),
    new THREE.MeshStandardMaterial({ color: P.water, roughness: 0.12, metalness: 0.55,
      emissive: 0x113a44, emissiveIntensity: 0.7 }));
  pond.rotation.x = -Math.PI / 2; pond.position.set(1.2, 0.05, pondZ);
  g.add(pond);
  const pondMoon = new THREE.Mesh(new THREE.CircleGeometry(2.1, 32),
    new THREE.MeshBasicMaterial({ color: P.moon, transparent: true, opacity: 0.5 }));
  pondMoon.rotation.x = -Math.PI / 2; pondMoon.position.set(-0.4, 0.07, pondZ - 1.2);
  g.add(pondMoon);
  ctx.animations.push((dt, t) => {
    pondMoon.material.opacity = 0.42 + Math.sin(t * 0.7) * 0.08;
    pond.material.emissiveIntensity = 0.62 + Math.sin(t * 0.5 + 1) * 0.12;
  });
  ctx.colliders.push({ x: 1.2, z: pondZ, r: 6.6 });

  // ── the Luminous Stairs (east of pond, descending to the sea of light) ──
  const stairG = new THREE.Group();
  const stepMat = new THREE.MeshStandardMaterial({ color: 0xaab7c4, roughness: 0.8 });
  for (let i = 0; i < 9; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.3, 1.15), stepMat);
    step.position.set(0, -i * 0.34, -i * 1.05);
    stairG.add(step);
  }
  const seaGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex(), color: 0x9fe8dc, transparent: true, opacity: 0.85,
    depthWrite: false, blending: THREE.AdditiveBlending }));
  seaGlow.scale.set(26, 10, 1);
  seaGlow.position.set(0, -2.2, -13);
  stairG.add(seaGlow);
  ctx.animations.push((dt, t) => { seaGlow.material.opacity = 0.7 + Math.sin(t * 0.8) * 0.15; });
  stairG.position.set(16.5, 0.15, pondZ + 2.5);
  stairG.rotation.y = -0.5;
  g.add(stairG);
  // gate the descent (keep-out ring so the player can approach but not fall forever)
  ctx.colliders.push({ x: 16.5, z: pondZ + 0.5, r: 2.4 });

  // ornate portal ring at the stair head (image batch 2d) — the stairs pass
  // through it; hole-axis matches the stair's descent yaw
  const portal = new THREE.Group();
  const ringMat = new THREE.MeshStandardMaterial({ color: P.brass, roughness: 0.4, metalness: 0.65 });
  const portalRing = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.22, 16, 48), ringMat);
  portal.add(portalRing);
  const runeMat = new THREE.MeshStandardMaterial({
    color: 0xffb35c, emissive: 0xffb35c, emissiveIntensity: 0.6, roughness: 0.5 });
  const runeGeo = new THREE.BoxGeometry(0.16, 0.16, 0.1);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rune = new THREE.Mesh(runeGeo, runeMat);
    rune.position.set(Math.cos(a) * 2.6, Math.sin(a) * 2.6, 0);
    rune.rotation.z = a;
    portal.add(rune);
  }
  const portalGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex(), color: 0xe8b87a, transparent: true, opacity: 0.6,
    depthWrite: false, blending: THREE.AdditiveBlending }));
  portalGlow.scale.set(6, 6, 1);
  portalGlow.position.set(0, 0, -0.6);
  portal.add(portalGlow);
  // steady sunset-warm light — deliberately NOT registered in ctx.candleLights (no flicker)
  const portalLight = new THREE.PointLight(P.horizonWarm, 22, 14, 2);
  portalLight.position.set(0, 0, 0.3);
  portal.add(portalLight);
  ctx.animations.push((dt, t) => { portalGlow.material.opacity = 0.5 + Math.sin(t * 0.4) * 0.08; });
  portal.position.set(16.5, 2.75, pondZ + 2.5);
  portal.rotation.y = stairG.rotation.y;
  g.add(portal);

  // ── snow pines: layered-cone instanced forest ──
  pines(g);

  // ── lantern posts along the path ──
  const posts = [[-2.6, -HD - 5], [3.2, -HD - 11], [-2.2, -HD - 18], [3.6, -HD - 24]];
  posts.forEach(([x, z], idx) => {
    const post = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.7 }));
    pole.position.y = 1.3;
    const cage = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.42),
      new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.6 }));
    cage.position.y = 2.75;
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10),
      new THREE.MeshBasicMaterial({ color: P.candle }));
    glow.position.y = 2.75;
    post.add(pole, cage, glow);

    // Consolidate path illumination into 2 balanced trail lights
    let light = null;
    if (idx === 0 || idx === 2) {
      light = new THREE.PointLight(0xffc36e, 22, 14, 2);
      light.position.y = 2.8;
      post.add(light);
    }
    post.position.set(x, 0, z);
    g.add(post);
    ctx.candleLights.push({ light, flame: glow, base: 22, seed: x * 3.1 + z, ampl: 0.1 });
    ctx.colliders.push({ x, z, r: 0.4 });
  });

  // ── hall facade seen from outside — REAL opening aligned with the doorway
  // (three segments: left / right / lintel), so the arch reads both ways:
  // garden visible from inside, warm hall light spilling out at night.
  const facadeMat = new THREE.MeshStandardMaterial({ color: 0x4e4438, roughness: 0.9 });
  const fh = HALL.h + 1.6, fw = HALL.w + 2.4, doorW = 3.4, doorH = 4.8;
  const sideW = (fw - doorW) / 2;
  for (const s of [-1, 1]) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(sideW, fh, 1.0), facadeMat);
    seg.position.set(s * (doorW / 2 + sideW / 2), fh / 2 - 0.02, -HD - 0.95);
    g.add(seg);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorW, fh - doorH, 1.0), facadeMat);
  lintel.position.set(0, doorH + (fh - doorH) / 2 - 0.02, -HD - 0.95);
  g.add(lintel);
  const doorGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex(), color: 0xffb35c, transparent: true, opacity: 0.35,
    depthWrite: false, blending: THREE.AdditiveBlending }));
  doorGlow.scale.set(6, 5, 1); doorGlow.position.set(0, 2.4, -HD - 1.8);
  g.add(doorGlow);
  // roof hint
  const roof = new THREE.Mesh(new THREE.ConeGeometry(HALL.w * 0.82, 3.6, 4), facadeMat);
  roof.rotation.y = Math.PI / 4;
  roof.position.set(0, HALL.h + 3.3, -HD - 0.4);
  roof.scale.z = 0.32;
  g.add(roof);

  ctx.exterior = g;
  return g;
}

function pines(g) {
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1.6, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.9 });
  const layerGeo = new THREE.ConeGeometry(1, 1, 8);
  const pineMat = new THREE.MeshStandardMaterial({ color: P.pine, roughness: 0.9 });
  const snowMat = new THREE.MeshStandardMaterial({ color: P.pineSnow, roughness: 0.95 });

  const spots = [];
  const path = (x, z) => Math.abs(x - Math.sin(((-z - HD - 1.6) / 22) * 2.6) * 2.2) < 3.4 && z < -HD - 1 && z > -HD - 26;
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 16 + Math.random() * 42;
    const x = Math.cos(a) * r, z = Math.sin(a) * r - 6;
    if (z > -HD + 4 && Math.abs(x) < HW + 6) continue;      // not inside/behind hall
    if (path(x, z)) continue;                                // keep the path clear
    if (Math.hypot(x - 1.2, z + HD + 27.5) < 8.5) continue;  // keep pond clear
    if (Math.hypot(x - 16.5, z + HD + 25) < 6) continue;     // keep stairs clear
    spots.push({ x, z, s: 0.75 + Math.random() * 1.3, rot: Math.random() * Math.PI });
  }

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const green = new THREE.InstancedMesh(layerGeo, pineMat, spots.length * 3);
  const caps = new THREE.InstancedMesh(layerGeo, snowMat, spots.length * 3);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  const e = new THREE.Euler();
  let gi = 0;
  spots.forEach((sp, i) => {
    e.set(0, sp.rot, 0); q.setFromEuler(e);
    pv.set(sp.x, 0.8 * sp.s, sp.z); sv.set(sp.s, sp.s, sp.s);
    m.compose(pv, q, sv); trunks.setMatrixAt(i, m);
    for (let L = 0; L < 3; L++) {
      const lr = (2.1 - L * 0.55) * sp.s;
      const lh = (2.0 - L * 0.25) * sp.s;
      const ly = (1.4 + L * 1.35) * sp.s + lh / 2;
      pv.set(sp.x, ly, sp.z); sv.set(lr, lh, lr);
      m.compose(pv, q, sv);
      green.setMatrixAt(gi, m);
      // snow cap: slightly smaller cone sitting on top of each layer
      pv.y += lh * 0.18; sv.set(lr * 0.82, lh * 0.72, lr * 0.82);
      m.compose(pv, q, sv);
      caps.setMatrixAt(gi, m);
      gi++;
    }
    ctx.colliders.push({ x: sp.x, z: sp.z, r: 0.65 * sp.s });
  });
  trunks.instanceMatrix.needsUpdate = green.instanceMatrix.needsUpdate = caps.instanceMatrix.needsUpdate = true;
  g.add(trunks, green, caps);
}
