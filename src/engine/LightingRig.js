import * as THREE from 'three';
import { resolveLightingProfile, sceneLightingFamily } from '../contracts/artisanContract.js';

/**
 * ARTISAN LIGHTING RIG (Studio AAA Physical Illumination)
 * Provides calibrated dual-temperature contrast (warm key/practical against cool fill),
 * crisp contact shadow definition, and scene-specific photometrics.
 * Every value comes from the canonical scene-family x preset matrix (LIGHTING_PROFILES in
 * src/contracts/artisanContract.js); this class only applies it and animates the practical light.
 */
export class LightingRig {
  constructor(scene) {
    this.scene = scene;
    this.currentScene = 'tokyo';
    this.currentPreset = 'dusk';
    this.currentFamily = 'tokyo';
    this.profile = null;
    this.localEnabled = true; // false for authored worlds without a practical light source

    // 1. Environmental Hemisphere Light (sky/ground bounce)
    this.hemiLight = new THREE.HemisphereLight(0x7890b0, 0x24201c, 0.45);
    this.hemiLight.position.set(0, 20, 0);
    this.scene.add(this.hemiLight);

    // 2. Key Directional Light (Dominant physical light with high-res soft shadow mapping)
    this.keyLight = new THREE.DirectionalLight(0xfff5ea, 1.75);
    this.keyLight.position.set(3.5, 6.5, 4.5);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.width = 1024;
    this.keyLight.shadow.mapSize.height = 1024;
    this.keyLight.shadow.bias = -0.0003;
    this.keyLight.shadow.normalBias = 0.02; // Prevents shadow acne while maintaining sharp contact lines
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 25;
    this.keyLight.shadow.camera.left = -5.5;
    this.keyLight.shadow.camera.right = 5.5;
    this.keyLight.shadow.camera.top = 5.5;
    this.keyLight.shadow.camera.bottom = -5.5;
    this.scene.add(this.keyLight);

    // 3. Fill Directional Light (cool counterpart to the warm key)
    this.fillLight = new THREE.DirectionalLight(0x4a6080, 0.45);
    this.fillLight.position.set(-4.5, 4.5, 2.5);
    this.scene.add(this.fillLight);

    // 4. Local Scene Practical PointLight (Fireplace, Witchlight, Lantern or desk lamp)
    // Non-shadow-casting: keyLight directional shadow map provides crisp shadows without 6-pass cubemap stall
    this.hearthLight = new THREE.PointLight(0xff6e1a, 0, 10.0, 1.4);
    this.hearthLight.castShadow = false;
    this.scene.add(this.hearthLight);

    // 5. Dummy reference for backwards compatibility (unrendered)
    this.hearthBounce = new THREE.PointLight(0xff9933, 0, 0.1, 1.0);
    this.hearthBounce.visible = false;

    // Apply initial profile
    this.setSceneProfile('tokyo', 'dusk');
  }

  /** Applies the canonical profile for a preset scene id (or lighting family id) and preset. */
  setSceneProfile(sceneName, preset = this.currentPreset) {
    const family = sceneLightingFamily(sceneName);
    const p = resolveLightingProfile(family, preset);
    this.currentScene = sceneName;
    this.currentPreset = preset;
    this.currentFamily = family;
    this.profile = p;

    if (!this.scene.background || !this.scene.background.isColor) {
      this.scene.background = new THREE.Color();
    }
    this.scene.background.set(p.background);

    this.hemiLight.color.set(p.hemi.sky);
    this.hemiLight.groundColor.set(p.hemi.ground);
    this.hemiLight.intensity = p.hemi.intensity;

    this.keyLight.color.set(p.key.color);
    this.keyLight.intensity = p.key.intensity;
    this.keyLight.position.set(...p.key.position);

    this.fillLight.color.set(p.fill.color);
    this.fillLight.intensity = p.fill.intensity;
    this.fillLight.position.set(...p.fill.position);

    this.hearthLight.castShadow = false;
    this.hearthLight.color.set(p.local.color);
    this.hearthLight.intensity = this.localEnabled ? p.local.intensity : 0;
    this.hearthLight.distance = p.local.distance;
    this.hearthLight.decay = p.local.decay;
    this.hearthBounce.color.set(p.local.color);
    this.hearthBounce.intensity = p.local.intensity * 0.4;
  }

  setPreset(preset) {
    this.setSceneProfile(this.currentScene, preset);
  }

  /** Tone-mapping exposure the active profile requires (applied by the renderer owner). */
  getExposure() {
    return this.profile ? this.profile.exposure : 1.02;
  }

  /** Enables/disables the practical light (an authored world with no fire/lamp gets none). */
  setLocalEnabled(enabled) {
    this.localEnabled = !!enabled;
    if (this.profile) this.hearthLight.intensity = this.localEnabled ? this.profile.local.intensity : 0;
  }

  setHearthPosition(x, y, z) {
    this.hearthLight.position.set(x, y, z);
    this.hearthBounce.position.set(x, y - 0.2, z + 0.3);
  }

  /** Read-only snapshot of the applied canonical light/background fields (for tests and telemetry). */
  getTelemetry() {
    const hex = (c) => `#${c.getHexString()}`;
    const p = this.profile;
    return {
      scene: this.currentScene,
      family: this.currentFamily,
      preset: this.currentPreset,
      fields: {
        background: hex(this.scene.background),
        exposure: p.exposure,
        hemiSky: hex(this.hemiLight.color),
        hemiGround: hex(this.hemiLight.groundColor),
        hemiIntensity: this.hemiLight.intensity,
        keyColor: hex(this.keyLight.color),
        keyIntensity: this.keyLight.intensity,
        keyPosition: this.keyLight.position.toArray(),
        fillColor: hex(this.fillLight.color),
        fillIntensity: this.fillLight.intensity,
        fillPosition: this.fillLight.position.toArray(),
        localColor: hex(this.hearthLight.color),
        localIntensity: this.localEnabled ? p.local.intensity : 0,
        localDistance: this.hearthLight.distance,
        localPosition: this.hearthLight.position.toArray()
      }
    };
  }

  update(time) {
    const local = this.profile?.local;
    if (!local || !this.localEnabled || local.intensity <= 0 || local.flicker === 'none') return;

    if (local.flicker === 'arcane') {
      // Arcane sapphire pulsation
      const pulse = Math.sin(time * 3.8) * 1.2 + Math.cos(time * 7.2) * 0.5;
      this.hearthLight.intensity = Math.max(2.0, local.intensity + pulse * (local.intensity / 8.5));
      return;
    }

    // Organic hearth flame flicker
    const flicker = (Math.sin(time * 11) * 1.6 + Math.cos(time * 17) * 1.2 + Math.sin(time * 29) * 0.7);
    this.hearthLight.intensity = Math.max(2.0, local.intensity + flicker);
  }
}
