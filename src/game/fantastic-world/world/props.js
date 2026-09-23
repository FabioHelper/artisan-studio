// world/props.js — the artisan details: writing desk with an open book, globe,
// fireplace, chandelier, candle sconces, rolling ladder, clocks over the arch.
import * as THREE from 'three';
import { ctx } from '../core/ctx.js';
import { P } from '../core/palette.js';
import { HALL, NOOK } from './hall.js';

const wood = new THREE.MeshStandardMaterial({ color: P.wood, roughness: 0.8 });
const darkWood = new THREE.MeshStandardMaterial({ color: P.woodDark, roughness: 0.8 });
const brass = new THREE.MeshStandardMaterial({ color: P.brass, roughness: 0.35, metalness: 0.7 });
const page = new THREE.MeshStandardMaterial({ color: P.pageCream, roughness: 0.95 });
const flameMat = new THREE.MeshBasicMaterial({ color: P.candle });

function candle(x, y, z, scale = 1, withLight = true) {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.34, 10), page);
  stick.position.y = 0.17;
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), flameMat);
  flame.scale.set(1, 1.7, 1); flame.position.y = 0.41;
  let light = null;
  if (withLight) {
    light = new THREE.PointLight(P.candle, 8, 7, 2);
    light.position.y = 0.5;
    g.add(light);
  }
  g.add(stick, flame);
  g.position.set(x, y, z); g.scale.setScalar(scale);
  ctx.candleLights.push({ light, flame, base: 8 * scale, seed: Math.random() * 100 });
  return g;
}

