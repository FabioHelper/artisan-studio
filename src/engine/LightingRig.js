import * as THREE from 'three';

/**
 * ARTISAN LIGHTING RIG (Studio AAA Physical Illumination)
 * Provides calibrated dual-temperature contrast (3.5:1 ~ 4:1 Key-to-Fill ratio),
 * crisp contact shadow definition, and scene-specific photometrics.
 * Decouples modern interior lighting from medieval firelights.
 */
export class LightingRig {
  constructor(scene) {
    this.scene = scene;
    this.currentScene = 'tokyo';
    this.currentPreset = 'dusk';

    // 1. Environmental Hemisphere Light (Calibrated subtle sky/ground bounce)
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

    // 3. Fill Directional Light (Cool camera-side fill at 1:4 ratio to preserve deep ambient crevices)
    this.fillLight = new THREE.DirectionalLight(0x4a6080, 0.45);
    this.fillLight.position.set(-4.5, 4.5, 2.5);
    this.scene.add(this.fillLight);

    // 4. Local Scene Emissive / Accent PointLight (Fireplace, Witchlight, or Lantern)
    this.hearthLight = new THREE.PointLight(0xff6e1a, 0, 10.0, 1.4);
    this.hearthLight.castShadow = true;
    this.hearthLight.shadow.bias = -0.001;
    this.hearthLight.shadow.normalBias = 0.02;
    this.scene.add(this.hearthLight);

    // 5. Soft Local Bounce
    this.hearthBounce = new THREE.PointLight(0xff9933, 0, 6.0, 1.0);
    this.scene.add(this.hearthBounce);

    // Apply initial profile
    this.setSceneProfile('tokyo', 'dusk');
  }

  setSceneProfile(sceneName, preset = this.currentPreset) {
    this.currentScene = sceneName;
    this.currentPreset = preset;

    if (!this.scene.background) {
      this.scene.background = new THREE.Color(0x15181e);
    }

    if (sceneName === 'tokyo') {
      // Modern Tokyo Studio: Warm interior downlights + cool balcony twilight bounce
      this.scene.background.setHex(0x12151b);

      this.hemiLight.color.setHex(0x607a9e);      // Cool twilight sky bounce
      this.hemiLight.groundColor.setHex(0x28221c); // Dark tatami/wood reflection
      this.hemiLight.intensity = 0.42;

      this.keyLight.color.setHex(0xfff6ec);       // Warm interior ceiling key (3200K)
      this.keyLight.intensity = 1.70;
      this.keyLight.position.set(3.2, 5.8, 4.0);

      this.fillLight.color.setHex(0x3e5476);      // Exterior twilight from balcony window
      this.fillLight.intensity = 0.44;
      this.fillLight.position.set(-4.2, 3.8, -2.2);

      // Disable medieval campfire in Tokyo modern apartment!
      this.hearthLight.intensity = 0;
      this.hearthLight.castShadow = false;
      this.hearthBounce.intensity = 0;
    } else if (sceneName === 'winterhold') {
      this.hearthLight.castShadow = false;
      // Nordic Arcane Sanctuary: Glacial moonlit exterior + enchanted witchlight brazier
      this.scene.background.setHex(0x0d1118);

      this.hemiLight.color.setHex(0x7397c4);
      this.hemiLight.groundColor.setHex(0x18202c);
      this.hemiLight.intensity = 0.38;

      this.keyLight.color.setHex(0xaecdf5);
      this.keyLight.intensity = 1.55;
      this.keyLight.position.set(-3.6, 6.5, -4.8);

      this.fillLight.color.setHex(0x334760);
      this.fillLight.intensity = 0.38;
      this.fillLight.position.set(4.2, 4.0, 3.2);

      // Arcane Sapphire Witchlight Brazier
      this.hearthLight.color.setHex(0x0ea5e9);
      this.hearthLight.intensity = 8.5;
      this.hearthLight.distance = 8.0;

      this.hearthBounce.color.setHex(0x0284c7);
      this.hearthBounce.intensity = 4.0;
      this.hearthBounce.distance = 5.0;
    } else {
      // Medieval Tavern & Blacksmith Forge: High-contrast warm firelight
      if (preset === 'hearth') {
        this.scene.background.setHex(0x0f1216);
        this.hemiLight.color.setHex(0x7a8b9e);
        this.hemiLight.groundColor.setHex(0x2d1f14);
        this.hemiLight.intensity = 0.40;

        this.keyLight.color.setHex(0x4a6282);
        this.keyLight.intensity = 0.65;

        this.fillLight.color.setHex(0x283648);
        this.fillLight.intensity = 0.30;

        this.hearthLight.color.setHex(0xff5500);
        this.hearthLight.intensity = 20.0;
        this.hearthBounce.color.setHex(0xff8800);
        this.hearthBounce.intensity = 8.0;
      } else if (preset === 'day') {
        this.scene.background.setHex(0x1e232b);
        this.hemiLight.color.setHex(0xffffff);
        this.hemiLight.groundColor.setHex(0x6e6052);
        this.hemiLight.intensity = 0.95;

        this.keyLight.color.setHex(0xfff7e8);
        this.keyLight.intensity = 1.95;

        this.fillLight.color.setHex(0x8fa8c8);
        this.fillLight.intensity = 0.65;

        this.hearthLight.color.setHex(0xff6e1a);
        this.hearthLight.intensity = 8.0;
        this.hearthBounce.intensity = 4.0;
      } else {
        // Standard dusk
        this.scene.background.setHex(0x161920);
        this.hemiLight.color.setHex(0xa8bccf);
        this.hemiLight.groundColor.setHex(0x382d24);
        this.hemiLight.intensity = 0.50;

        this.keyLight.color.setHex(0xffeed6);
        this.keyLight.intensity = 1.55;

        this.fillLight.color.setHex(0x4e6580);
        this.fillLight.intensity = 0.45;

        this.hearthLight.color.setHex(0xff6e1a);
        this.hearthLight.intensity = 15.0;
        this.hearthBounce.color.setHex(0xff9933);
        this.hearthBounce.intensity = 6.0;
      }
    }
  }

  setPreset(preset) {
    this.setSceneProfile(this.currentScene, preset);
  }

  setHearthPosition(x, y, z) {
    this.hearthLight.position.set(x, y, z);
    this.hearthBounce.position.set(x, y - 0.2, z + 0.3);
  }

  update(time) {
    if (this.currentScene === 'tokyo') {
      // Keep Tokyo indoor lighting steady and crisp
      return;
    }

    if (this.currentScene === 'winterhold') {
      // Arcane sapphire pulsation
      const base = 8.5;
      const pulse = Math.sin(time * 3.8) * 1.2 + Math.cos(time * 7.2) * 0.5;
      this.hearthLight.intensity = Math.max(2.0, base + pulse);
      return;
    }

    // Organic medieval hearth flame flicker
    const base = this.currentPreset === 'hearth' ? 20.0 : (this.currentPreset === 'day' ? 8.0 : 15.0);
    const flicker = (Math.sin(time * 11) * 1.6 + Math.cos(time * 17) * 1.2 + Math.sin(time * 29) * 0.7);
    this.hearthLight.intensity = Math.max(2.0, base + flicker);
  }
}
