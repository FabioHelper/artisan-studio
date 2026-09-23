// player/avatar.js — a small hooded wanderer for third person: cloak, satchel,
// a lantern that answers the candle registry. Gentle walk bob, no rig needed.
import * as THREE from 'three';
import { ctx } from '../core/ctx.js';
import { P } from '../core/palette.js';

export function createAvatar() {
  const g = new THREE.Group();
  const cloakMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2a, roughness: 0.95 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd8b090, roughness: 0.8 });

  // cloak body (lathe-ish cone)
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.25, 12), cloakMat);
  body.position.y = 0.63;
  g.add(body);
  // head + hood
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), skinMat);
  head.position.y = 1.42;
  g.add(head);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12,
    0, Math.PI * 2, 0, Math.PI * 0.62), cloakMat);
  hood.position.y = 1.46; hood.rotation.x = -0.25;
  g.add(hood);
  // satchel
  const satchel = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.85 }));
  satchel.position.set(0.3, 0.75, 0.12); satchel.rotation.z = -0.2;
  g.add(satchel);
  // hand lantern
  const lampArm = new THREE.Group();
  const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.16, 8),
    new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.6 }));
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8),
    new THREE.MeshBasicMaterial({ color: P.candle }));
  const light = new THREE.PointLight(0xffc36e, 5, 6, 2);
  light.visible = false;
  lampArm.add(cage, glow, light);
  lampArm.position.set(-0.38, 0.85, 0.22);
  g.add(lampArm);
  ctx.candleLights.push({ light, flame: glow, base: 5, seed: 42.7, ampl: 0.14 });
  ctx.avatarLanternLight = light;

  g.visible = false;           // starts in first person
  ctx.avatar = g;

  // walk bob
  let phase = 0;
  ctx.animations.push((dt) => {
    const speed = ctx.velocity.length();
    phase += dt * (2 + speed * 2.2);
    const bob = speed > 0.2 ? Math.sin(phase * 3.2) * 0.035 : 0;
    g.position.y = bob;
    g.rotation.z = speed > 0.2 ? Math.sin(phase * 1.6) * 0.03 : 0;
  });
  return g;
}
