import * as THREE from 'three';

/**
 * ARTISAN MATERIAL FOUNDRY
 * Canonical shared PBR material vocabulary enforcing zero stylistic drift.
 */
export class MaterialFoundry {
  constructor() {
    this.materials = new Map();
    this.initCoreMaterials();
  }

  createCrispCanvasTexture(canvas, anisotropy = 4) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = anisotropy;
    return texture;
  }

  initCoreMaterials() {
    // Wood families
    this.register('wood.dark_oak', new THREE.MeshStandardMaterial({
      color: 0x3d2817,
      roughness: 0.85,
      metalness: 0.05
    }));

    this.register('wood.weathered_oak', new THREE.MeshStandardMaterial({
      color: 0x4e3e32,
      roughness: 0.9,
      metalness: 0.02
    }));

    this.register('wood.floor_oak', new THREE.MeshStandardMaterial({
      color: 0x2e1e12,
      roughness: 0.8,
      metalness: 0.05
    }));

    // Plaster / Masonry
    this.register('plaster.lime_warm', new THREE.MeshStandardMaterial({
      color: 0x9e9688, // Muted authentic lime plaster (not blown-out white)
      roughness: 0.92,
      metalness: 0.0
    }));

    this.register('plaster.tokyo_wall', new THREE.MeshStandardMaterial({
      color: 0xe8e4dc, // Clean modern Japanese off-white matte plaster
      roughness: 0.94,
      metalness: 0.0
    }));

    this.register('stone.rough_local', new THREE.MeshStandardMaterial({
      color: 0x686e77, // Weathered grey masonry stone
      roughness: 0.90,
      metalness: 0.04
    }));

    this.register('stone.hearth', new THREE.MeshStandardMaterial({
      color: 0x5e646d, // Heat-patinated hearth stone
      roughness: 0.88,
      metalness: 0.06
    }));

    // Metal families
    this.register('metal.forged_iron', new THREE.MeshStandardMaterial({
      color: 0x1a1c20,
      roughness: 0.55,
      metalness: 0.88
    }));

    this.register('metal.polished_iron', new THREE.MeshStandardMaterial({
      color: 0x2f343b,
      roughness: 0.38,
      metalness: 0.92
    }));

    // Leather & Textiles
    this.register('leather.worn', new THREE.MeshStandardMaterial({
      color: 0x5c381e,
      roughness: 0.82,
      metalness: 0.05
    }));

    this.register('cloth.woven_cushion', new THREE.MeshPhysicalMaterial({
      color: 0x8a402a,
      roughness: 0.92,
      sheen: 0.70,
      sheenColor: new THREE.Color(0xb2563a),
      sheenRoughness: 0.50
    }));

    this.register('ceramic.dish', new THREE.MeshPhysicalMaterial({
      color: 0x1c1f24, // Glazed deep charcoal/onyx ceramic
      roughness: 0.14,
      metalness: 0.04,
      clearcoat: 0.92,
      clearcoatRoughness: 0.06,
      ior: 1.52
    }));

    // Emissive / Energy
    this.register('ember', new THREE.MeshStandardMaterial({
      color: 0xff4d00,
      emissive: 0xff6600,
      emissiveIntensity: 2.4,
      roughness: 0.7
    }));

    // Procedural painting panel
    this.register('cloth.painted_panel', this.createPaintingMaterial());

    // Procedural woven rug
    this.register('cloth.woven_rug', this.createRugMaterial());

    // ==========================================
    // MODERN JAPANESE & NINTENDO MATERIALS
    // ==========================================
    this.register('wood.birch_light', new THREE.MeshPhysicalMaterial({
      color: 0xdfcbaf, // Clean natural Japanese blonde birch / hinoki
      roughness: 0.50,
      metalness: 0.0,
      sheen: 0.38,
      sheenColor: new THREE.Color(0xfff1de),
      sheenRoughness: 0.42
    }));

    this.register('metal.matte_black', new THREE.MeshStandardMaterial({
      color: 0x181a1e, // Deep obsidian black powder-coated aluminum
      roughness: 0.38,
      metalness: 0.82,
      envMapIntensity: 0.90
    }));

    this.register('metal.aluminum_brushed', new THREE.MeshStandardMaterial({
      color: 0xd2d7e0, // Crisp brushed natural aerospace aluminum
      roughness: 0.22,
      metalness: 0.95,
      envMapIntensity: 1.40
    }));

    this.register('plastic.joycon_red', new THREE.MeshPhysicalMaterial({
      color: 0xff3b20, // Iconic Nintendo Neon Red
      roughness: 0.36,
      metalness: 0.04,
      clearcoat: 0.16,
      clearcoatRoughness: 0.25,
      envMapIntensity: 0.85
    }));

    this.register('plastic.joycon_blue', new THREE.MeshPhysicalMaterial({
      color: 0x0ab8e6, // Iconic Nintendo Neon Blue
      roughness: 0.36,
      metalness: 0.04,
      clearcoat: 0.16,
      clearcoatRoughness: 0.25,
      envMapIntensity: 0.85
    }));

    // Realistic Procedural VS Code IDE Screen with syntax-highlighted Nintendo C++ code
    this.register('screen.dev_glow', this.createVSCodeScreenMaterial());

    // Realistic Procedural Retro Mario Game Screen with scanlines and pixel art
    this.register('screen.mario_glow', this.createMarioGameScreenMaterial());

    // Tokyo Twilight / Night Skyline Window Backdrop with glowing skyscrapers and Tokyo Tower
    this.register('skyline.tokyo_night', this.createTokyoSkylineMaterial());

    this.register('fabric.tatami', new THREE.MeshPhysicalMaterial({
      color: 0xcbbd90, // Natural woven rush grass
      roughness: 0.86,
      metalness: 0.0,
      sheen: 0.85,     // Silky fabric graze across woven igusa straw
      sheenColor: new THREE.Color(0xe6dcb6),
      sheenRoughness: 0.45
    }));

    this.register('fabric.tatami_border', new THREE.MeshStandardMaterial({
      color: 0x1c2027, // Traditional dark indigo cloth edge
      roughness: 0.85,
      metalness: 0.0
    }));

    this.register('paper.shoji', new THREE.MeshStandardMaterial({
      color: 0xfcf8ee, // Warm translucent washi rice paper
      roughness: 0.95,
      metalness: 0.0
    }));

    this.register('plant.bonsai', new THREE.MeshStandardMaterial({
      color: 0x2e5929, // Lush pine needles with organic depth
      roughness: 0.72,
      metalness: 0.0
    }));

    this.register('ceramic.white', new THREE.MeshPhysicalMaterial({
      color: 0xf8f6f0, // Clean vitrified white porcelain
      roughness: 0.12,
      metalness: 0.0,
      clearcoat: 0.95, // Glazed specular reflection
      clearcoatRoughness: 0.05,
      ior: 1.52
    }));

    this.register('metal.brass_gold', new THREE.MeshStandardMaterial({
      color: 0xf59e0b, // Rich warm golden brass
      roughness: 0.20,
      metalness: 0.94,
      envMapIntensity: 1.45
    }));

    this.register('glass.window', new THREE.MeshPhysicalMaterial({
      color: 0xe0f2fe,
      opacity: 0.22,
      transparent: true,
      roughness: 0.04,
      metalness: 0.12,
      reflectivity: 0.9,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.8
    }));

    this.register('decor.nintendo_art', this.createNintendoArtMaterial());

    // ==========================================
    // SKYRIM: SCHOOL / COLLEGE OF WINTERHOLD
    // ==========================================
    this.register('stone.winterhold_masonry', new THREE.MeshStandardMaterial({
      color: 0x3d434d, // Weathered ancient Nordic granite
      roughness: 0.92,
      metalness: 0.06
    }));

    this.register('stone.nordic_carved', new THREE.MeshStandardMaterial({
      color: 0x2a2f38, // Dark carved rune-etched stone
      roughness: 0.86,
      metalness: 0.08
    }));

    this.register('ice.glacial', new THREE.MeshStandardMaterial({
      color: 0x88ccee, // Glacial pack ice window pane
      roughness: 0.1,
      metalness: 0.05,
      transparent: true,
      opacity: 0.14
    }));

    this.register('crystal.soul_gem', new THREE.MeshStandardMaterial({
      color: 0x9333ea, // Grand Soul Gem (Glowing Amethyst)
      emissive: 0xa855f7,
      emissiveIntensity: 2.4,
      roughness: 0.12,
      metalness: 0.1
    }));

    this.register('crystal.soul_gem_cyan', new THREE.MeshStandardMaterial({
      color: 0x06b6d4, // Lesser Soul Gem (Glowing Cyan)
      emissive: 0x22d3ee,
      emissiveIntensity: 2.6,
      roughness: 0.12,
      metalness: 0.1
    }));

    this.register('magic.witchlight_blue', new THREE.MeshStandardMaterial({
      color: 0x38bdf8, // Arcane blue witchlight flame
      emissive: 0x0284c7,
      emissiveIntensity: 3.5,
      roughness: 0.5
    }));

    this.register('magic.witchlight_coals', new THREE.MeshStandardMaterial({
      color: 0x181e26, // Chilled enchanted charcoal
      emissive: 0x0369a1, // Deep sapphire inner ember glow
      emissiveIntensity: 1.6,
      roughness: 0.88,
      metalness: 0.05
    }));

    this.register('leather.spellbook_navy', new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.75,
      metalness: 0.05
    }));

    this.register('leather.spellbook_crimson', new THREE.MeshStandardMaterial({
      color: 0x6b1d1d,
      roughness: 0.75,
      metalness: 0.05
    }));

    // Realistic Weathered Bone & Horn
    this.register('bone.weathered_ivory', new THREE.MeshStandardMaterial({
      color: 0x9a9180, // Aged ancient beast bone (matte, crevice-friendly, anti-blowout)
      roughness: 0.88,
      metalness: 0.02
    }));

    this.register('bone.horn_dark', new THREE.MeshStandardMaterial({
      color: 0x221a15, // Deep patinated ram horn
      roughness: 0.70,
      metalness: 0.06
    }));

    this.register('wax.candle', new THREE.MeshStandardMaterial({
      color: 0xf5eedb, // Tallow candle wax
      roughness: 0.45,
      metalness: 0.02
    }));

    this.register('metal.dwemer_brass', new THREE.MeshStandardMaterial({
      color: 0xd4af37, // Antique Dwemer gold/brass
      roughness: 0.32,
      metalness: 0.88
    }));


    // Procedural Arcane Floor Rune Circle
    this.register('magic.arcane_rune', this.createArcaneRuneMaterial());

    // Procedural Sea of Ghosts & Swirling Aurora Borealis Panorama
    this.register('skyline.winterhold_aurora', this.createWinterholdAuroraMaterial());

    // Procedural Moonlit Alpine Misty Mountains Panorama (Hermit Library)
    this.register('skyline.misty_mountains', this.createMistyMountainsMaterial());

    // Procedural College of Winterhold Tapestry Banner
    this.register('banner.winterhold', this.createWinterholdBannerMaterial());

    // Procedural Illuminated Grimoire Spellbook Page
    this.register('book.grimoire_page', this.createGrimoirePageMaterial());

    // Procedural Medieval Cobblestone Alley (Alchemist Lab)
    this.register('skyline.cobblestone_alley', this.createCobblestoneAlleyMaterial());

    // Procedural Stormy Fortress Bastion (Dungeon Armory)
    this.register('skyline.stormy_bastion', this.createStormyBastionMaterial());

    // Procedural Alpine Twilight Valley (Forge Trio)
    this.register('skyline.twilight_valley', this.createTwilightValleyMaterial());

    // Procedural Medieval Village Sunset (Tavern)
    this.register('skyline.village_sunset', this.createVillageSunsetMaterial());
  }

  register(name, material) {
    this.materials.set(name, material);
  }

  get(name) {
    return this.materials.get(name) || this.materials.get('wood.dark_oak');
  }

  setWireframe(enabled) {
    for (const mat of this.materials.values()) {
      mat.wireframe = enabled;
    }
  }

  createPaintingMaterial() {
    if (typeof document === 'undefined') {
      return new THREE.MeshStandardMaterial({ color: 0xeeddc5, roughness: 0.85 });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // Parchment backdrop
    ctx.fillStyle = '#eeddc5';
    ctx.fillRect(0, 0, 256, 256);

    // Stylized mountain ranges
    ctx.fillStyle = '#4f6d7a';
    ctx.beginPath();
    ctx.moveTo(30, 210);
    ctx.lineTo(110, 100);
    ctx.lineTo(190, 210);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#39535f';
    ctx.beginPath();
    ctx.moveTo(110, 210);
    ctx.lineTo(180, 115);
    ctx.lineTo(240, 210);
    ctx.closePath();
    ctx.fill();

    // Red crest sun
    ctx.fillStyle = '#b8422e';
    ctx.beginPath();
    ctx.arc(128, 80, 26, 0, Math.PI * 2);
    ctx.fill();

    // Sigil pole
    ctx.fillStyle = '#2b1a10';
    ctx.fillRect(124, 75, 8, 120);

    const texture = this.createCrispCanvasTexture(canvas);
    return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 });
  }

  createRugMaterial() {
    if (typeof document === 'undefined') {
      return new THREE.MeshStandardMaterial({ color: 0x6e3125, roughness: 0.95 });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#6e3125';
    ctx.fillRect(0, 0, 512, 256);

    // Geometric lines
    ctx.strokeStyle = '#e0a96d';
    ctx.lineWidth = 6;
    for (let i = 0; i <= 512; i += 32) {
      ctx.beginPath();
      ctx.moveTo(256, 128);
      ctx.lineTo(i, (i % 64 === 0) ? 0 : 256);
      ctx.stroke();
    }

    ctx.strokeStyle = '#2b1a10';
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, 498, 242);

    const texture = this.createCrispCanvasTexture(canvas);
    return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 });
  }

  createNintendoArtMaterial() {
    if (typeof document === 'undefined') {
      return new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');

    // Deep Japanese indigo / navy backdrop
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 256, 320);

    // Subtle gold border
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 4;
    ctx.strokeRect(12, 12, 232, 296);

    // Golden Triforce (3 equilateral triangles)
    ctx.fillStyle = '#facc15';
    const drawTri = (cx, cy, size) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy - size);
      ctx.lineTo(cx + size * 0.866, cy + size * 0.5);
      ctx.lineTo(cx - size * 0.866, cy + size * 0.5);
      ctx.closePath();
      ctx.fill();
    };

    // Top triangle
    drawTri(128, 120, 36);
    // Bottom left triangle
    drawTri(128 - 31, 120 + 54, 36);
    // Bottom right triangle
    drawTri(128 + 31, 120 + 54, 36);

    // Red Nintendo capsule seal at bottom
    ctx.fillStyle = '#e11d48';
    ctx.beginPath();
    ctx.roundRect(88, 240, 80, 24, 12);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Nintendo', 128, 252);

    const texture = this.createCrispCanvasTexture(canvas);
    return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.45 });
  }

  createVSCodeScreenMaterial() {
    if (typeof document === 'undefined') {
      return new THREE.MeshStandardMaterial({ color: 0x1e1e2e, emissive: 0x007acc, emissiveIntensity: 0.3 });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');

    // VS Code dark theme background
    ctx.fillStyle = '#181825';
    ctx.fillRect(0, 0, 512, 320);

    // Title bar
    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, 512, 22);

    // Window control buttons (macOS/Linux style)
    ctx.fillStyle = '#f38ba8'; // red
    ctx.beginPath(); ctx.arc(12, 11, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f9e2af'; // yellow
    ctx.beginPath(); ctx.arc(24, 11, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#a6e3a1'; // green
    ctx.beginPath(); ctx.arc(36, 11, 4, 0, Math.PI * 2); ctx.fill();

    // Title text
    ctx.fillStyle = '#a6adc8';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('mario_controller.cpp — Nintendo EPD Tokyo — VS Code', 256, 15);

    // Sidebar (File Explorer)
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(0, 22, 110, 280);

    ctx.fillStyle = '#cdd6f4';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('EXPLORER', 10, 36);

    ctx.font = '9px monospace';
    ctx.fillStyle = '#89b4fa';
    ctx.fillText('▼ src', 10, 52);
    ctx.fillStyle = '#a6e3a1';
    ctx.fillText('  main.cpp', 14, 66);
    ctx.fillStyle = '#f9e2af';
    ctx.fillText('  player.h', 14, 80);
    ctx.fillStyle = '#fab387';
    ctx.fillText('▶ mario_ctrl.cpp', 14, 94);
    ctx.fillStyle = '#94e2d5';
    ctx.fillText('  physics.cpp', 14, 108);
    ctx.fillStyle = '#89b4fa';
    ctx.fillText('▶ assets', 10, 124);
    ctx.fillText('▶ shaders', 10, 138);

    // Active Editor Tab Bar
    ctx.fillStyle = '#181825';
    ctx.fillRect(110, 22, 402, 22);
    ctx.fillStyle = '#313244';
    ctx.fillRect(110, 22, 130, 22);
    ctx.fillStyle = '#f38ba8';
    ctx.fillRect(110, 22, 130, 2); // Tab highlight
    ctx.fillStyle = '#cdd6f4';
    ctx.font = '10px monospace';
    ctx.fillText('mario_ctrl.cpp ✕', 120, 37);

    // Editor Area (Line numbers & Code)
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(110, 44, 402, 258);

    // Line numbers gutter
    ctx.fillStyle = '#181825';
    ctx.fillRect(110, 44, 28, 258);

    const codeLines = [
      { num: '1', tokens: [{ text: '#include ', col: '#f38ba8' }, { text: '<nintendo/switch.h>', col: '#a6e3a1' }] },
      { num: '2', tokens: [{ text: '#include ', col: '#f38ba8' }, { text: '"player_physics.h"', col: '#a6e3a1' }] },
      { num: '3', tokens: [] },
      { num: '4', tokens: [{ text: 'namespace ', col: '#f38ba8' }, { text: 'epd::tokyo ', col: '#fab387' }, { text: '{', col: '#cdd6f4' }] },
      { num: '5', tokens: [{ text: '  class ', col: '#cba6f7' }, { text: 'MarioController ', col: '#f9e2af' }, { text: ': public Actor {', col: '#cdd6f4' }] },
      { num: '6', tokens: [{ text: '  public:', col: '#f38ba8' }] },
      { num: '7', tokens: [{ text: '    void ', col: '#89b4fa' }, { text: 'OnJumpPressed', col: '#f9e2af' }, { text: '(float dt) {', col: '#cdd6f4' }] },
      { num: '8', tokens: [{ text: '      if (m_isGrounded) {', col: '#cdd6f4' }] },
      { num: '9', tokens: [{ text: '        m_velocity.y = ', col: '#cdd6f4' }, { text: 'JUMP_VELOCITY;', col: '#fab387' }] },
      { num: '10', tokens: [{ text: '        Audio::Play(', col: '#89b4fa' }, { text: '"sfx_jump.wav"', col: '#a6e3a1' }, { text: ');', col: '#cdd6f4' }] },
      { num: '11', tokens: [{ text: '        m_animState = ', col: '#cdd6f4' }, { text: 'Anim::SUPER_JUMP;', col: '#fab387' }] },
      { num: '12', tokens: [{ text: '      }', col: '#cdd6f4' }] },
      { num: '13', tokens: [{ text: '    }', col: '#cdd6f4' }] },
      { num: '14', tokens: [{ text: '  };', col: '#cdd6f4' }] },
      { num: '15', tokens: [{ text: '}', col: '#cdd6f4' }] }
    ];

    let lineY = 60;
    for (const l of codeLines) {
      // Gutter number
      ctx.fillStyle = '#585b70';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(l.num, 134, lineY);

      // Tokens
      ctx.textAlign = 'left';
      let tokX = 144;
      for (const tok of l.tokens) {
        ctx.fillStyle = tok.col;
        ctx.fillText(tok.text, tokX, lineY);
        tokX += ctx.measureText(tok.text).width;
      }
      lineY += 14;
    }

    // Status Bar
    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 302, 512, 18);
    ctx.fillStyle = '#89b4fa';
    ctx.font = '9px sans-serif';
    ctx.fillText('⑂ main*', 10, 314);
    ctx.fillStyle = '#a6e3a1';
    ctx.fillText('✓ Nintendo SDK v16.4.2 [Build: PASS]', 70, 314);
    ctx.fillStyle = '#cdd6f4';
    ctx.textAlign = 'right';
    ctx.fillText('UTF-8   C++20   60 FPS', 502, 314);

    const texture = this.createCrispCanvasTexture(canvas);
    return new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: 0xffffff, // White multiplier preserves true syntax colors and deep editor background
      emissiveIntensity: 0.90,
      roughness: 0.12,
      metalness: 0.05
    });
  }

  createMarioGameScreenMaterial() {
    if (typeof document === 'undefined') {
      return new THREE.MeshStandardMaterial({ color: 0x5c94fc, emissive: 0x5c94fc, emissiveIntensity: 0.4 });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 380;
    const ctx = canvas.getContext('2d');

    // Famicom / NES Nintendo Sky Blue
    ctx.fillStyle = '#5c94fc';
    ctx.fillRect(0, 0, 256, 380);

    // HUD Header
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 256, 34);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('MARIO', 16, 16);
    ctx.fillText('028450', 16, 28);

    ctx.fillText('COINS', 84, 16);
    ctx.fillText('× 42', 84, 28);

    ctx.fillText('WORLD', 150, 16);
    ctx.fillText('1 - 1', 156, 28);

    ctx.fillText('TIME', 214, 16);
    ctx.fillText('348', 218, 28);

    // Pixelated Clouds
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(60, 80, 16, 0, Math.PI * 2);
    ctx.arc(84, 76, 20, 0, Math.PI * 2);
    ctx.arc(108, 80, 16, 0, Math.PI * 2);
    ctx.fill();

    // Floating Question Block (Golden Yellow)
    ctx.fillStyle = '#fbb300';
    ctx.fillRect(96, 160, 28, 28);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(96, 160, 28, 28);

    // Block '?' Question Mark
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('?', 110, 181);

    // Brick Blocks
    const drawBrick = (bx, by) => {
      ctx.fillStyle = '#b8422e';
      ctx.fillRect(bx, by, 28, 28);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, 28, 28);
      ctx.fillStyle = '#d86c4e';
      ctx.fillRect(bx + 4, by + 4, 9, 8);
      ctx.fillRect(bx + 15, by + 4, 9, 8);
      ctx.fillRect(bx + 8, by + 15, 12, 8);
    };

    drawBrick(68, 160);
    drawBrick(124, 160);
    drawBrick(152, 160);

    // Mario Jumping Sprite
    ctx.fillStyle = '#e11d48'; // Red cap/shirt
    ctx.fillRect(100, 206, 20, 14);
    ctx.fillStyle = '#0284c7'; // Blue overalls
    ctx.fillRect(102, 220, 16, 16);
    ctx.fillStyle = '#fcd34d'; // Face
    ctx.fillRect(106, 202, 12, 10);
    ctx.fillStyle = '#78350f'; // Boots
    ctx.fillRect(98, 236, 10, 8);
    ctx.fillRect(112, 232, 10, 8);

    // Iconic Green Warp Pipe
    ctx.fillStyle = '#00a800';
    ctx.fillRect(180, 250, 48, 70);
    ctx.strokeStyle = '#004800';
    ctx.lineWidth = 3;
    ctx.strokeRect(180, 250, 48, 70);
    ctx.fillStyle = '#00c800';
    ctx.fillRect(174, 238, 60, 16);
    ctx.strokeRect(174, 238, 60, 16);

    // Ground Blocks
    ctx.fillStyle = '#d86c4e';
    ctx.fillRect(0, 320, 256, 60);
    ctx.fillStyle = '#000000';
    for (let x = 0; x < 256; x += 16) {
      ctx.strokeRect(x, 320, 16, 16);
      ctx.strokeRect(x, 336, 16, 16);
      ctx.strokeRect(x, 352, 16, 16);
    }

    // CRT Scanlines
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    for (let y = 0; y < 380; y += 4) {
      ctx.fillRect(0, y, 256, 2);
    }

    const texture = this.createCrispCanvasTexture(canvas);
    return new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: 0xffffff, // White multiplier preserves authentic NES sky blue, pipes and brick colors
      emissiveIntensity: 0.90,
      roughness: 0.12,
      metalness: 0.05
    });
  }

  createTokyoSkylineMaterial() {
    if (typeof document === 'undefined') {
      return new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Vertical twilight sky gradient (deep navy to twilight magenta to warm amber)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, 512);
    skyGrad.addColorStop(0.0, '#060a17');
    skyGrad.addColorStop(0.4, '#121832');
    skyGrad.addColorStop(0.75, '#281c3c');
    skyGrad.addColorStop(1.0, '#4a2838');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, 512, 512);

    // Stars in upper sky
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 60; i++) {
      const sx = (i * 97) % 512;
      const sy = (i * 47) % 200;
      const sr = (i % 3 === 0) ? 1.5 : 0.8;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Distant background skyscraper silhouettes (dark indigo)
    ctx.fillStyle = '#181b30';
    const bgBuildings = [
      { x: 10, w: 50, h: 220 }, { x: 70, w: 40, h: 180 }, { x: 120, w: 60, h: 260 },
      { x: 190, w: 45, h: 190 }, { x: 340, w: 55, h: 240 }, { x: 410, w: 45, h: 200 }, { x: 465, w: 40, h: 250 }
    ];
    for (const b of bgBuildings) {
      ctx.fillRect(b.x, 512 - b.h, b.w, b.h);
    }

    // Midground skyscrapers with glowing windows
    const mgBuildings = [
      { x: 0, w: 65, h: 320 }, { x: 75, w: 50, h: 270 }, { x: 135, w: 70, h: 360 },
      { x: 310, w: 60, h: 340 }, { x: 380, w: 80, h: 290 }, { x: 470, w: 42, h: 310 }
    ];

    ctx.fillStyle = '#0f1324';
    for (const b of mgBuildings) {
      ctx.fillRect(b.x, 512 - b.h, b.w, b.h);

      // Lit windows
      for (let wy = 512 - b.h + 15; wy < 500; wy += 14) {
        for (let wx = b.x + 8; wx < b.x + b.w - 8; wx += 10) {
          if ((wx * 7 + wy * 13) % 5 === 0) {
            ctx.fillStyle = (wx % 2 === 0) ? '#fef08a' : '#67e8f9'; // warm yellow or cyan
            ctx.fillRect(wx, wy, 4, 6);
          }
        }
      }
    }

    // Iconic TOKYO TOWER (Center-right silhouette glowing in vibrant red/orange)
    const tx = 250;
    const baseW = 60;
    const towerH = 340;
    const ty = 512 - towerH;

    // Red illuminated lattice legs
    ctx.strokeStyle = '#ff3311';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(tx - baseW / 2, 512);
    ctx.lineTo(tx - 6, ty + 90);
    ctx.lineTo(tx, ty);
    ctx.lineTo(tx + 6, ty + 90);
    ctx.lineTo(tx + baseW / 2, 512);
    ctx.stroke();

    // Cross trusses
    for (let ly = ty + 40; ly < 512; ly += 24) {
      const frac = (ly - ty) / towerH;
      const w = baseW * frac;
      ctx.beginPath();
      ctx.moveTo(tx - w / 2, ly);
      ctx.lineTo(tx + w / 2, ly);
      ctx.stroke();
    }

    // Observation decks (white illuminated bands)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tx - 18, ty + 120, 36, 12);
    ctx.fillRect(tx - 10, ty + 50, 20, 8);

    // Top antenna spire & red beacon light
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx, ty - 35);
    ctx.stroke();

    // Flashing red aviation beacon
    ctx.fillStyle = '#ff1100';
    ctx.beginPath();
    ctx.arc(tx, ty - 35, 4, 0, Math.PI * 2);
    ctx.fill();

    // Foreground highway overpass with vehicle light trails
    ctx.fillStyle = '#080a14';
    ctx.fillRect(0, 480, 512, 32);
    // Red tail light streaks
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(0, 492, 512, 3);
    // White headlight streaks
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(0, 498, 512, 3);

    const texture = this.createCrispCanvasTexture(canvas);
    return new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: 0xffffff,
      emissiveIntensity: 1.4,
      roughness: 0.8,
      side: THREE.DoubleSide
    });
  }

  // ==========================================
  // SKYRIM: SCHOOL / COLLEGE OF WINTERHOLD PROCEDURAL TEXTURES
  // ==========================================

  createArcaneRuneMaterial() {
    if (typeof document === 'undefined') {
      return new THREE.MeshStandardMaterial({ color: 0x1e293b, emissive: 0x06b6d4, emissiveIntensity: 1.5 });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const cx = 256;
    const cy = 256;

    // Dark weathered Nordic slate floor base
    ctx.fillStyle = '#171c26';
    ctx.fillRect(0, 0, 512, 512);

    // Stone flagstone radial tile joints
    ctx.strokeStyle = '#0f121a';
    ctx.lineWidth = 3;
    for (let r = 80; r <= 240; r += 50) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 80, cy + Math.sin(a) * 80);
      ctx.lineTo(cx + Math.cos(a) * 240, cy + Math.sin(a) * 240);
      ctx.stroke();
    }

    // Glowing Arcane Rune Rings (Luminous Cyan & Deep Sapphire)
    const glowCyan = '#22d3ee';
    const deepSapphire = '#0284c7';

    // Outer runic border ring
    ctx.strokeStyle = deepSapphire;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, 230, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = glowCyan;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 222, 0, Math.PI * 2);
    ctx.stroke();

    // 32 Astrological/Daedric tick marks around perimeter
    for (let i = 0; i < 32; i++) {
      const angle = (i / 32) * Math.PI * 2;
      const len = i % 4 === 0 ? 12 : 6;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * (222 - len), cy + Math.sin(angle) * (222 - len));
      ctx.lineTo(cx + Math.cos(angle) * 222, cy + Math.sin(angle) * 222);
      ctx.stroke();
    }

    // Interlocking Mystical Nonagram / Triangles
    ctx.strokeStyle = glowCyan;
    ctx.lineWidth = 3;
    for (let rot = 0; rot < 3; rot++) {
      const baseA = (rot * Math.PI) / 4.5;
      ctx.beginPath();
      for (let pt = 0; pt < 3; pt++) {
        const a = baseA + (pt * Math.PI * 2) / 3;
        const x = cx + Math.cos(a) * 175;
        const y = cy + Math.sin(a) * 175;
        if (pt === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // Mid Concentric Ring with Runes
    ctx.strokeStyle = deepSapphire;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 120, 0, Math.PI * 2);
    ctx.stroke();

    // 12 Daedric / Elder Script Runes
    ctx.strokeStyle = glowCyan;
    ctx.fillStyle = glowCyan;
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const rx = cx + Math.cos(a) * 148;
      const ry = cy + Math.sin(a) * 148;

      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(a + Math.PI / 2);

      // Procedural runic glyphs
      ctx.beginPath();
      ctx.moveTo(-7, -8);
      ctx.lineTo(0, 8);
      ctx.lineTo(7, -8);
      ctx.moveTo(-5, 0);
      ctx.lineTo(5, 0);
      if (i % 2 === 0) {
        ctx.moveTo(0, -8);
        ctx.lineTo(0, 8);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Core Arcane Well / Vortex
    const coreGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, 75);
    coreGrad.addColorStop(0, '#e0f2fe');
    coreGrad.addColorStop(0.3, '#38bdf8');
    coreGrad.addColorStop(0.7, '#0284c7');
    coreGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, 75, 0, Math.PI * 2);
    ctx.fill();

    // Swirling Central Sigil
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 45, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cx + Math.cos(a + 0.5) * 35, cy + Math.sin(a + 0.5) * 35, cx + Math.cos(a) * 45, cy + Math.sin(a) * 45);
      ctx.stroke();
    }

    const texture = this.createCrispCanvasTexture(canvas);
    return new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: 0x00b4d8,
      emissiveIntensity: 2.2,
      roughness: 0.85,
      metalness: 0.1
    });
  }

  createWinterholdAuroraMaterial() {
    if (typeof document === 'undefined') {
      return new THREE.MeshStandardMaterial({ color: 0x07111e, emissive: 0x06b6d4, emissiveIntensity: 0.8 });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Midnight Arctic Sky Gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, 512);
    skyGrad.addColorStop(0, '#020611');
    skyGrad.addColorStop(0.5, '#061325');
    skyGrad.addColorStop(1, '#0b1f38');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, 1024, 512);

    // Distant glittering stars
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 280; i++) {
      const sx = (i * 137.5) % 1024;
      const sy = (i * 61.3) % 360;
      const sz = ((i % 5) + 1) * 0.45;
      ctx.beginPath();
      ctx.arc(sx, sy, sz, 0, Math.PI * 2);
      ctx.fill();
    }

    // SWIRLING AURORA BOREALIS (Green, Cyan, & Violet ribbons)
    const drawAuroraCurtain = (startY, amp, colStart, colMid, colEnd) => {
      ctx.save();
      const grad = ctx.createLinearGradient(0, startY - 90, 0, startY + 90);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(0.3, colStart);
      grad.addColorStop(0.6, colMid);
      grad.addColorStop(1, 'transparent');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, startY);
      for (let x = 0; x <= 1024; x += 32) {
        const y = startY + Math.sin(x * 0.008) * amp + Math.cos(x * 0.018) * (amp * 0.5);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(1024, startY + 110);
      ctx.lineTo(0, startY + 110);
      ctx.closePath();
      ctx.fill();

      // Vertical vertical curtain rays
      ctx.strokeStyle = colMid;
      ctx.lineWidth = 1.5;
      for (let x = 20; x < 1024; x += 18) {
        if ((x * 13) % 7 === 0) {
          const y1 = startY + Math.sin(x * 0.008) * amp - 70;
          const y2 = y1 + 130;
          ctx.beginPath();
          ctx.moveTo(x, y1);
          ctx.lineTo(x, y2);
          ctx.stroke();
        }
      }
      ctx.restore();
    };

    // Layer 1: Violet upper atmospheric fringe
    drawAuroraCurtain(130, 45, 'rgba(168, 85, 247, 0.4)', 'rgba(139, 92, 246, 0.55)', 'transparent');
    // Layer 2: Radiant Emerald Green ribbon
    drawAuroraCurtain(190, 55, 'rgba(16, 185, 129, 0.65)', 'rgba(52, 211, 153, 0.85)', 'transparent');
    // Layer 3: Brilliant Cyan/Turquoise ribbon
    drawAuroraCurtain(240, 40, 'rgba(6, 182, 212, 0.7)', 'rgba(56, 189, 248, 0.9)', 'transparent');

    // Jagged Mountain Peaks of Winterhold & Sea of Ghosts
    ctx.fillStyle = '#060a14';
    ctx.beginPath();
    ctx.moveTo(0, 512);
    ctx.lineTo(0, 390);
    const peaks = [
      { x: 120, y: 310 }, { x: 210, y: 380 }, { x: 330, y: 280 }, { x: 440, y: 360 },
      { x: 560, y: 290 }, { x: 670, y: 370 }, { x: 790, y: 270 }, { x: 910, y: 350 }, { x: 1024, y: 320 }
    ];
    for (const p of peaks) {
      ctx.lineTo(p.x, p.y);
    }
    ctx.lineTo(1024, 512);
    ctx.closePath();
    ctx.fill();

    // Snow caps on peaks reflecting green aurora
    ctx.fillStyle = '#bbf7d0';
    for (const p of peaks) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 22, p.y + 35);
      ctx.lineTo(p.x + 22, p.y + 35);
      ctx.closePath();
      ctx.fill();
    }

    // Freezing Sea of Ghosts Water at horizon
    ctx.fillStyle = '#040812';
    ctx.fillRect(0, 440, 1024, 72);
    // Greenish aurora water reflection streaks
    ctx.fillStyle = 'rgba(52, 211, 153, 0.25)';
    for (let r = 445; r < 510; r += 9) {
      ctx.fillRect(160, r, 700, 2);
    }

    const texture = this.createCrispCanvasTexture(canvas);
    return new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: 0x10b981,
      emissiveIntensity: 2.2,
      roughness: 0.95,
      side: THREE.DoubleSide
    });
  }

  createMistyMountainsMaterial() {
    if (typeof document === 'undefined') {
      return new THREE.MeshStandardMaterial({ color: 0x07111e, emissive: 0x38bdf8, emissiveIntensity: 0.6 });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Deep Midnight Indigo Sky
    const skyGrad = ctx.createLinearGradient(0, 0, 0, 512);
    skyGrad.addColorStop(0, '#02040a');
    skyGrad.addColorStop(0.45, '#091124');
    skyGrad.addColorStop(0.8, '#14203d');
    skyGrad.addColorStop(1.0, '#1c2b4d');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, 1024, 512);

    // Distant glittering stars
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 220; i++) {
      const sx = (i * 157.3) % 1024;
      const sy = (i * 73.1) % 320;
      const sz = ((i % 4) + 1) * 0.45;
      ctx.beginPath();
      ctx.arc(sx, sy, sz, 0, Math.PI * 2);
      ctx.fill();
    }

    // Luminous Silver Crescent Moon with Soft Aura
    const moonX = 760, moonY = 110, moonR = 36;
    const moonAura = ctx.createRadialGradient(moonX, moonY, 15, moonX, moonY, 90);
    moonAura.addColorStop(0, 'rgba(224, 242, 254, 0.4)');
    moonAura.addColorStop(0.5, 'rgba(186, 230, 253, 0.15)');
    moonAura.addColorStop(1, 'transparent');
    ctx.fillStyle = moonAura;
    ctx.beginPath();
    ctx.arc(moonX, moonY, 90, 0, Math.PI * 2);
    ctx.fill();

    // Crescent Moon
    ctx.save();
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(moonX - 14, moonY - 6, moonR - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Layer 1: Distant Craggy Alpine Peaks
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(0, 512);
    ctx.lineTo(0, 340);
    const peaksL1 = [
      { x: 90, y: 240 }, { x: 180, y: 310 }, { x: 290, y: 220 }, { x: 410, y: 320 },
      { x: 530, y: 210 }, { x: 640, y: 300 }, { x: 770, y: 230 }, { x: 890, y: 310 }, { x: 1024, y: 250 }
    ];
    for (const p of peaksL1) ctx.lineTo(p.x, p.y);
    ctx.lineTo(1024, 512);
    ctx.closePath();
    ctx.fill();

    // Snow caps on distant peaks reflecting moonlight
    ctx.fillStyle = 'rgba(224, 242, 254, 0.6)';
    for (const p of peaksL1) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 26, p.y + 38);
      ctx.lineTo(p.x + 26, p.y + 38);
      ctx.closePath();
      ctx.fill();
    }

    // Atmospheric valley mist between mountain tiers
    const mistGrad = ctx.createLinearGradient(0, 280, 0, 390);
    mistGrad.addColorStop(0, 'transparent');
    mistGrad.addColorStop(0.5, 'rgba(148, 163, 184, 0.22)');
    mistGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = mistGrad;
    ctx.fillRect(0, 280, 1024, 110);

    // Layer 2: Midground Mountain Ridges
    ctx.fillStyle = '#090d18';
    ctx.beginPath();
    ctx.moveTo(0, 512);
    ctx.lineTo(0, 370);
    const peaksL2 = [
      { x: 140, y: 330 }, { x: 260, y: 390 }, { x: 380, y: 310 }, { x: 500, y: 370 },
      { x: 620, y: 320 }, { x: 740, y: 380 }, { x: 860, y: 300 }, { x: 970, y: 360 }, { x: 1024, y: 340 }
    ];
    for (const p of peaksL2) ctx.lineTo(p.x, p.y);
    ctx.lineTo(1024, 512);
    ctx.closePath();
    ctx.fill();

    // Layer 3: Foreground Pine Forest Silhouettes
    ctx.fillStyle = '#04060c';
    for (let x = 0; x < 1024; x += 14) {
      const treeH = 65 + ((x * 37) % 45);
      const treeY = 440 - ((x * 19) % 30);
      ctx.beginPath();
      ctx.moveTo(x, treeY);
      ctx.lineTo(x - 9, treeY + treeH);
      ctx.lineTo(x + 9, treeY + treeH);
      ctx.closePath();
      ctx.fill();
    }

    const texture = this.createCrispCanvasTexture(canvas);
    return new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: 0x93c5fd,
      emissiveIntensity: 1.1,
      roughness: 0.95,
      side: THREE.DoubleSide
    });
  }

  createWinterholdBannerMaterial() {
    if (typeof document === 'undefined') {
      return new THREE.MeshStandardMaterial({ color: 0x0f172a });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Midnight navy wool fabric
    ctx.fillStyle = '#0a1024';
    ctx.fillRect(0, 0, 256, 512);

    // Silver woven border
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 4;
    ctx.strokeRect(16, 16, 224, 480);

    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(22, 22, 212, 468);

    // Mystical Eye of Magnus Emblem (College of Winterhold Sigil)
    const cx = 128;
    const cy = 200;

    // Outer celestial radiant sunburst
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const len = i % 2 === 0 ? 68 : 52;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 44, cy + Math.sin(a) * 44);
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.stroke();
    }

    // Outer Eye Arc
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(cx - 52, cy);
    ctx.quadraticCurveTo(cx, cy - 38, cx + 52, cy);
    ctx.quadraticCurveTo(cx, cy + 38, cx - 52, cy);
    ctx.fill();
    ctx.stroke();

    // Inner Iris & Pupil
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#090d16';
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fill();

    // Daedric Arcane Inscriptions underneath
    ctx.fillStyle = '#cbd5e1';
    ctx.font = 'bold 13px serif';
    ctx.textAlign = 'center';
    ctx.fillText('W I N T E R H O L D', cx, 320);

    ctx.font = '10px monospace';
    ctx.fillText('• ACADEMIA ARCANUM •', cx, 342);

    // Bottom swallowtail fringe
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(16, 490);
    ctx.lineTo(cx, 440);
    ctx.lineTo(240, 490);
    ctx.stroke();

    const texture = this.createCrispCanvasTexture(canvas);
    return new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.85,
      metalness: 0.05
    });
  }

  createGrimoirePageMaterial() {
    if (typeof document === 'undefined') {
      return new THREE.MeshStandardMaterial({ color: 0xdfcfad });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // Ancient aged vellum
    ctx.fillStyle = '#dfd1b0';
    ctx.fillRect(0, 0, 256, 256);

    // Weathered edge staining
    ctx.fillStyle = 'rgba(120, 90, 50, 0.2)';
    ctx.fillRect(0, 0, 256, 12);
    ctx.fillRect(0, 244, 256, 12);
    ctx.fillRect(0, 0, 12, 256);
    ctx.fillRect(244, 0, 12, 256);

    // Inked Alchemical / Daedric Circle
    ctx.strokeStyle = '#3e2e1e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(128, 90, 44, 0, Math.PI * 2);
    ctx.stroke();

    // Inner pentagram
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
      const x = 128 + Math.cos(a) * 44;
      const y = 90 + Math.sin(a) * 44;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();

    // Handwritten spell runes
    ctx.fillStyle = '#2c1e12';
    for (let line = 155; line < 235; line += 12) {
      for (let x = 28; x < 228; x += 10 + (line % 5)) {
        ctx.fillRect(x, line, 5 + ((x * line) % 6), 2);
      }
    }

    const texture = this.createCrispCanvasTexture(canvas);
    return new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.8
    });
  }

  createCobblestoneAlleyMaterial() {
    if (typeof document === 'undefined') {
      return new THREE.MeshStandardMaterial({ color: 0x111625, emissive: 0xf59e0b, emissiveIntensity: 0.5 });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Twilight Dusk Indigo-to-Amber Sky
    const skyGrad = ctx.createLinearGradient(0, 0, 0, 512);
    skyGrad.addColorStop(0, '#060714');
    skyGrad.addColorStop(0.5, '#12182e');
    skyGrad.addColorStop(0.82, '#2d2238');
    skyGrad.addColorStop(1.0, '#42282a');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, 1024, 512);

    // Stars
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 120; i++) {
      const sx = (i * 187.3) % 1024;
      const sy = (i * 83.1) % 240;
      ctx.fillRect(sx, sy, 1.2, 1.2);
    }

    // Distant Gothic Spires and Roofs
    ctx.fillStyle = '#101524';
    ctx.beginPath();
    ctx.moveTo(0, 512);
    ctx.lineTo(0, 320);
    const spires = [
      { x: 120, y: 220 }, { x: 150, y: 320 }, { x: 260, y: 260 }, { x: 340, y: 340 },
      { x: 480, y: 190 }, { x: 520, y: 310 }, { x: 680, y: 240 }, { x: 740, y: 330 },
      { x: 880, y: 210 }, { x: 920, y: 310 }, { x: 1024, y: 280 }
    ];
    for (const s of spires) ctx.lineTo(s.x, s.y);
    ctx.lineTo(1024, 512);
    ctx.closePath();
    ctx.fill();

    // Midground Medieval Half-Timbered Buildings & Gable Silhouettes
    ctx.fillStyle = '#080a12';
    const gables = [
      [0, 260, 160, 252], [140, 210, 200, 302], [320, 240, 180, 272],
      [480, 200, 220, 312], [680, 230, 190, 282], [850, 210, 180, 302]
    ];
    for (const [gx, gy, gw] of gables) {
      ctx.beginPath();
      ctx.moveTo(gx, 512);
      ctx.lineTo(gx, gy + 40);
      ctx.lineTo(gx + gw / 2, gy);
      ctx.lineTo(gx + gw, gy + 40);
      ctx.lineTo(gx + gw, 512);
      ctx.closePath();
      ctx.fill();

      // Chimney
      ctx.fillRect(gx + gw * 0.75, gy - 25, 22, 35);
    }

    // Glowing Amber Windows in Buildings
    ctx.fillStyle = '#f59e0b';
    for (const [gx, gy, gw] of gables) {
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 3; c++) {
          const wx = gx + 25 + c * (gw / 4);
          const wy = gy + 65 + r * 35;
          if (wx + 16 < gx + gw) {
            ctx.fillRect(wx, wy, 14, 20);
          }
        }
      }
    }

    // Hanging Street Lanterns with Warm Halo Glow
    for (let lx = 80; lx < 1024; lx += 220) {
      const ly = 370 + ((lx * 7) % 30);
      const rad = ctx.createRadialGradient(lx, ly, 4, lx, ly, 45);
      rad.addColorStop(0, 'rgba(251, 191, 36, 0.9)');
      rad.addColorStop(0.3, 'rgba(245, 158, 11, 0.4)');
      rad.addColorStop(1, 'transparent');
      ctx.fillStyle = rad;
      ctx.beginPath();
      ctx.arc(lx, ly, 45, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fffbeb';
      ctx.beginPath();
      ctx.arc(lx, ly, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Alley Cobblestones Reflection Ground
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 440, 1024, 72);

    const texture = this.createCrispCanvasTexture(canvas);
    return new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.9,
      roughness: 0.95,
      side: THREE.DoubleSide
    });
  }

  createStormyBastionMaterial() {
    if (typeof document === 'undefined') {
      return new THREE.MeshStandardMaterial({ color: 0x0c0d16, emissive: 0xf97316, emissiveIntensity: 0.4 });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Thunderous Storm Cloud Sky
    const skyGrad = ctx.createLinearGradient(0, 0, 0, 512);
    skyGrad.addColorStop(0, '#05050a');
    skyGrad.addColorStop(0.4, '#10101c');
    skyGrad.addColorStop(0.75, '#1e1c29');
    skyGrad.addColorStop(1.0, '#15131c');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, 1024, 512);

    // Billowing Storm Clouds
    const drawCloud = (cx, cy, r, col) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.arc(cx + r * 0.7, cy - r * 0.2, r * 0.8, 0, Math.PI * 2);
      ctx.arc(cx - r * 0.7, cy - r * 0.1, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    };
    for (let i = 0; i < 14; i++) {
      const cx = (i * 85) % 1024;
      const cy = 110 + ((i * 37) % 130);
      drawCloud(cx, cy, 65, 'rgba(30, 27, 43, 0.45)');
    }

    // Distant Jagged Mountain Crags
    ctx.fillStyle = '#0a0a12';
    ctx.beginPath();
    ctx.moveTo(0, 512);
    ctx.lineTo(0, 360);
    const crags = [
      { x: 140, y: 250 }, { x: 260, y: 350 }, { x: 420, y: 230 }, { x: 550, y: 330 },
      { x: 700, y: 220 }, { x: 840, y: 340 }, { x: 960, y: 260 }, { x: 1024, y: 320 }
    ];
    for (const c of crags) ctx.lineTo(c.x, c.y);
    ctx.lineTo(1024, 512);
    ctx.closePath();
    ctx.fill();

    // Foreground Fortress Ramparts & Crenellated Watchtowers
    ctx.fillStyle = '#040407';
    // Watchtower 1
    ctx.fillRect(200, 240, 110, 272);
    for (let k = 0; k < 4; k++) ctx.fillRect(200 + k * 28, 222, 16, 20);

    // Watchtower 2
    ctx.fillRect(720, 260, 100, 252);
    for (let k = 0; k < 4; k++) ctx.fillRect(720 + k * 26, 242, 14, 20);

    // Rampart wall connecting
    ctx.fillRect(0, 360, 1024, 152);
    for (let bx = 0; bx < 1024; bx += 36) ctx.fillRect(bx, 342, 20, 20);

    // Roaring Beacon Fire on Watchtower 1
    const fx = 255, fy = 215;
    const fireGrad = ctx.createRadialGradient(fx, fy, 5, fx, fy, 60);
    fireGrad.addColorStop(0, 'rgba(255, 237, 213, 1.0)');
    fireGrad.addColorStop(0.3, 'rgba(249, 115, 22, 0.7)');
    fireGrad.addColorStop(0.7, 'rgba(234, 88, 12, 0.25)');
    fireGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = fireGrad;
    ctx.beginPath();
    ctx.arc(fx, fy, 60, 0, Math.PI * 2);
    ctx.fill();

    // Beacon Iron Fire Basket
    ctx.fillStyle = '#0a0a10';
    ctx.fillRect(fx - 14, fy + 4, 28, 6);
    ctx.fillRect(fx - 10, fy + 10, 20, 12);

    const texture = this.createCrispCanvasTexture(canvas);
    return new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: 0xf97316,
      emissiveIntensity: 0.85,
      roughness: 0.95,
      side: THREE.DoubleSide
    });
  }

  createTwilightValleyMaterial() {
    if (typeof document === 'undefined') {
      return new THREE.MeshStandardMaterial({ color: 0x131320, emissive: 0xfbbf24, emissiveIntensity: 0.5 });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Rich Alpine Sunset Twilight Gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, 512);
    skyGrad.addColorStop(0, '#090d1e');
    skyGrad.addColorStop(0.4, '#1b1b38');
    skyGrad.addColorStop(0.7, '#6b2d35');
    skyGrad.addColorStop(0.88, '#b45309');
    skyGrad.addColorStop(1.0, '#d97706');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, 1024, 512);

    // Stars in Upper Sky
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 100; i++) {
      const sx = (i * 143.5) % 1024;
      const sy = (i * 61.2) % 200;
      ctx.fillRect(sx, sy, 1.2, 1.2);
    }

    // High Alpine Mountain Ridges with Sunset Rose/Alpenglow Snow
    ctx.fillStyle = '#141122';
    ctx.beginPath();
    ctx.moveTo(0, 512);
    ctx.lineTo(0, 310);
    const peaks = [
      { x: 130, y: 190 }, { x: 240, y: 280 }, { x: 380, y: 160 }, { x: 490, y: 270 },
      { x: 630, y: 180 }, { x: 750, y: 290 }, { x: 880, y: 200 }, { x: 1024, y: 290 }
    ];
    for (const p of peaks) ctx.lineTo(p.x, p.y);
    ctx.lineTo(1024, 512);
    ctx.closePath();
    ctx.fill();

    // Alpenglow snow on mountain crests
    ctx.fillStyle = 'rgba(254, 205, 211, 0.5)';
    for (const p of peaks) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 28, p.y + 40);
      ctx.lineTo(p.x + 28, p.y + 40);
      ctx.closePath();
      ctx.fill();
    }

    // Midground Pine Forest Ridges
    ctx.fillStyle = '#0a0a14';
    for (let x = 0; x < 1024; x += 12) {
      const treeH = 50 + ((x * 29) % 35);
      const treeY = 380 - ((x * 17) % 25);
      ctx.beginPath();
      ctx.moveTo(x, treeY);
      ctx.lineTo(x - 8, treeY + treeH);
      ctx.lineTo(x + 8, treeY + treeH);
      ctx.closePath();
      ctx.fill();
    }

    // Foreground Dark Valley Horizon
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 430, 1024, 82);

    const texture = this.createCrispCanvasTexture(canvas);
    return new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: 0xfbbf24,
      emissiveIntensity: 0.7,
      roughness: 0.95,
      side: THREE.DoubleSide
    });
  }

  createVillageSunsetMaterial() {
    if (typeof document === 'undefined') {
      return new THREE.MeshStandardMaterial({ color: 0x1a1218, emissive: 0xf59e0b, emissiveIntensity: 0.5 });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Medieval Village Golden Sunset Sky
    const skyGrad = ctx.createLinearGradient(0, 0, 0, 512);
    skyGrad.addColorStop(0, '#0c1224');
    skyGrad.addColorStop(0.35, '#201b38');
    skyGrad.addColorStop(0.68, '#6b2d42');
    skyGrad.addColorStop(0.85, '#b45309');
    skyGrad.addColorStop(1.0, '#f59e0b');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, 1024, 512);

    // Setting Sun with Golden Warm Aura
    const sunX = 480, sunY = 330;
    const sunAura = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 110);
    sunAura.addColorStop(0, 'rgba(254, 240, 138, 0.95)');
    sunAura.addColorStop(0.4, 'rgba(245, 158, 11, 0.5)');
    sunAura.addColorStop(1, 'transparent');
    ctx.fillStyle = sunAura;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 110, 0, Math.PI * 2);
    ctx.fill();

    // Rolling Hills Horizon
    ctx.fillStyle = '#161320';
    ctx.beginPath();
    ctx.moveTo(0, 512);
    ctx.lineTo(0, 360);
    ctx.quadraticCurveTo(280, 320, 560, 360);
    ctx.quadraticCurveTo(840, 330, 1024, 350);
    ctx.lineTo(1024, 512);
    ctx.closePath();
    ctx.fill();

    // Village Silhouettes: Thatched Roof Cottages & Church Spire
    ctx.fillStyle = '#08080f';
    // Church Spire
    ctx.beginPath();
    ctx.moveTo(340, 370);
    ctx.lineTo(340, 270);
    ctx.lineTo(355, 170); // Spire peak
    ctx.lineTo(370, 270);
    ctx.lineTo(370, 370);
    ctx.closePath();
    ctx.fill();

    // Thatched Cottages
    const cottages = [[110, 350, 90], [210, 340, 80], [600, 350, 95], [720, 340, 85], [830, 350, 90]];
    for (const [cx, cy, cw] of cottages) {
      ctx.fillRect(cx, cy + 20, cw, 60);
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy + 20);
      ctx.lineTo(cx + cw / 2, cy - 15);
      ctx.lineTo(cx + cw + 10, cy + 20);
      ctx.closePath();
      ctx.fill();

      // Chimney smoke
      ctx.fillRect(cx + cw * 0.7, cy - 25, 12, 20);
    }

    // Glowing Village Windows
    ctx.fillStyle = '#fef08a';
    for (const [cx, cy, cw] of cottages) {
      ctx.fillRect(cx + 20, cy + 35, 12, 14);
      ctx.fillRect(cx + cw - 32, cy + 35, 12, 14);
    }

    const texture = this.createCrispCanvasTexture(canvas);
    return new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.8,
      roughness: 0.95,
      side: THREE.DoubleSide
    });
  }
}