export function createProps() {
  const g = new THREE.Group();
  const HD = HALL.d / 2, HW = HALL.w / 2;

  // ── writing desk (west-centre), open book = readable ──
  const desk = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.1, 1.35), wood);
  top.position.y = 1.06;
  desk.add(top);
  for (const [dx, dz] of [[-1.1, -0.55], [1.1, -0.55], [-1.1, 0.55], [1.1, 0.55]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 1.02, 8), darkWood);
    leg.position.set(dx, 0.51, dz);
    desk.add(leg);
  }
  const book = new THREE.Group();
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.05, 0.62),
    new THREE.MeshStandardMaterial({ color: 0x6b2f2a, roughness: 0.7 }));
  const pages = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.07, 0.56), page);
  pages.position.y = 0.05;
  book.add(cover, pages);
  book.position.set(0.15, 1.11, 0.05); book.rotation.y = -0.35;
  desk.add(book);
  desk.add(candle(-0.85, 1.11, -0.3));
  desk.position.set(-HW + 2.6, 0, 2.2); desk.rotation.y = Math.PI / 2.6;
  g.add(desk);
  ctx.colliders.push({ x: -HW + 2.6, z: 2.2, r: 1.5 });
  pages.userData.interact = {
    label: 'read the open book', kind: 'read',
    title: 'From the Keeper’s Journal',
    text: 'They ask what this hall is for, and I tell them: nothing urgent. ' +
      'The shelves keep every evening you thought you had lost — the rain on the bus window, ' +
      'your grandmother’s kitchen, the game you played until the screen went soft. ' +
      'Walk slowly. The moons rise on their own schedule, and so, at last, may you.',
  };
  pages.position.y += 0; // world-matrix computed at runtime
  ctx.interactables.push(pages);

  // ── globe (east-centre) ──
  const globe = new THREE.Group();
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.14, 16), darkWood);
  stand.position.y = 0.07;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8), brass);
  post.position.y = 0.55;
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.44, 24, 18),
    new THREE.MeshStandardMaterial({ color: 0x27585e, roughness: 0.5, metalness: 0.15,
      emissive: 0x0a2a30, emissiveIntensity: 0.5 }));
  orb.position.y = 1.28;
  globe.add(stand, post, orb);
  globe.position.set(HW - 3.0, 0, -3.4);
  g.add(globe);
  ctx.colliders.push({ x: HW - 3.0, z: -3.4, r: 0.75 });
  orb.userData.interact = {
    label: 'spin the dream globe', kind: 'spin', target: orb,
  };
  ctx.interactables.push(orb);
  ctx.animations.push((dt) => { orb.rotation.y += dt * (orb.userData.spinBoost || 0.06);
    if (orb.userData.spinBoost > 0.06) orb.userData.spinBoost *= (1 - dt * 0.6); });

  // ── fireplace (west wall, north half) ──
  const hearth = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x5a5049, roughness: 0.95 });
  const mantel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.4, 2.6), stone);
  mantel.position.set(0, 1.2, 0);
  const mantelTop = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 3.0), darkWood);
  mantelTop.position.set(0, 2.47, 0);
  const cavity = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.3, 1.6),
    new THREE.MeshBasicMaterial({ color: 0x120a06 }));
  cavity.position.set(0.25, 0.65, 0);
  hearth.add(mantel, mantelTop, cavity);
  const ember = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1),
    new THREE.MeshBasicMaterial({ color: P.emberGlow }));
  ember.scale.set(1.6, 0.55, 1.2); ember.position.set(0.32, 0.22, 0);
  hearth.add(ember);
  const fire = new THREE.PointLight(P.emberGlow, 26, 12, 2);
  fire.position.set(0.5, 0.8, 0);
  hearth.add(fire);
  ctx.candleLights.push({ light: fire, flame: ember, base: 26, seed: 7.3, ampl: 0.28 });
  hearth.position.set(-HW + 0.9, 0, -6.5);
  g.add(hearth);
  ctx.colliders.push({ x: -HW + 1.1, z: -6.5, r: 1.7 });

  // armchair facing the fire
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x54383f, roughness: 0.95 });
  const chair = new THREE.Group();
  const seatC = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 1.0), chairMat);
  seatC.position.y = 0.45;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.15, 1.0), chairMat);
  back.position.set(0.55, 0.9, 0);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.18), chairMat);
    arm.position.set(0, 0.8, s * 0.45);
    chair.add(arm);
  }
  chair.add(seatC, back);
  chair.position.set(-HW + 3.6, 0, -6.3); chair.rotation.y = Math.PI + 0.35;
  g.add(chair);
  ctx.colliders.push({ x: -HW + 3.6, z: -6.3, r: 0.9 });
  seatC.userData.interact = {
    label: 'rest by the fire', kind: 'sit',
    pos: new THREE.Vector3(-HW + 3.6, 0, -6.3),
    lookAt: new THREE.Vector3(-HW + 0.9, 1.2, -6.5),
  };
  ctx.interactables.push(seatC);

  // ── chandelier: brass ring with candles ──
  const chand = new THREE.Group();
  const cRing = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.07, 10, 32), brass);
  cRing.rotation.x = Math.PI / 2;
  chand.add(cRing);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    chand.add(candle(Math.cos(a) * 1.5, 0.05, Math.sin(a) * 1.5, 0.9, false));
  }
  // Central chandelier illumination point light
  const chandLight = new THREE.PointLight(P.candle, 24, 16, 1.8);
  chandLight.position.set(0, 0.3, 0);
  chand.add(chandLight);
  ctx.candleLights.push({ light: chandLight, flame: null, base: 24, seed: 42, ampl: 0.12 });

  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.6, 6), brass);
  chain.position.y = 1.3;
  chand.add(chain);
  chand.position.set(0, HALL.h - 3.2, 0);
  g.add(chand);
  ctx.animations.push((dt, t) => { chand.rotation.y = Math.sin(t * 0.11) * 0.05; });

  // ── sconce candles along shelf posts ──
  for (const side of [-1, 1]) {
    for (const z of [-8, -2.5, 3, 8.5]) {
      g.add(candle(side * (HW - 0.95), 2.6, z, 1.05, false));
    }
  }

  // ── rolling ladder (east shelves) ──
  const ladder = new THREE.Group();
  const railGeo = new THREE.CylinderGeometry(0.035, 0.035, 5.6, 8);
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, darkWood);
    rail.position.set(s * 0.26, 2.8, 0);
    ladder.add(rail);
  }
  for (let i = 0; i < 9; i++) {
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.52, 8), wood);
    rung.rotation.z = Math.PI / 2;
    rung.position.y = 0.5 + i * 0.6;
    ladder.add(rung);
  }
  ladder.position.set(HW - 0.85, 0, 4.4);
  ladder.rotation.y = -Math.PI / 2;
  ladder.rotation.x = -0.16;
  g.add(ladder);
  ctx.colliders.push({ x: HW - 0.95, z: 4.4, r: 0.55 });

  // ── clocks above the north arch (image 5); the middle one is the
  // clock-window — larger, translucent teal, garden light reads through ──
  const clockWindowMat = new THREE.MeshStandardMaterial({
    color: P.skyGlow, transparent: true, opacity: 0.5, roughness: 0.2,
    metalness: 0, side: THREE.DoubleSide,
  });
  for (const [cx, r] of [[-2.1, 0.5], [0, 0.9], [2.1, 0.5]]) {
    const faceMat = cx === 0 ? clockWindowMat : page;
    const face = new THREE.Mesh(new THREE.CircleGeometry(r, 28), faceMat);
    face.position.set(cx, 6.3, -HD + 0.09);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 8, 28), brass);
    rim.position.copy(face.position);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.035, r * 0.72, 0.02), darkWood);
    hand.geometry.translate(0, r * 0.36, 0);
    hand.position.set(cx, 6.3, -HD + 0.1);
    hand.rotation.z = Math.random() * Math.PI * 2;
    g.add(face, rim, hand);
    ctx.animations.push((dt) => { hand.rotation.z -= dt * 0.02; });
  }

  // ── pastel rainbow arc over the reading nook (image batch 2b) ──
  const rainbowColors = [0xe89aa0, 0xeab08a, 0xe8d28a, 0xa8d9a0, 0x9ccbd9, 0x9aa8d9, 0xb99ad9];
  rainbowColors.forEach((hex, i) => {
    const r = 1.15 + i * 0.15;
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.032, 8, 32, Math.PI),
      new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.5, roughness: 0.6 }));
    arc.position.set(NOOK.x, 1.55, NOOK.z - 0.95);
    g.add(arc);
  });

  // ── greenhouse terrarium (image batch 2c) — east side, clear of the hearth ──
  const terrariumPos = { x: 8.5, z: -9 };
  const terrarium = new THREE.Group();
  const standT = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.55), darkWood);
  standT.position.y = 0.275;
  terrarium.add(standT);
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xbfe0e0, transparent: true, opacity: 0.35, roughness: 0.08,
    metalness: 0.1, side: THREE.DoubleSide,
  });
  const glassY = 0.275 + 0.43 + 0.02;
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.86, 0.5), glassMat);
  glass.position.y = glassY;
  terrarium.add(glass);
  const postGeo = new THREE.BoxGeometry(0.04, 0.86, 0.04);
  for (const [px, pz] of [[-0.41, -0.25], [0.41, -0.25], [-0.41, 0.25], [0.41, 0.25]]) {
    const post = new THREE.Mesh(postGeo, brass);
    post.position.set(px, glassY, pz);
    terrarium.add(post);
  }
  const flowerColors = [0xe89aa0, 0xf4d27a, 0xb99ad9, 0x9ccbd9, 0xe8d28a, 0xa8d9a0];
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x3a6b4a, roughness: 0.8 });
  const flowerBaseY = 0.275 + 0.06;
  for (let i = 0; i < 6; i++) {
    const fx = (Math.random() - 0.5) * 0.55, fz = (Math.random() - 0.5) * 0.3;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 5), stemMat);
    stem.position.set(fx, flowerBaseY + 0.06, fz);
    terrarium.add(stem);
    const hex = flowerColors[i % flowerColors.length];
    const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6),
      new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.45 }));
    bloom.position.set(fx, flowerBaseY + 0.12, fz);
    terrarium.add(bloom);
  }
  const butterflyMat = new THREE.MeshStandardMaterial({
    color: 0xf4c542, emissive: 0xf4c542, emissiveIntensity: 0.4, side: THREE.DoubleSide, roughness: 0.6 });
  const wingGeo = new THREE.PlaneGeometry(0.05, 0.04);
  for (let i = 0; i < 3; i++) {
    const bfly = new THREE.Group();
    const wingL = new THREE.Mesh(wingGeo, butterflyMat); wingL.position.x = -0.022;
    const wingR = new THREE.Mesh(wingGeo, butterflyMat); wingR.position.x = 0.022;
    bfly.add(wingL, wingR);
    terrarium.add(bfly);
    const baseY = flowerBaseY + 0.25 + Math.random() * 0.12;
    const seed = Math.random() * 10;
    const ax = 0.22, az = 0.12, f1 = 0.6 + Math.random() * 0.2, f2 = 0.9 + Math.random() * 0.3;
    ctx.animations.push((dt, t) => {
      const flap = Math.sin(t * 14 + seed) * 0.9;
      wingL.rotation.y = flap; wingR.rotation.y = -flap;
      bfly.position.set(Math.sin(t * f1 + seed) * ax, baseY + Math.sin(t * 2.3 + seed) * 0.015, Math.cos(t * f2 + seed * 1.3) * az);
    });
  }
  terrarium.position.set(terrariumPos.x, 0, terrariumPos.z);
  g.add(terrarium);
  ctx.colliders.push({ x: terrariumPos.x, z: terrariumPos.z, r: 0.6 });
  glass.userData.interact = {
    label: 'read about the terrarium', kind: 'read',
    title: 'The Terrarium',
    text: 'Someone smaller than the hall keeps this glass case: six blooms that never wilt, ' +
      'three butterflies that never tire. Watch long enough and you forget which is which — ' +
      'the wings drifting like petals, the petals glowing like something with wings.',
  };
  ctx.interactables.push(glass);

  return g;
}
