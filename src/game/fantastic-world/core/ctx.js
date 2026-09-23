// core/ctx.js — shared engine context (pattern proven by the arcane_room
// modularization, projects/fantastic-world). One mutable carrier, no globals.
import * as THREE from 'three';

export const ctx = {
  // engine
  scene: null, camera: null, renderer: null, composer: null, clock: new THREE.Clock(),

  // player
  player: null,           // THREE.Group — feet at y=0
  avatar: null,           // visible body (third person)
  thirdPerson: false,
  yaw: 0, pitch: 0,
  velocity: new THREE.Vector3(),
  moveInput: new THREE.Vector2(),   // x: strafe, y: forward (-1..1)
  running: false,
  onGround: true,

  // world
  hall: null,             // interior group
  exterior: null,         // exterior group
  colliders: [],          // { x, z, r } circle colliders
  walls: [],              // { minX, maxX, minZ, maxZ } AABB keep-out (thin walls)
  bounds: { minX: -58, maxX: 58, minZ: -58, maxZ: 58 },
  interactables: [],      // meshes with userData.interact
  doorway: { x: 0, z: -11.4, halfW: 1.6 },  // hall <-> exterior opening (north wall)

  // animation registry — fns(dt, t) called each frame
  animations: [],

  // input
  isTouch: false,
  pointerLocked: false,

  // fx
  candleLights: [],
  moon: null,

  // audio
  audioReady: false,

  // ui
  focus: null,            // interactable currently under reticle
  reading: false,
  bridging: false,        // the Keeper's letter (dev bridge console) is open
};

export function resetCtx() {
  ctx.colliders.length = 0;
  ctx.walls.length = 0;
  ctx.interactables.length = 0;
  ctx.animations.length = 0;
  ctx.candleLights.length = 0;
}

