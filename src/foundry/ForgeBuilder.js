import * as THREE from 'three';

/**
 * FORGE HERO TRIO BUILDER
 * Generates Stone Chimney Hearth, Anvil on Strapped Stump, and Workshop Bellows.
 * Direct implementation matching Screenshot 1.
 */
export function buildForgeHeroTrio(materials) {
  const root = new THREE.Group();

  // --- 1. STONE HEARTH & CHIMNEY ---
  const hearthGroup = new THREE.Group();
  hearthGroup.position.set(-1.6, 0, -0.6);

  // Brick masonry base
  const brickGeo = new THREE.BoxGeometry(0.32, 0.18, 0.28);
  const stoneMat = materials.get('stone.hearth');
  const chimneyMat = materials.get('stone.rough_local');

  for (let y = 0; y < 4; y++) {
    for (let x = -2; x <= 2; x++) {
      if (y >= 1 && y <= 2 && x >= -1 && x <= 1) continue; // Firebox chamber
      const brick = new THREE.Mesh(brickGeo, stoneMat);
      brick.position.set(x * 0.33, y * 0.19 + 0.1, 0);
      brick.rotation.y = Math.sin(x * 3 + y) * 0.04;
      hearthGroup.add(brick);
    }
  }

  // Dark Firebox Interior Void (provides rich contrast for glowing embers)
  const fireboxVoid = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 0.54, 0.25),
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.98 })
  );
  fireboxVoid.position.set(0, 0.38, -0.06);
  hearthGroup.add(fireboxVoid);

  // Hearth backwall
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.2, 0.2), stoneMat);
  backWall.position.set(0, 0.6, -0.2);
  hearthGroup.add(backWall);

  // Pyramidal Chimney Hood (Authentic Muted Slate/Stone, Not White)
  const hoodGeo = new THREE.CylinderGeometry(0.45, 0.95, 1.2, 4);
  hoodGeo.rotateY(Math.PI / 4);
  const hood = new THREE.Mesh(hoodGeo, chimneyMat);
  hood.position.set(0, 1.45, 0.05);
  hearthGroup.add(hood);

  // Chimney Flue (Matching Slate/Stone)
  const flue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.4, 0.55), chimneyMat);
  flue.position.set(0, 2.7, 0.05);
  hearthGroup.add(flue);

  // Embers & Glowing Fire Cones
  const fireMat = materials.get('ember');
  const fireConeGeo = new THREE.ConeGeometry(0.08, 0.25, 5);
  for (let i = 0; i < 4; i++) {
    const fire = new THREE.Mesh(fireConeGeo, fireMat);
    fire.position.set((i - 1.5) * 0.18, 0.45, -0.05);
    hearthGroup.add(fire);
  }
  root.add(hearthGroup);

  // --- 2. BLACKSMITH ANVIL ON STRAPPED STUMP ---
  const anvilGroup = new THREE.Group();
  anvilGroup.position.set(0.1, 0, 0.4);

  // Wooden log base
  const stump = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.46, 0.52, 14),
    materials.get('wood.weathered_oak')
  );
  stump.position.y = 0.26;
  anvilGroup.add(stump);

  // Forged iron strap around stump
  const hoop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.44, 0.44, 0.05, 14),
    materials.get('metal.forged_iron')
  );
  hoop.position.y = 0.38;
  anvilGroup.add(hoop);

  // Anvil body
  const ironMat = materials.get('metal.forged_iron');
  const polishedMat = materials.get('metal.polished_iron');

  const anvilBase = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.35), ironMat);
  anvilBase.position.y = 0.58;
  anvilGroup.add(anvilBase);

  const anvilWaist = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.24), ironMat);
  anvilWaist.position.y = 0.72;
  anvilGroup.add(anvilWaist);

  const anvilFace = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.14, 0.32), polishedMat);
  anvilFace.position.set(0.05, 0.88, 0);
  anvilGroup.add(anvilFace);

  const hornGeo = new THREE.ConeGeometry(0.14, 0.42, 8);
  hornGeo.rotateZ(-Math.PI / 2);
  const horn = new THREE.Mesh(hornGeo, polishedMat);
  horn.position.set(0.66, 0.88, 0);
  anvilGroup.add(horn);

  const heel = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.28), ironMat);
  heel.position.set(-0.48, 0.85, 0);
  anvilGroup.add(heel);

  root.add(anvilGroup);

  // --- 3. FORGE BELLOWS MECHANISM ---
  const bellowsGroup = new THREE.Group();
  bellowsGroup.position.set(1.5, 0, -0.3);
  bellowsGroup.rotation.y = -0.15;

  const oakMat = materials.get('wood.dark_oak');

  // Skid trestle
  const skid = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.45), oakMat);
  skid.position.set(0, 0.04, 0);
  bellowsGroup.add(skid);

  const postL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.1), oakMat);
  postL.position.set(-0.55, 0.34, 0);
  bellowsGroup.add(postL);

  const postR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.48, 0.1), oakMat);
  postR.position.set(0.42, 0.28, 0);
  bellowsGroup.add(postR);

  // Bellows body
  const plateTop = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.08, 0.38), oakMat);
  plateTop.position.set(-0.1, 0.58, 0);
  bellowsGroup.add(plateTop);

  const plateBottom = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.08, 0.38), oakMat);
  plateBottom.position.set(-0.1, 0.36, 0);
  bellowsGroup.add(plateBottom);

  const bladder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.16, 0.8, 10),
    materials.get('leather.worn')
  );
  bladder.rotateZ(Math.PI / 2);
  bladder.position.set(-0.1, 0.47, 0);
  bellowsGroup.add(bladder);

  // Iron nozzle
  const nozzleGeo = new THREE.CylinderGeometry(0.04, 0.09, 0.7, 10);
  nozzleGeo.rotateZ(-Math.PI / 2);
  const nozzle = new THREE.Mesh(nozzleGeo, ironMat);
  nozzle.position.set(0.75, 0.47, 0);
  bellowsGroup.add(nozzle);

  // Rocker arm
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.08), oakMat);
  lever.position.set(-0.5, 0.85, 0);
  lever.rotation.z = 0.25;
  bellowsGroup.add(lever);

  root.add(bellowsGroup);

  // Ground plane for shadow projection
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshStandardMaterial({ color: 0x1f232b, roughness: 0.9 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  root.add(ground);

  return root;
}
