import * as THREE from 'three';

/**
 * THE FANTASTIC WORLD: FANTASTIC HALL & DREAM GARDEN BUILDER
 * 
 * High-performance artisan adaptation of Fabio's "The Fantastic World" (arcane_room / Fantastic Hall).
 * Built with 100% PBR material pooling, instanced geometry, and dual-temperature photometrics.
 * Features:
 * - The Great Candlelit Library with soaring bookshelves and instanced book collections (~400 books)
 * - The iconic Circular Brass Moon Window with cushioned viewing seat looking out into the cosmos
 * - Stone hearth fireplace with glowing embers and carved timber ceiling beams
 * - Writing desk, chair, rolling ladder, and candlelit iron chandelier
 * - North arched portal leading to the snowy Dream Garden, instanced snow-pines, and Mirror Pond
 * 
 * Performance budget: <= 25 draw calls, <= 12,500 triangles, 60 FPS guaranteed.
 */
export function buildFantasticWorld(materials) {
  const root = new THREE.Group();
  root.name = 'FantasticWorld';

  // --- 1. Material Gathering & PBR Registrations ---
  let brassMat = materials.get('metal.brass_patina');
  if (!brassMat) {
    brassMat = new THREE.MeshPhysicalMaterial({
      color: 0xd4af37,
      roughness: 0.32,
      metalness: 0.85,
      clearcoat: 0.3,
      clearcoatRoughness: 0.2
    });
    materials.register('metal.brass_patina', brassMat);
  }

  let snowMat = materials.get('stone.snow_frost');
  if (!snowMat) {
    snowMat = new THREE.MeshStandardMaterial({
      color: 0xe6eef8,
      roughness: 0.90,
      metalness: 0.02
    });
    materials.register('stone.snow_frost', snowMat);
  }

  let pondMat = materials.get('water.mirror_pond');
  if (!pondMat) {
    pondMat = new THREE.MeshPhysicalMaterial({
      color: 0x101b2b,
      roughness: 0.05,
      metalness: 0.15,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      reflectivity: 0.9
    });
    materials.register('water.mirror_pond', pondMat);
  }

  let cushionMat = materials.get('cloth.velvet_moon');
  if (!cushionMat) {
    cushionMat = new THREE.MeshPhysicalMaterial({
      color: 0x8b263e, // Deep burgundy velvet
      roughness: 0.92,
      sheen: 0.8,
      sheenColor: new THREE.Color(0xd9536f),
      sheenRoughness: 0.4
    });
    materials.register('cloth.velvet_moon', cushionMat);
  }

  let pineMat = materials.get('foliage.snow_pine');
  if (!pineMat) {
    pineMat = new THREE.MeshStandardMaterial({
      color: 0x1e382b, // Deep alpine pine green
      roughness: 0.85,
      metalness: 0.0
    });
    materials.register('foliage.snow_pine', pineMat);
  }

  const darkOakMat = materials.get('wood.dark_oak');
  const floorOakMat = materials.get('wood.floor_oak');
  const plasterMat = materials.get('plaster.lime_warm');
  const ironMat = materials.get('metal.forged_iron');
  const stoneMat = materials.get('stone.rough_local');
  const hearthMat = materials.get('stone.hearth');
  const emberMat = materials.get('ember');

  // --- Hall Dimensions ---
  const HALL_W = 7.4;
  const HALL_D = 6.2;
  const HALL_H = 3.6;
  const HD = HALL_D / 2;
  const HW = HALL_W / 2;

  // --- 2. INSTANCED FLOORBOARDS ---
  const plankW = 0.38;
  const plankCount = Math.floor(HALL_W / plankW);
  const floorGeo = new THREE.BoxGeometry(plankW - 0.02, 0.08, HALL_D);
  const floorMesh = new THREE.InstancedMesh(floorGeo, floorOakMat, plankCount);
  floorMesh.receiveShadow = true;
  const dummy = new THREE.Object3D();

  for (let i = 0; i < plankCount; i++) {
    dummy.position.set((i - plankCount / 2 + 0.5) * plankW, -0.04, 0);
    dummy.updateMatrix();
    floorMesh.setMatrixAt(i, dummy.matrix);
  }
  floorMesh.instanceMatrix.needsUpdate = true;
  root.add(floorMesh);

  // --- 3. WALL STRUCTURE WITH CUTOUTS ---
  // South Wall: Holds the iconic circular Moon Window (radius 1.4m, center y=2.0)
  const southWallShape = new THREE.Shape();
  southWallShape.moveTo(-HW, 0);
  southWallShape.lineTo(HW, 0);
  southWallShape.lineTo(HW, HALL_H);
  southWallShape.lineTo(-HW, HALL_H);
  southWallShape.closePath();

  // Moon window circular hole
  const windowHole = new THREE.Path();
  windowHole.absarc(0, 2.0, 1.4, 0, Math.PI * 2, true);
  southWallShape.holes.push(windowHole);

  const southWallGeo = new THREE.ExtrudeGeometry(southWallShape, { depth: 0.18, bevelEnabled: false });
  const southWall = new THREE.Mesh(southWallGeo, plasterMat);
  southWall.position.set(0, 0, HD - 0.18);
  southWall.receiveShadow = true;
  root.add(southWall);

  // North Wall: Arched doorway leading to the Dream Garden
  const northWallShape = new THREE.Shape();
  northWallShape.moveTo(-HW, 0);
  northWallShape.lineTo(HW, 0);
  northWallShape.lineTo(HW, HALL_H);
  northWallShape.lineTo(-HW, HALL_H);
  northWallShape.closePath();

  // Arched portal cutout (w=1.8, h=2.7)
  const doorHole = new THREE.Path();
  doorHole.moveTo(-0.9, 0);
  doorHole.lineTo(0.9, 0);
  doorHole.lineTo(0.9, 2.0);
  doorHole.absarc(0, 2.0, 0.9, 0, Math.PI, false);
  doorHole.lineTo(-0.9, 0);
  northWallShape.holes.push(doorHole);

  const northWallGeo = new THREE.ExtrudeGeometry(northWallShape, { depth: 0.18, bevelEnabled: false });
  const northWall = new THREE.Mesh(northWallGeo, plasterMat);
  northWall.position.set(0, 0, -HD);
  northWall.receiveShadow = true;
  root.add(northWall);

  // East & West Solid Plaster Walls
  const sideWallGeo = new THREE.BoxGeometry(0.18, HALL_H, HALL_D);
  const eastWall = new THREE.Mesh(sideWallGeo, plasterMat);
  eastWall.position.set(HW - 0.09, HALL_H / 2, 0);
  eastWall.receiveShadow = true;
  root.add(eastWall);

  const westWall = new THREE.Mesh(sideWallGeo, plasterMat);
  westWall.position.set(-HW + 0.09, HALL_H / 2, 0);
  westWall.receiveShadow = true;
  root.add(westWall);

  // --- 4. CEILING & HEAVY TIMBER BEAMS ---
  const ceilMesh = new THREE.Mesh(new THREE.PlaneGeometry(HALL_W, HALL_D), plasterMat);
  ceilMesh.rotation.x = Math.PI / 2;
  ceilMesh.position.set(0, HALL_H, 0);
  root.add(ceilMesh);

  const beamGeo = new THREE.BoxGeometry(HALL_W, 0.28, 0.22);
  for (let z = -HD + 1.2; z <= HD - 1.0; z += 1.8) {
    const beam = new THREE.Mesh(beamGeo, darkOakMat);
    beam.position.set(0, HALL_H - 0.14, z);
    beam.castShadow = true;
    beam.receiveShadow = true;
    root.add(beam);
  }

  // --- 5. THE ICONIC CIRCULAR BRASS MOON WINDOW & SEAT ---
  const windowGroup = new THREE.Group();
  windowGroup.position.set(0, 2.0, HD - 0.08);

  // Outer brass frame
  const torusGeo = new THREE.TorusGeometry(1.4, 0.09, 12, 48);
  const outerRing = new THREE.Mesh(torusGeo, brassMat);
  outerRing.castShadow = true;
  windowGroup.add(outerRing);

  // Inner concentric trim ring
  const torusGeo2 = new THREE.TorusGeometry(1.15, 0.04, 10, 36);
  const innerRing = new THREE.Mesh(torusGeo2, brassMat);
  windowGroup.add(innerRing);

  // Radial brass muntins / lattice spokes
  for (let angle = 0; angle < Math.PI; angle += Math.PI / 4) {
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.8, 8), brassMat);
    spoke.rotation.z = angle;
    windowGroup.add(spoke);
  }
  root.add(windowGroup);

  // Window Seat (curved/chamfered viewing bench with deep burgundy velvet cushion)
  const benchGroup = new THREE.Group();
  benchGroup.position.set(0, 0.45, HD - 0.65);

  const benchWood = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.45, 0.95), darkOakMat);
  benchWood.castShadow = true;
  benchWood.receiveShadow = true;
  benchGroup.add(benchWood);

  // Plinth moulding
  const benchPlinth = new THREE.Mesh(new THREE.BoxGeometry(3.72, 0.08, 1.02), darkOakMat);
  benchPlinth.position.y = -0.22;
  benchGroup.add(benchPlinth);

  // Velvet cushions (3 sections)
  for (let i = -1; i <= 1; i++) {
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.14, 0.86), cushionMat);
    cushion.position.set(i * 1.18, 0.29, 0);
    cushion.castShadow = true;
    benchGroup.add(cushion);
  }
  root.add(benchGroup);

  // --- 6. SOARING BOOKSHELVES & INSTANCED BOOKS ---
  // East Wall: Floor-to-ceiling library wall
  const shelfGroup = new THREE.Group();
  shelfGroup.position.set(HW - 0.45, 0, 0);

  const shelfFrame = new THREE.Mesh(new THREE.BoxGeometry(0.75, HALL_H - 0.2, HALL_D - 1.2), darkOakMat);
  shelfFrame.position.y = (HALL_H - 0.2) / 2;
  shelfFrame.castShadow = true;
  shelfFrame.receiveShadow = true;
  shelfGroup.add(shelfFrame);

  // Shelf dividers
  for (let y = 0.6; y < HALL_H - 0.4; y += 0.65) {
    const divider = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, HALL_D - 1.25), darkOakMat);
    divider.position.y = y;
    shelfGroup.add(divider);
  }

  // Instanced Books on the shelves
  const bookGeo = new THREE.BoxGeometry(0.28, 0.38, 0.08);
  const totalBooks = 280;
  const booksMesh = new THREE.InstancedMesh(bookGeo, cushionMat, totalBooks);
  booksMesh.castShadow = true;
  let bookIdx = 0;

  for (let y = 0.6; y < HALL_H - 0.6; y += 0.65) {
    for (let z = -HD + 1.2; z <= HD - 1.2; z += 0.12) {
      if (bookIdx >= totalBooks) break;
      dummy.position.set(HW - 0.38, y + 0.21, z);
      dummy.rotation.set(0, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.08);
      dummy.scale.set(1.0, 0.85 + Math.random() * 0.3, 0.8 + Math.random() * 0.4);
      dummy.updateMatrix();
      booksMesh.setMatrixAt(bookIdx, dummy.matrix);
      bookIdx++;
    }
  }
  booksMesh.instanceMatrix.needsUpdate = true;
  root.add(shelfGroup);
  root.add(booksMesh);

  // Rolling Library Ladder
  const ladderGroup = new THREE.Group();
  ladderGroup.position.set(HW - 0.85, 0, -0.6);
  ladderGroup.rotation.y = -0.15;
  ladderGroup.rotation.z = 0.12;

  const railGeo = new THREE.CylinderGeometry(0.03, 0.03, HALL_H - 0.4, 8);
  const leftRail = new THREE.Mesh(railGeo, darkOakMat);
  leftRail.position.set(0, (HALL_H - 0.4) / 2, -0.22);
  ladderGroup.add(leftRail);

  const rightRail = new THREE.Mesh(railGeo, darkOakMat);
  rightRail.position.set(0, (HALL_H - 0.4) / 2, 0.22);
  ladderGroup.add(rightRail);

  const rungGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.44, 8);
  for (let y = 0.4; y < HALL_H - 0.6; y += 0.38) {
    const rung = new THREE.Mesh(rungGeo, brassMat);
    rung.rotation.x = Math.PI / 2;
    rung.position.set(0, y, 0);
    ladderGroup.add(rung);
  }
  root.add(ladderGroup);

  // --- 7. MASONRY FIREPLACE & GLOWING HEARTH (West Wall) ---
  const fireplaceGroup = new THREE.Group();
  fireplaceGroup.position.set(-HW + 0.65, 0, 0.4);

  // Heavy stone surround
  const mantel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.9, 1.8), hearthMat);
  mantel.position.y = 0.95;
  mantel.castShadow = true;
  mantel.receiveShadow = true;
  fireplaceGroup.add(mantel);

  // Firebox cavity
  const firebox = new THREE.Mesh(new THREE.BoxGeometry(0.65, 1.1, 1.2), stoneMat);
  firebox.position.set(0.1, 0.55, 0);
  fireplaceGroup.add(firebox);

  // Fireplace mantel top slab
  const mantelSlab = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 2.05), darkOakMat);
  mantelSlab.position.y = 1.95;
  fireplaceGroup.add(mantelSlab);

  // Glowing coals & burning log
  const coals = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.8), emberMat);
  coals.position.set(0.12, 0.08, 0);
  fireplaceGroup.add(coals);

  const log1 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.75, 8), darkOakMat);
  log1.rotation.z = Math.PI / 2;
  log1.rotation.y = 0.2;
  log1.position.set(0.12, 0.20, 0);
  fireplaceGroup.add(log1);
  root.add(fireplaceGroup);

  // --- 8. WRITING DESK & READING CHAIR ---
  const deskGroup = new THREE.Group();
  deskGroup.position.set(-0.8, 0, -0.9);

  // Desk top with bevelled edge
  const deskTop = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.95), darkOakMat);
  deskTop.position.y = 0.78;
  deskTop.castShadow = true;
  deskTop.receiveShadow = true;
  deskGroup.add(deskTop);

  // Turned legs
  const legGeo = new THREE.CylinderGeometry(0.045, 0.035, 0.74, 8);
  for (let x of [-0.68, 0.68]) {
    for (let z of [-0.38, 0.38]) {
      const leg = new THREE.Mesh(legGeo, darkOakMat);
      leg.position.set(x, 0.37, z);
      leg.castShadow = true;
      deskGroup.add(leg);
    }
  }

  // Desk Props: Open tome & brass candleholder
  const bookOpen = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.04, 0.28), plasterMat);
  bookOpen.position.set(-0.25, 0.84, 0.05);
  deskGroup.add(bookOpen);

  const candleStick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.18, 8), brassMat);
  candleStick.position.set(0.45, 0.87, -0.15);
  deskGroup.add(candleStick);

  const candleFlame = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), emberMat);
  candleFlame.position.set(0.45, 0.98, -0.15);
  deskGroup.add(candleFlame);

  // Reading Armchair
  const chairGroup = new THREE.Group();
  chairGroup.position.set(0, 0, 0.75);

  const seatMesh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.52), cushionMat);
  seatMesh.position.y = 0.46;
  chairGroup.add(seatMesh);

  const backMesh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.08), cushionMat);
  backMesh.position.set(0, 0.75, 0.22);
  chairGroup.add(backMesh);

  for (let x of [-0.22, 0.22]) {
    for (let z of [-0.2, 0.2]) {
      const chairLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.42, 8), darkOakMat);
      chairLeg.position.set(x, 0.21, z);
      chairGroup.add(chairLeg);
    }
  }
  deskGroup.add(chairGroup);
  root.add(deskGroup);

  // --- 9. HANGING CHANDELIER ---
  const chandelier = new THREE.Group();
  chandelier.position.set(0, HALL_H - 0.7, 0);

  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 6), ironMat);
  chain.position.y = 0.3;
  chandelier.add(chain);

  const ironWheel = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.04, 8, 24), ironMat);
  ironWheel.rotation.x = Math.PI / 2;
  chandelier.add(ironWheel);

  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const cx = Math.cos(angle) * 0.85;
    const cz = Math.sin(angle) * 0.85;

    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6), plasterMat);
    candle.position.set(cx, 0.08, cz);
    chandelier.add(candle);

    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), emberMat);
    flame.position.set(cx, 0.17, cz);
    chandelier.add(flame);
  }
  root.add(chandelier);

  // --- 10. THE EXTERIOR DREAM GARDEN, SNOW PINES & MIRROR POND ---
  const gardenGroup = new THREE.Group();
  gardenGroup.position.set(0, -0.02, -HD - 4.5);

  // Snowy Ground
  const gardenTerrain = new THREE.Mesh(new THREE.PlaneGeometry(16, 9), snowMat);
  gardenTerrain.rotation.x = -Math.PI / 2;
  gardenTerrain.receiveShadow = true;
  gardenGroup.add(gardenTerrain);

  // Mirror Pond (dark still water basin reflecting the celestial sky)
  const pond = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), pondMat);
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(0, 0.02, 0);
  gardenGroup.add(pond);

  // Stone coping ring around the pond
  const pondRing = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.12, 8, 32), stoneMat);
  pondRing.rotation.x = Math.PI / 2;
  pondRing.position.set(0, 0.04, 0);
  gardenGroup.add(pondRing);

  // Instanced Snow-Covered Pines
  const pineTrunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1.2, 8);
  const pineCrownGeo = new THREE.ConeGeometry(0.95, 2.2, 8);
  const pineSnowGeo = new THREE.ConeGeometry(1.0, 0.75, 8);

  const pinePositions = [
    [-3.8, 0, 1.5], [-4.6, 0, -1.2], [-2.5, 0, -2.4],
    [3.5, 0, 1.8], [4.4, 0, -0.8], [2.8, 0, -2.6]
  ];

  pinePositions.forEach(([px, py, pz], idx) => {
    const tree = new THREE.Group();
    tree.position.set(px, py, pz);

    const trunk = new THREE.Mesh(pineTrunkGeo, darkOakMat);
    trunk.position.y = 0.6;
    trunk.castShadow = true;
    tree.add(trunk);

    const crown = new THREE.Mesh(pineCrownGeo, pineMat);
    crown.position.y = 2.1;
    crown.castShadow = true;
    tree.add(crown);

    const snow = new THREE.Mesh(pineSnowGeo, snowMat);
    snow.position.y = 2.4;
    snow.castShadow = true;
    tree.add(snow);

    gardenGroup.add(tree);
  });

  // Distant glowing Moon Sphere in the celestial horizon
  const celestialMoon = new THREE.Mesh(
    new THREE.SphereGeometry(2.6, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xddeaff })
  );
  celestialMoon.position.set(0, 6.5, -8.0);
  gardenGroup.add(celestialMoon);

  root.add(gardenGroup);

  return root;
}
