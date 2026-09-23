// world/sky.js — the dream dusk: gradient dome, star field, one great cratered
// moon + two small companions, slow drifting cloud banks (reference image 1).
import * as THREE from 'three';
import { ctx } from '../core/ctx.js';
import { P } from '../core/palette.js';

export function createSky() {
  const g = new THREE.Group();

  // ── gradient dome ──
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(P.skyTop) },
      mid: { value: new THREE.Color(P.skyMid) },
      glow: { value: new THREE.Color(P.skyGlow) },
      warm: { value: new THREE.Color(P.horizonWarm) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 glow; uniform vec3 warm;
      varying vec3 vP;
      void main(){
        float h = normalize(vP).y;                 // -1..1
        vec3 c = mix(mid, top, smoothstep(0.06, 0.65, h));
        c = mix(glow, c, smoothstep(-0.02, 0.24, h));       // teal glow band
        float w = pow(max(0.0, 1.0 - abs(h + 0.02) * 6.0), 2.0);
        c += warm * w * 0.35;                                // warm horizon kiss
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(240, 32, 20), skyMat);
  g.add(dome);

  // ── stars ──
  const N = 900;
  const pos = new Float32Array(N * 3), sz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2;
    const h = Math.random() * 0.9 + 0.08;          // keep above horizon band
    const r = 228;
    const ring = Math.sqrt(1 - h * h);
    pos[i * 3] = Math.cos(a) * ring * r;
    pos[i * 3 + 1] = h * r;
    pos[i * 3 + 2] = Math.sin(a) * ring * r;
    sz[i] = Math.random();
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('aSz', new THREE.BufferAttribute(sz, 1));
  const starMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { t: { value: 0 } },
    vertexShader: `attribute float aSz; varying float vS; uniform float t;
      void main(){ vS = 0.55 + 0.45 * sin(t * (0.4 + aSz) + aSz * 40.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        gl_PointSize = 1.2 + aSz * 2.4; }`,
    fragmentShader: `varying float vS;
      void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
        gl_FragColor = vec4(0.92, 0.95, 1.0, vS * (1.0 - d * 2.0)); }`,
  });
  const stars = new THREE.Points(starGeo, starMat);
  g.add(stars);
  ctx.animations.push((dt, t) => { starMat.uniforms.t.value = t; });

  // ── the great moon (canvas craters, emissive) ──
  const mc = document.createElement('canvas'); mc.width = mc.height = 256;
  const mg = mc.getContext('2d');
  mg.fillStyle = '#f4ead2'; mg.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 34; i++) {
    const r = 4 + Math.random() * 16;
    const x = Math.random() * 256, y = Math.random() * 256;
    const grad = mg.createRadialGradient(x, y, r * 0.2, x, y, r);
    grad.addColorStop(0, 'rgba(190,180,150,0.55)');
    grad.addColorStop(0.8, 'rgba(190,180,150,0.18)');
    grad.addColorStop(1, 'rgba(190,180,150,0)');
    mg.fillStyle = grad;
    mg.beginPath(); mg.arc(x, y, r, 0, Math.PI * 2); mg.fill();
  }
  const moonTex = new THREE.CanvasTexture(mc);
  moonTex.colorSpace = THREE.SRGBColorSpace;
  const moon = new THREE.Mesh(new THREE.SphereGeometry(14, 32, 24),
    new THREE.MeshBasicMaterial({ map: moonTex, fog: false }));
  moon.position.set(-46, 74, -170);
  g.add(moon);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex(), color: P.moonGlow, transparent: true, opacity: 0.5,
    depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(72); halo.position.copy(moon.position);
  g.add(halo);
  ctx.moon = moon;

  // two small companion moons
  for (const [x, y, z, r, c] of [[28, 52, -180, 4.4, 0xcfd8e8], [58, 38, -160, 2.6, 0xe8d8c8]]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14),
      new THREE.MeshBasicMaterial({ color: c, fog: false }));
    m.position.set(x, y, z);
    g.add(m);
  }

  // ── slow cloud banks (soft sprites) ──
  const cloudMat = new THREE.SpriteMaterial({
    map: glowTex(), color: 0xa8ccd4, transparent: true, opacity: 0.16,
    depthWrite: false, fog: false });
  const clouds = [];
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(cloudMat.clone());
    const a = Math.random() * Math.PI * 2;
    const r = 150 + Math.random() * 60;
    s.position.set(Math.cos(a) * r, 26 + Math.random() * 46, Math.sin(a) * r);
    s.scale.set(60 + Math.random() * 70, 14 + Math.random() * 12, 1);
    s.material.opacity = 0.08 + Math.random() * 0.12;
    s.userData.w = (Math.random() * 0.6 + 0.2) * 0.9;
    clouds.push(s); g.add(s);
  }
  ctx.animations.push((dt) => {
    for (const c of clouds) {
      const p = c.position;
      const a = Math.atan2(p.z, p.x) + dt * 0.004 * c.userData.w;
      const r = Math.hypot(p.x, p.z);
      p.x = Math.cos(a) * r; p.z = Math.sin(a) * r;
    }
  });

  return g;
}

let _glow = null;
export function glowTex() {
  if (_glow) return _glow;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}
