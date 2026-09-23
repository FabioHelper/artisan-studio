// fx/lighting.js — two intertwined rigs: warm candlelit interior, cool
// moonlit exterior; plus the bloom composer that gives flames their halo.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ctx } from '../core/ctx.js';
import { P } from '../core/palette.js';
import { HALL } from '../world/hall.js';

export function setupLighting() {
  const s = ctx.scene;

  // base ambience — cool night fill, low
  s.add(new THREE.AmbientLight(0x2a3548, 0.9));
  const hemi = new THREE.HemisphereLight(0x35506b, 0x241a12, 0.55);
  s.add(hemi);

  // moonlight — main shadow caster, aimed across the garden
  const moon = new THREE.DirectionalLight(0xbcd4e0, 1.15);
  moon.position.set(-40, 60, -120);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  const sc = moon.shadow.camera;
  sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.far = 260;
  moon.shadow.bias = -0.0004;
  s.add(moon);

  // warm interior key — soft glow filling the hall from the chandelier zone
  const hallGlow = new THREE.PointLight(0xffc98a, 30, 26, 1.8);
  hallGlow.position.set(0, HALL.h - 3.0, 0);
  s.add(hallGlow);

  // moon-window shaft: cool light spilling through the circular window
  const shaft = new THREE.SpotLight(0x9fd8e0, 60, 40, 0.5, 0.55, 1.6);
  shaft.position.set(0, 5.5, HALL.d / 2 + 8);
  shaft.target.position.set(0, 0.6, 2);
  s.add(shaft, shaft.target);

  // candle flicker — one registry, organic per-seed waver
  ctx.animations.push((dt, t) => {
    for (const c of ctx.candleLights) {
      const a = c.ampl ?? 0.18;
      const f = 1 + Math.sin(t * 9 + c.seed) * a * 0.5
                  + Math.sin(t * 23 + c.seed * 1.7) * a * 0.35
                  + Math.sin(t * 5.2 + c.seed * 0.6) * a * 0.15;
      if (c.light) c.light.intensity = c.base * f;
      if (c.flame) {
        const sBase = c.flame.userData.s0 ?? (c.flame.userData.s0 = c.flame.scale.x);
        c.flame.scale.x = c.flame.scale.z = sBase * (0.92 + f * 0.08);
      }
    }
  });
}

export function setupPost() {
  const composer = new EffectComposer(ctx.renderer);
  composer.addPass(new RenderPass(ctx.scene, ctx.camera));
  // Half-resolution bloom: soft cinematic glow with 4x fill-rate savings on iGPU
  const bloomW = Math.max(256, Math.round(window.innerWidth / 2));
  const bloomH = Math.max(256, Math.round(window.innerHeight / 2));
  const bloom = new UnrealBloomPass(new THREE.Vector2(bloomW, bloomH), 0.55, 0.75, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  ctx.composer = composer;
  ctx.bloomPass = bloom;
  return composer;
}
