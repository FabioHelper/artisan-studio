import * as THREE from 'three';

/**
 * MEDIEVAL TAVERN INTERIOR BUILDER
 * Generates instanced floorboards, plaster walls, exposed dark oak beams,
 * masonry hearth with coals, table, dishes, benches, rug, chest, and painting.
 * Direct implementation matching Screenshot 2.
 */
export function buildMedievalTavern(materials) {
  const root = new THREE.Group();

  const ROOM_W = 6.2;
  const ROOM_D = 4.8;
  const ROOM_H = 2.9;

  const oakMat = materials.get('wood.dark_oak');
  const weatheredMat = materials.get('wood.weathered_oak');
  const floorMat = materials.get('wood.floor_oak');
  const plasterMat = materials.get('plaster.lime_warm');
  const ironMat = materials.get('metal.forged_iron');
  const stoneMat = materials.get('stone.hearth');
  const fireMat = materials.get('ember');

  // --- 1. FLOORBOARDS (Instanced Mesh for AAA Draw Call Efficiency) ---
  const plankW = 0.42;
  const plankL = ROOM_D;
  const plankGeo = new THREE.BoxGeometry(plankW - 0.02, 0.06, plankL);
  const plankCount = Math.floor(ROOM_W / plankW);

  const instancedFloor = new THREE.InstancedMesh(plankGeo, floorMat, plankCount);
  instancedFloor.receiveShadow = true;
  const dummy = new THREE.Object3D();

  for (let i = 0; i < plankCount; i++) {
    dummy.position.set((i - plankCount / 2 + 0.5) * plankW, -0.03, 0);
    dummy.updateMatrix();
    instancedFloor.setMatrixAt(i, dummy.matrix);
  }
  instancedFloor.instanceMatrix.needsUpdate = true;
  root.add(instancedFloor);

  // --- 2. PLASTER WALLS ---
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W, ROOM_H, 0.15), plasterMat);
  backWall.position.set(0, ROOM_H / 2, -ROOM_D / 2);
  backWall.receiveShadow = true;
  root.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.15, ROOM_H, ROOM_D), plasterMat);
  leftWall.position.set(-ROOM_W / 2, ROOM_H / 2, 0);
  leftWall.receiveShadow = true;
  root.add(leftWall);

  // --- 3. TIMBER FRAME POSTS & CEILING BEAMS ---
  const timberGroup = new THREE.Group();
  const colGeo = new THREE.BoxGeometry(0.18, ROOM_H + 0.1, 0.18);

  // Left wall vertical posts
  for (let z = -ROOM_D / 2 + 0.2; z <= ROOM_D / 2 - 0.2; z += 1.1) {
    const post = new THREE.Mesh(colGeo, oakMat);
    post.position.set(-ROOM_W / 2 + 0.1, ROOM_H / 2, z);
    timberGroup.add(post);
  }

  // Back wall vertical posts
  for (let x = -ROOM_W / 2 + 1.2; x <= ROOM_W / 2 - 0.2; x += 1.4) {
    const post = new THREE.Mesh(colGeo, oakMat);
    post.position.set(x, ROOM_H / 2, -ROOM_D / 2 + 0.1);
    timberGroup.add(post);
  }

  // Ceiling Beams across room
  const beamGeo = new THREE.BoxGeometry(ROOM_W + 0.2, 0.22, 0.18);
  for (let z = -ROOM_D / 2 + 0.4; z <= ROOM_D / 2; z += 0.8) {
    const beam = new THREE.Mesh(beamGeo, oakMat);
    beam.position.set(0, ROOM_H - 0.1, z);
    beam.castShadow = true;
    timberGroup.add(beam);
  }
  root.add(timberGroup);

  // --- 4. BACK WALL WINDOW WITH DUSK SKY BACKDROP ---
  const windowGroup = new THREE.Group();
  windowGroup.position.set(0.1, 1.9, -ROOM_D / 2 + 0.08);

  const winFrame = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.85, 0.1), ironMat);
  windowGroup.add(winFrame);

  const winGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.05, 0.7),
    new THREE.MeshBasicMaterial({ color: 0x223a5e })
  );
  winGlass.position.z = 0.051;
  windowGroup.add(winGlass);

  const mullionH = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.04, 0.06), ironMat);
  mullionH.position.z = 0.06;
  windowGroup.add(mullionH);

  const mullionV = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 0.06), ironMat);
  mullionV.position.z = 0.06;
  windowGroup.add(mullionV);

  root.add(windowGroup);

  // --- 5. TAVERN HEARTH FIREPLACE ---
  const hearth = new THREE.Group();
  hearth.position.set(1.7, 0, -ROOM_D / 2 + 0.35);

  const hearthFrame = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.85, 0.4), stoneMat);
  hearthFrame.position.y = 0.42;
  hearth.add(hearthFrame);

  const fireOpening = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.55, 0.45),
    new THREE.MeshBasicMaterial({ color: 0x050505 })
  );
  fireOpening.position.set(0, 0.35, 0.02);
  hearth.add(fireOpening);

  // Glowing Ember Stones
  for (let i = 0; i < 7; i++) {
    const emberStone = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 6, 6),
      fireMat
    );
    emberStone.position.set((i - 3) * 0.14, 0.14, 0.12);
    hearth.add(emberStone);
  }
  root.add(hearth);

  // --- 6. WALL PAINTING (Sun Mountain Crest) ---
  const painting = new THREE.Group();
  painting.position.set(2.1, 2.05, -ROOM_D / 2 + 0.1);
  const paintFrame = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.95, 0.06), oakMat);
  painting.add(paintFrame);

  const paintCanvas = new THREE.Mesh(
    new THREE.PlaneGeometry(0.98, 0.78),
    materials.get('cloth.painted_panel')
  );
  paintCanvas.position.z = 0.035;
  painting.add(paintCanvas);
  root.add(painting);

  // --- 7. WOVEN GEOMETRIC RUG ---
  const rug = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 1.4),
    materials.get('cloth.woven_rug')
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0.1, 0.01, 0.3);
  rug.receiveShadow = true;
  root.add(rug);

  // --- 8. OAK DINING TABLE WITH DISHES ---
  const table = new THREE.Group();
  table.position.set(0.1, 0, 0.2);

  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 0.95), oakMat);
  tableTop.position.y = 0.78;
  tableTop.castShadow = true;
  tableTop.receiveShadow = true;
  table.add(tableTop);

  const legGeo = new THREE.BoxGeometry(0.12, 0.74, 0.12);
  const legPositions = [
    [-0.9, 0.37, -0.36],
    [0.9, 0.37, -0.36],
    [-0.9, 0.37, 0.36],
    [0.9, 0.37, 0.36]
  ];
  legPositions.forEach(pos => {
    const leg = new THREE.Mesh(legGeo, oakMat);
    leg.position.set(...pos);
    table.add(leg);
  });

  // Tableware: 6 ceramic dishes
  const dishMat = materials.get('ceramic.dish');
  for (let i = 0; i < 6; i++) {
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.035, 10), dishMat);
    dish.position.set(-0.65 + (i % 3) * 0.65, 0.85, (i < 3 ? -0.2 : 0.2));
    table.add(dish);
  }
  root.add(table);

  // --- 9. FRONT WOODEN BENCH ---
  const benchFront = new THREE.Group();
  benchFront.position.set(0.1, 0, 0.95);
  const benchTop = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.07, 0.32), oakMat);
  benchTop.position.y = 0.45;
  benchFront.add(benchTop);

  const bLeg1 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.42, 0.26), oakMat);
  bLeg1.position.set(-0.7, 0.21, 0);
  benchFront.add(bLeg1);

  const bLeg2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.42, 0.26), oakMat);
  bLeg2.position.set(0.7, 0.21, 0);
  benchFront.add(bLeg2);
  root.add(benchFront);

  // --- 10. COZY BENCH WITH CUSHION (Left Side) ---
  const benchLeft = new THREE.Group();
  benchLeft.position.set(-1.8, 0, 0.2);
  benchLeft.rotation.y = Math.PI / 2;

  const benchLBase = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.42, 0.6), weatheredMat);
  benchLBase.position.y = 0.21;
  benchLeft.add(benchLBase);

  const cushion = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.55), materials.get('cloth.woven_cushion'));
  cushion.position.y = 0.48;
  benchLeft.add(cushion);

  const benchBack = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 0.12), weatheredMat);
  benchBack.position.set(0, 0.8, -0.25);
  benchLeft.add(benchBack);
  root.add(benchLeft);

  // --- 11. STORAGE CHEST WITH IRON STRAPS ---
  const chest = new THREE.Group();
  chest.position.set(1.1, 0, 1.45);

  const chestBody = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.55, 0.55), weatheredMat);
  chestBody.position.y = 0.28;
  chest.add(chestBody);

  const strapGeo = new THREE.BoxGeometry(0.06, 0.57, 0.57);
  const strap1 = new THREE.Mesh(strapGeo, ironMat);
  strap1.position.set(-0.3, 0.28, 0);
  chest.add(strap1);

  const strap2 = new THREE.Mesh(strapGeo, ironMat);
  strap2.position.set(0.3, 0.28, 0);
  chest.add(strap2);

  // Rolled parchment scroll
  const scroll = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.65, 8), oakMat);
  scroll.rotateZ(Math.PI / 2.3);
  scroll.position.set(0.4, 0.08, 1.6);
  root.add(scroll);

  root.add(chest);

  // --- 12. CHANDELIER BEAMS ---
  const chandelier = new THREE.Group();
  chandelier.position.set(-0.2, 2.2, -0.6);
  for (let i = 0; i < 4; i++) {
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.15, 6), dishMat);
    candle.position.set((i - 1.5) * 0.18, 0, 0);
    chandelier.add(candle);
  }
  root.add(chandelier);

  return root;
}
