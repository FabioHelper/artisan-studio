import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * UNIVERSAL MESO-GRAMMAR FOUNDRY
 * Procedurally generates any architectural element, furniture, craft prop,
 * storage, lighting, and clutter item with authentic artisan craftsmanship (bevels, pegs, straps, rivets).
 * Enforces geometry compounding, buffer merging, and hardware instancing for maximum GPU performance.
 */
export class UniversalFoundry {
  constructor(materials) {
    this.materials = materials;
  }

  getMat(ref, fallback = 'wood.dark_oak') {
    return this.materials.get(ref || fallback);
  }

  createTransformedBox(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (rx || ry || rz) {
      const rotMatrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
      geo.applyMatrix4(rotMatrix);
    }
    geo.translate(x, y, z);
    return geo;
  }

  createTransformedCylinder(rt, rb, h, segs, x, y, z, rx = 0, ry = 0, rz = 0) {
    const geo = new THREE.CylinderGeometry(rt, rb, h, segs);
    if (rx || ry || rz) {
      const rotMatrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
      geo.applyMatrix4(rotMatrix);
    }
    geo.translate(x, y, z);
    return geo;
  }

  mergeGeometries(geos) {
    const valid = geos.filter(g => g && g.isBufferGeometry);
    if (valid.length === 0) return null;
    if (valid.length === 1) return valid[0];

    // Normalize: convert all to non-indexed and ensure position, normal, uv attributes exist
    const normalized = valid.map(g => {
      let geo = g.index ? g.toNonIndexed() : g.clone();
      if (!geo.attributes.normal) {
        geo.computeVertexNormals();
      }
      if (!geo.attributes.uv) {
        const count = geo.attributes.position.count;
        const uvs = new Float32Array(count * 2);
        geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      }
      return geo;
    });

    const merged = BufferGeometryUtils.mergeGeometries(normalized, false);
    return merged || valid[0];
  }

  // ==========================================
  // 1. ARCHITECTURE
  // ==========================================

  /** MTX preview geometry only. Godot compiles the semantic Hardline record independently. */
  buildHardlineBooth(group, lacquerMat, glassMat, signalMat) {
    const body = [];
    const glass = [];
    const signal = [];
    const box = (parts, w, h, d, x, y, z) => parts.push(this.createTransformedBox(w, h, d, x, y, z));

    // Ground contact and plinth: stepped foot, chamfered corners, and cable landing.
    box(body, 1.10, 0.09, 1.10, 0, 0.045, 0);
    box(body, 0.98, 0.10, 0.92, 0, 0.14, 0);
    box(body, 0.86, 0.07, 0.74, 0, 0.225, 0);

    // The main enclosure is bevelled, not a single unworked block.
    const outline = new THREE.Shape();
    outline.moveTo(-0.37, 0.27);
    outline.lineTo(0.37, 0.27);
    outline.lineTo(0.37, 2.38);
    outline.lineTo(-0.37, 2.38);
    outline.closePath();
    const core = new THREE.ExtrudeGeometry(outline, { depth: 0.55, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.055, bevelThickness: 0.045, curveSegments: 1 });
    core.translate(0, 0, -0.34);
    body.push(core);
    box(body, 0.82, 0.055, 0.66, 0, 2.43, -0.065);

    // Articulation: recessed handset well, side rails, bolted faceplate and cable.
    box(body, 0.48, 0.74, 0.045, 0, 1.44, 0.25);
    box(body, 0.40, 0.61, 0.03, 0, 1.44, 0.28);
    box(body, 0.10, 1.02, 0.05, -0.43, 1.62, 0.13);
    box(body, 0.10, 1.02, 0.05, 0.43, 1.62, 0.13);
    for (const x of [-0.34, 0.34]) for (const y of [0.43, 2.22]) {
      body.push(this.createTransformedCylinder(0.025, 0.025, 0.025, 8, x, y, 0.26, Math.PI / 2));
    }
    box(glass, 0.31, 0.18, 0.018, 0, 1.81, 0.31);
    box(glass, 0.13, 0.42, 0.085, -0.11, 1.38, 0.34);
    box(signal, 0.18, 0.025, 0.022, 0, 2.08, 0.30);

    // Asymmetric service tag and cable exit tell the player which face is interactive.
    box(body, 0.15, 0.23, 0.025, 0.30, 0.86, 0.30);
    box(body, 0.08, 0.22, 0.08, 0, 2.36, -0.38);
    body.push(this.createTransformedCylinder(0.035, 0.035, 0.34, 8, 0, 2.37, -0.51, Math.PI / 2));

    for (const [parts, material] of [[body, lacquerMat], [glass, glassMat], [signal, signalMat]]) {
      const geometry = this.mergeGeometries(parts);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = material === lacquerMat;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  buildHearth(group, stoneMat, plasterMat, fireMat) {
    const ironMat = this.materials.get('metal.forged_iron') || stoneMat;
    const woodMat = this.materials.get('wood.weathered_oak') || plasterMat;
    const emberMat = this.materials.get('ember') || fireMat;

    // 1. Hearth Base & Soot-Patinated Masonry Blocks
    const brickGeo = new THREE.BoxGeometry(0.32, 0.18, 0.28);
    for (let y = 0; y < 4; y++) {
      for (let x = -2; x <= 2; x++) {
        if (y >= 1 && y <= 2 && x >= -1 && x <= 1) continue; // Firebox void
        const brick = new THREE.Mesh(brickGeo, stoneMat);
        brick.position.set(x * 0.33, y * 0.19 + 0.1, 0);
        brick.rotation.y = Math.sin(x * 3 + y) * 0.04;
        brick.castShadow = true;
        brick.receiveShadow = true;
        group.add(brick);
      }
    }

    // Heavy Carved Stone Mantel Shelf on Corbels
    const mantel = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.12, 0.42), stoneMat);
    mantel.position.set(0, 0.88, 0.06);
    mantel.castShadow = true;
    group.add(mantel);

    for (const cx of [-0.68, 0.68]) {
      const corbel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.28), stoneMat);
      corbel.position.set(cx, 0.72, 0.02);
      group.add(corbel);
    }

    // Dark Firebox Interior Void
    const fireboxVoid = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 0.54, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 0.98 })
    );
    fireboxVoid.position.set(0, 0.38, -0.06);
    group.add(fireboxVoid);

    // 2. Pyramidal Chimney Hood & Flue
    const hoodGeo = new THREE.CylinderGeometry(0.45, 0.95, 1.2, 4);
    hoodGeo.rotateY(Math.PI / 4);
    const hood = new THREE.Mesh(hoodGeo, plasterMat);
    hood.position.set(0, 1.45, 0.05);
    hood.castShadow = true;
    group.add(hood);

    const flue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.4, 0.55), plasterMat);
    flue.position.set(0, 2.7, 0.05);
    flue.castShadow = true;
    group.add(flue);

    // 3. Forged Iron Andirons / Fire Dogs
    for (const ax of [-0.28, 0.28]) {
      // Upright forged post with curled finial
      const upright = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.28, 8), ironMat);
      upright.position.set(ax, 0.26, 0.06);
      group.add(upright);

      const finial = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), ironMat);
      finial.position.set(ax, 0.41, 0.06);
      group.add(finial);

      // Horizontal log cradle billet
      const billet = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.24), ironMat);
      billet.position.set(ax, 0.20, -0.04);
      group.add(billet);
    }

    // 4. Crossed Burning Hardwood Logs with Charred Ends
    const log1 = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.62, 7), woodMat);
    log1.rotation.set(0.12, 0.25, Math.PI / 2 + 0.15);
    log1.position.set(0, 0.24, -0.04);
    log1.castShadow = true;
    group.add(log1);

    const log2 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.58, 7), woodMat);
    log2.rotation.set(-0.15, -0.32, Math.PI / 2 - 0.2);
    log2.position.set(0.02, 0.31, -0.02);
    log2.castShadow = true;
    group.add(log2);

    // 5. Glowing Charcoal Embers & Multi-Layered Flame Tongues
    for (let e = 0; e < 6; e++) {
      const ea = (e / 6) * Math.PI * 2;
      const emberChunk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.04, 0), emberMat);
      emberChunk.position.set(Math.cos(ea) * 0.22, 0.18, Math.sin(ea) * 0.1 - 0.04);
      group.add(emberChunk);
    }

    // Swirling layered flames
    const flameSpire = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 8), fireMat);
    flameSpire.position.set(0, 0.48, -0.03);
    group.add(flameSpire);

    for (const fx of [-0.14, 0.14]) {
      const sideFlame = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.30, 6), fireMat);
      sideFlame.position.set(fx, 0.42, -0.02);
      sideFlame.rotation.z = fx * -0.6;
      group.add(sideFlame);
    }
  }

  buildFireplace(group, stoneMat, fireMat) {
    const ironMat = this.materials.get('metal.forged_iron') || stoneMat;
    const woodMat = this.materials.get('wood.weathered_oak') || stoneMat;
    const emberMat = this.materials.get('ember') || fireMat;

    // 1. Classical Carved Stone Fireplace Mantlepiece
    const jambL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.95, 0.38), stoneMat);
    jambL.position.set(-0.85, 0.475, 0);
    jambL.castShadow = true;
    group.add(jambL);

    const jambR = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.95, 0.38), stoneMat);
    jambR.position.set(0.85, 0.475, 0);
    jambR.castShadow = true;
    group.add(jambR);

    // Carved Lintel Beam
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.22, 0.42), stoneMat);
    lintel.position.set(0, 0.96, 0.02);
    lintel.castShadow = true;
    group.add(lintel);

    // Mantelshelf Top Slab
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.08, 0.48), stoneMat);
    shelf.position.set(0, 1.11, 0.05);
    shelf.castShadow = true;
    group.add(shelf);

    // Dark Cast-Iron Fireback Plate with Relief Arch
    const fireback = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.85, 0.04), ironMat);
    fireback.position.set(0, 0.48, -0.16);
    group.add(fireback);

    // 2. Heavy Forged Iron Andirons & Log Cradle
    for (const ax of [-0.35, 0.35]) {
      const andiron = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.26, 0.035), ironMat);
      andiron.position.set(ax, 0.20, 0.08);
      group.add(andiron);

      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), ironMat);
      ball.position.set(ax, 0.34, 0.08);
      group.add(ball);
    }

    // 3. Burning Split Logs & Core Embers
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.72, 7), woodMat);
    log.rotation.z = Math.PI / 2;
    log.position.set(0, 0.22, 0.02);
    log.castShadow = true;
    group.add(log);

    for (let e = -3; e <= 3; e++) {
      const ember = new THREE.Mesh(new THREE.DodecahedronGeometry(0.045, 0), emberMat);
      ember.position.set(e * 0.11, 0.14, (e % 2) * 0.04 + 0.02);
      group.add(ember);
    }

    // Roaring Warm Flame Cluster
    const mainFlame = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.42, 8), fireMat);
    mainFlame.position.set(0, 0.45, 0.02);
    group.add(mainFlame);

    for (const fx of [-0.22, 0.22]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.32, 6), fireMat);
      flame.position.set(fx, 0.38, 0.03);
      flame.rotation.z = fx * -0.5;
      group.add(flame);
    }
  }

  buildFloor(group, floorMat, w = 6.0, d = 4.8) {
    const plankW = 0.42;
    const count = Math.floor(w / plankW);
    const plankGeo = new THREE.BoxGeometry(plankW - 0.02, 0.06, d);
    const instanced = new THREE.InstancedMesh(plankGeo, floorMat, count);
    instanced.receiveShadow = true;
    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      dummy.position.set((i - count / 2 + 0.5) * plankW, -0.03, 0);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
    group.add(instanced);
  }

  buildWall(group, plasterMat, oakMat, w = 6.0, h = 2.9) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.15), plasterMat);
    wall.position.set(0, h / 2, 0);
    wall.receiveShadow = true;
    group.add(wall);

    // Vertical timber posts
    const postGeo = new THREE.BoxGeometry(0.18, h, 0.18);
    for (let x = -w / 2 + 0.2; x <= w / 2 - 0.2; x += 1.4) {
      const post = new THREE.Mesh(postGeo, oakMat);
      post.position.set(x, h / 2, 0.05);
      post.castShadow = true;
      group.add(post);
    }
  }

  // ==========================================
  // 2. FURNITURE
  // ==========================================

  buildTable(group, oakMat, dishesMat = null) {
    const ironMat = this.materials.get('metal.forged_iron') || oakMat;
    const ceramicMat = dishesMat || this.materials.get('ceramic.dish');
    const pewterMat = this.materials.get('metal.polished_iron') || ironMat;

    // 1. Heavy Joined Refectory Tabletop with Breadboard Ends
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(2.10, 0.08, 0.95), oakMat);
    tableTop.position.y = 0.76;
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    group.add(tableTop);

    // Breadboard end caps
    for (const bx of [-1.08, 1.08]) {
      const breadboard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.085, 0.96), oakMat);
      breadboard.position.set(bx, 0.76, 0);
      group.add(breadboard);
    }

    // 2. Under-Table Apron Rails & Corner Braces
    for (const az of [-0.38, 0.38]) {
      const railLong = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.09, 0.035), oakMat);
      railLong.position.set(0, 0.69, az);
      group.add(railLong);
    }
    for (const ax of [-0.92, 0.92]) {
      const railShort = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.09, 0.74), oakMat);
      railShort.position.set(ax, 0.69, 0);
      group.add(railShort);
    }

    // 3. Four Stout Chamfered Legs & Floor H-Stretcher
    const legGeo = new THREE.BoxGeometry(0.12, 0.68, 0.12);
    const legPositions = [[-0.88, -0.34], [0.88, -0.34], [-0.88, 0.34], [0.88, 0.34]];
    for (const [lx, lz] of legPositions) {
      const leg = new THREE.Mesh(legGeo, oakMat);
      leg.position.set(lx, 0.36, lz);
      leg.castShadow = true;
      group.add(leg);

      const footPad = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.14), oakMat);
      footPad.position.set(lx, 0.02, lz);
      group.add(footPad);
    }

    // Low H-Stretcher floor rails (prevents leg splay in authentic timber framing)
    for (const sx of [-0.88, 0.88]) {
      const sideStretcher = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.68), oakMat);
      sideStretcher.position.set(sx, 0.12, 0);
      group.add(sideStretcher);
    }
    const centerStretcher = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.06, 0.06), oakMat);
    centerStretcher.position.set(0, 0.12, 0);
    group.add(centerStretcher);

    // 4. Artisan Tableware (Turned wooden trencher, pewter tankards, stoneware pitcher)
    if (ceramicMat) {
      // Stoneware wine pitcher
      const pitcher = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.26, 12), ceramicMat);
      pitcher.position.set(0, 0.93, 0);
      pitcher.castShadow = true;
      group.add(pitcher);

      // Wooden bread trencher with sourdough loaf
      const trencher = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.025, 14), oakMat);
      trencher.position.set(-0.45, 0.81, 0.05);
      group.add(trencher);

      const loaf = new THREE.Mesh(new THREE.SphereGeometry(0.10, 8, 8), this.materials.get('cloth.woven_cushion') || ceramicMat);
      loaf.scale.set(1.2, 0.6, 0.9);
      loaf.position.set(-0.45, 0.86, 0.05);
      loaf.castShadow = true;
      group.add(loaf);

      // Turned pewter tankards
      for (const tx of [-0.55, 0.45, 0.65]) {
        const tankard = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.12, 10), pewterMat);
        tankard.position.set(tx, 0.86, tx > 0 ? -0.22 : 0.24);
        tankard.castShadow = true;
        group.add(tankard);
      }
    }
  }

  buildBookshelf(group, oakMat) {
    const navyMat = this.materials.get('leather.spellbook_navy') || oakMat;
    const crimsonMat = this.materials.get('leather.spellbook_crimson') || oakMat;
    const wornMat = this.materials.get('leather.worn') || oakMat;
    const pageMat = this.materials.get('book.grimoire_page') || oakMat;
    const ironMat = this.materials.get('metal.forged_iron') || oakMat;

    const frameH = 2.4;
    const frameW = 1.35;
    const frameD = 0.42;

    // 1. Heavy Carved Timber Frame & Crown Cornice
    const sideGeo = new THREE.BoxGeometry(0.08, frameH, frameD);
    const leftSide = new THREE.Mesh(sideGeo, oakMat);
    leftSide.position.set(-frameW / 2, frameH / 2, 0);
    leftSide.castShadow = true;
    group.add(leftSide);

    const rightSide = new THREE.Mesh(sideGeo, oakMat);
    rightSide.position.set(frameW / 2, frameH / 2, 0);
    rightSide.castShadow = true;
    group.add(rightSide);

    // Stepped plinth base
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(frameW + 0.08, 0.12, frameD + 0.04), oakMat);
    plinth.position.set(0, 0.06, 0.02);
    group.add(plinth);

    // Carved crown cornice pediment
    const crown = new THREE.Mesh(new THREE.BoxGeometry(frameW + 0.10, 0.10, frameD + 0.06), oakMat);
    crown.position.set(0, frameH - 0.05, 0.02);
    crown.castShadow = true;
    group.add(crown);

    const backPanel = new THREE.Mesh(new THREE.BoxGeometry(frameW, frameH, 0.03), oakMat);
    backPanel.position.set(0, frameH / 2, -frameD / 2 + 0.015);
    group.add(backPanel);

    // Wrought iron corner brackets
    for (const cy of [0.15, frameH - 0.15]) {
      for (const cx of [-frameW / 2, frameW / 2]) {
        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), ironMat);
        bracket.position.set(cx, cy, frameD / 2);
        group.add(bracket);
      }
    }

    // 2. Shelves with Rhythmic Artisan Clutter
    const shelfGeo = new THREE.BoxGeometry(frameW - 0.04, 0.05, frameD - 0.04);
    const materialsPool = [navyMat, crimsonMat, wornMat];

    for (let s = 0; s < 4; s++) {
      const sy = 0.22 + s * 0.52;
      const shelf = new THREE.Mesh(shelfGeo, oakMat);
      shelf.position.set(0, sy, 0);
      shelf.castShadow = true;
      group.add(shelf);

      // Book groupings with natural variations
      let currX = -frameW / 2 + 0.12;
      const bookCount = 7 + (s % 3);
      for (let b = 0; b < bookCount; b++) {
        const mat = materialsPool[(s + b) % materialsPool.length];
        const bh = 0.26 + (b % 4) * 0.04;
        const bw = 0.045 + (b % 3) * 0.015;
        const book = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.24), mat);

        // Natural leaning tilt on the end books
        const isLeaning = b === bookCount - 1 && s % 2 === 1;
        const tilt = isLeaning ? 0.22 : 0;
        book.rotation.z = tilt;
        book.position.set(currX + (isLeaning ? 0.05 : 0), sy + bh / 2 + 0.025, 0.02);
        book.castShadow = true;
        group.add(book);
        currX += bw + (isLeaning ? 0.08 : 0.015);
      }

      // Vellum scrolls on middle shelf
      if (s === 2) {
        for (let r = 0; r < 3; r++) {
          const scroll = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.22, 10), pageMat);
          scroll.rotation.x = Math.PI / 2;
          scroll.position.set(frameW / 2 - 0.18 + r * 0.05, sy + 0.035, 0.02);
          group.add(scroll);
        }
      }
    }
  }

  buildBench(group, oakMat, cushionMat = null) {
    // 1. Heavy Timber Slab Seat
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.07, 0.36), oakMat);
    top.position.y = 0.44;
    top.castShadow = true;
    group.add(top);

    // 2. Shaped Gothic Trestle Uprights with Arched Floor Cutout
    for (const tx of [-0.62, 0.62]) {
      const trestle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.40, 0.32), oakMat);
      trestle.position.set(tx, 0.20, 0);
      trestle.castShadow = true;
      group.add(trestle);

      // Splayed trestle foot pad
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.36), oakMat);
      foot.position.set(tx, 0.02, 0);
      group.add(foot);
    }

    // 3. Center Stretcher Beam with Protruding Keyed Tenons
    const stretcher = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.06, 0.05), oakMat);
    stretcher.position.set(0, 0.16, 0);
    group.add(stretcher);

    for (const kx of [-0.68, 0.68]) {
      const key = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.03), oakMat);
      key.position.set(kx, 0.16, 0);
      group.add(key);
    }

    // 4. Tufted Wool Cushion with Edge Piping
    if (cushionMat) {
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.07, 0.34), cushionMat);
      cushion.position.y = 0.50;
      cushion.castShadow = true;
      group.add(cushion);
    }
  }

  // ==========================================
  // 3. WORKSHOP & CRAFTING
  // ==========================================

  buildAnvil(group, ironMat, polishedMat, oakMat) {
    // 1. Massive Hewn Oak Log Stump Base
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.52, 16), oakMat);
    stump.position.y = 0.26;
    stump.castShadow = true;
    group.add(stump);

    // Forged iron compression hoop around log
    const hoop = new THREE.Mesh(new THREE.CylinderGeometry(0.445, 0.445, 0.05, 16), ironMat);
    hoop.position.y = 0.38;
    group.add(hoop);

    // Forged iron dog-staples securing anvil base to stump
    for (const sx of [-0.28, 0.28]) {
      const staple = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.02), ironMat);
      staple.position.set(sx, 0.54, 0.17);
      group.add(staple);
    }

    // 2. Anvil Feet, Arched Waist, and Body
    const anvilBase = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.36), ironMat);
    anvilBase.position.y = 0.58;
    anvilBase.castShadow = true;
    group.add(anvilBase);

    const anvilWaist = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.24), ironMat);
    anvilWaist.position.y = 0.72;
    anvilWaist.castShadow = true;
    group.add(anvilWaist);

    // 3. Polished Hardened Steel Face & Round Bickern Horn
    const anvilFace = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.14, 0.32), polishedMat);
    anvilFace.position.set(0.05, 0.88, 0);
    anvilFace.castShadow = true;
    group.add(anvilFace);

    // Square Hardy Hole
    const hardyHole = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.04), ironMat);
    hardyHole.position.set(-0.25, 0.951, 0);
    group.add(hardyHole);

    // Round Horn (Bickern)
    const hornGeo = new THREE.ConeGeometry(0.13, 0.42, 10);
    hornGeo.rotateZ(-Math.PI / 2);
    const horn = new THREE.Mesh(hornGeo, polishedMat);
    horn.position.set(0.66, 0.88, 0);
    horn.castShadow = true;
    group.add(horn);

    // Flat Stepped Heel
    const heel = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 0.28), ironMat);
    heel.position.set(-0.48, 0.85, 0);
    group.add(heel);

    // 4. Blacksmith's Cross-Peen Hammer Resting on Anvil Face
    const hammer = new THREE.Group();
    hammer.position.set(0.10, 0.97, -0.04);
    hammer.rotation.set(0, 0.45, 0);

    const hammerHead = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.15), ironMat);
    hammerHead.castShadow = true;
    hammer.add(hammerHead);

    const hammerHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.36, 8), oakMat);
    hammerHandle.rotation.x = Math.PI / 2;
    hammerHandle.position.set(0, 0, 0.18);
    hammerHandle.castShadow = true;
    hammer.add(hammerHandle);

    group.add(hammer);
  }

  buildBellows(group, oakMat, leatherMat, ironMat) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.45), oakMat);
    skid.position.set(0, 0.04, 0);
    skid.castShadow = true;
    group.add(skid);

    const postL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.1), oakMat);
    postL.position.set(-0.55, 0.34, 0);
    group.add(postL);

    const postR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.48, 0.1), oakMat);
    postR.position.set(0.42, 0.28, 0);
    group.add(postR);

    const plateTop = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.08, 0.38), oakMat);
    plateTop.position.set(-0.1, 0.58, 0);
    group.add(plateTop);

    const plateBottom = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.08, 0.38), oakMat);
    plateBottom.position.set(-0.1, 0.36, 0);
    group.add(plateBottom);

    const bladder = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.8, 10), leatherMat);
    bladder.rotateZ(Math.PI / 2);
    bladder.position.set(-0.1, 0.47, 0);
    group.add(bladder);

    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.09, 0.7, 10), ironMat);
    nozzle.rotateZ(-Math.PI / 2);
    nozzle.position.set(0.75, 0.47, 0);
    group.add(nozzle);

    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.08), oakMat);
    lever.position.set(-0.5, 0.85, 0);
    lever.rotation.z = 0.25;
    group.add(lever);
  }

  buildWeaponRack(group, oakMat, ironMat) {
    const steelMat = this.materials.get('metal.polished_iron') || ironMat;
    const leatherMat = this.materials.get('leather.worn') || oakMat;
    const bannerMat = this.materials.get('cloth.woven_cushion') || ironMat;

    // 1. Heavy Timber A-Frame Weapon Rack
    for (const rx of [-0.62, 0.62]) {
      // Main upright timber
      const upright = new THREE.Mesh(new THREE.BoxGeometry(0.10, 1.45, 0.10), oakMat);
      upright.position.set(rx, 0.72, 0);
      upright.castShadow = true;
      group.add(upright);

      // Splayed A-frame foot
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.62), oakMat);
      foot.position.set(rx, 0.04, 0);
      foot.castShadow = true;
      group.add(foot);

      // Diagonal timber knee brace
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), oakMat);
      brace.position.set(rx, 0.28, 0.14);
      brace.rotation.x = 0.65;
      group.add(brace);
    }

    // Horizontal notched weapon support rails
    for (const ry of [0.42, 1.12]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.08, 0.08), oakMat);
      rail.position.set(0, ry, 0);
      group.add(rail);
    }

    // 2. Artisan Medieval Double-Edged Broadswords
    for (let i = 0; i < 2; i++) {
      const swX = -0.32 + i * 0.48;
      const sword = new THREE.Group();
      sword.position.set(swX, 0.78, 0.07);

      // Double-edged steel blade with central fuller groove
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.88, 0.016), steelMat);
      blade.castShadow = true;
      sword.add(blade);

      const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.72, 0.018), ironMat);
      sword.add(fuller);

      // Tapered blade tip
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.12, 4), steelMat);
      tip.rotation.y = Math.PI / 4;
      tip.position.y = -0.48;
      sword.add(tip);

      // Curved forged iron crossguard quillons
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.032, 0.036), ironMat);
      guard.position.y = 0.45;
      sword.add(guard);

      // Wire-wrapped leather hilt grip
      const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.18, 8), leatherMat);
      hilt.position.y = 0.56;
      sword.add(hilt);

      // Spherical octagonal iron pommel
      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), ironMat);
      pommel.position.y = 0.67;
      sword.add(pommel);

      group.add(sword);
    }

    // 3. Forged Heater Knight Shield Hung on Rack
    const shieldGroup = new THREE.Group();
    shieldGroup.position.set(0.48, 0.75, 0.12);
    shieldGroup.rotation.y = 0.25;

    // Curved shield body
    const shieldBody = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.54, 0.025), bannerMat);
    shieldBody.castShadow = true;
    shieldGroup.add(shieldBody);

    // Iron boss in center
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), ironMat);
    boss.position.z = 0.02;
    shieldGroup.add(boss);

    // Forged rim trim
    const rim = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.56, 0.015), ironMat);
    shieldGroup.add(rim);

    group.add(shieldGroup);
  }

  buildCauldron(group, ironMat, emberMat) {
    const coalsMat = emberMat || this.materials.get('ember');
    const brewMat = this.materials.get('crystal.soul_gem_cyan') || emberMat;

    // 1. Heavy Cast-Iron Pot with Flanged Rim Lip
    const pot = new THREE.Mesh(new THREE.SphereGeometry(0.44, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.74), ironMat);
    pot.position.y = 0.44;
    pot.castShadow = true;
    group.add(pot);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.028, 8, 24), ironMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.65;
    group.add(rim);

    // Twin forged lifting eyelets/ears on the rim
    for (const ex of [-0.44, 0.44]) {
      const ear = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.012, 6, 12), ironMat);
      ear.position.set(ex, 0.65, 0);
      ear.rotation.y = Math.PI / 2;
      group.add(ear);
    }

    // Arched wrought-iron bail suspension handle
    const bail = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.016, 6, 24, Math.PI * 0.85), ironMat);
    bail.position.set(0, 0.74, 0);
    bail.rotation.z = -0.35;
    group.add(bail);

    // 2. Viscous Bubbling Brew Surface with Froth
    const brew = new THREE.Mesh(new THREE.CircleGeometry(0.39, 16), brewMat);
    brew.rotation.x = -Math.PI / 2;
    brew.position.y = 0.60;
    group.add(brew);

    // Bubbles on surface
    for (let b = 0; b < 4; b++) {
      const ba = b * 1.6;
      const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.025 + (b % 2) * 0.015, 8, 8), brewMat);
      bubble.position.set(Math.cos(ba) * 0.18, 0.61, Math.sin(ba) * 0.18);
      group.add(bubble);
    }

    // 3. Forged Tripod Stand with Splayed Feet
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.54, 8), ironMat);
      leg.position.set(Math.cos(a) * 0.36, 0.26, Math.sin(a) * 0.36);
      leg.rotation.z = Math.cos(a) * 0.22;
      leg.rotation.x = -Math.sin(a) * 0.22;
      leg.castShadow = true;
      group.add(leg);
    }

    // 4. Glowing Charcoal Ember Nest Beneath Cauldron
    const coalNest = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.24, 0.06, 12), coalsMat);
    coalNest.position.y = 0.03;
    group.add(coalNest);

    for (let c = 0; c < 5; c++) {
      const ca = (c / 5) * Math.PI * 2;
      const ember = new THREE.Mesh(new THREE.DodecahedronGeometry(0.04, 0), coalsMat);
      ember.position.set(Math.cos(ca) * 0.15, 0.06, Math.sin(ca) * 0.15);
      group.add(ember);
    }
  }

  buildChest(group, oakMat, ironMat) {
    // 1. Heavy Oak Chest Body & Runner Skids
    const bodyW = 0.98;
    const bodyH = 0.44;
    const bodyD = 0.58;

    const body = new THREE.Mesh(new THREE.BoxGeometry(bodyW, bodyH, bodyD), oakMat);
    body.position.y = bodyH / 2 + 0.04;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Runner skids on floor
    for (const sz of [-0.22, 0.22]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(bodyW + 0.04, 0.04, 0.08), oakMat);
      skid.position.set(0, 0.02, sz);
      group.add(skid);
    }

    // 2. Arched Domed Vaulted Lid
    const lidR = bodyD / 2;
    const lidGeo = new THREE.CylinderGeometry(lidR, lidR, bodyW, 16, 1, false, 0, Math.PI);
    lidGeo.rotateZ(Math.PI / 2);
    lidGeo.rotateY(Math.PI / 2);
    const lid = new THREE.Mesh(lidGeo, oakMat);
    lid.position.set(0, bodyH + 0.04, 0);
    lid.castShadow = true;
    group.add(lid);

    // 3. Wrought-Iron Reinforcing Bands & Stud Rivets
    const strapPositions = [-0.34, 0, 0.34];
    for (const sx of strapPositions) {
      // Body band
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, bodyH + 0.01, bodyD + 0.02), ironMat);
      strap.position.set(sx, bodyH / 2 + 0.04, 0);
      group.add(strap);

      // Curved lid band
      const lidBand = new THREE.Mesh(new THREE.TorusGeometry(lidR + 0.008, 0.012, 6, 16, Math.PI), ironMat);
      lidBand.position.set(sx, bodyH + 0.04, 0);
      lidBand.rotation.y = Math.PI / 2;
      group.add(lidBand);

      // Stud rivets
      for (const ry of [0.12, 0.28, 0.40]) {
        const rivetF = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 6), ironMat);
        rivetF.position.set(sx, ry, bodyD / 2 + 0.015);
        group.add(rivetF);
      }
    }

    // 4. Heavy Hasp, Padlock, and Side Carrying Handles
    const hasp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.035), ironMat);
    hasp.position.set(0, bodyH + 0.02, bodyD / 2 + 0.02);
    group.add(hasp);

    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.03), ironMat);
    lock.position.set(0, bodyH - 0.06, bodyD / 2 + 0.03);
    group.add(lock);

    // Side drop-ring iron handles
    for (const hx of [-bodyW / 2 - 0.01, bodyW / 2 + 0.01]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.09, 0.09), ironMat);
      plate.position.set(hx, bodyH * 0.65, 0);
      group.add(plate);

      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 12), ironMat);
      ring.position.set(hx + (hx > 0 ? 0.015 : -0.015), bodyH * 0.65, 0);
      ring.rotation.y = Math.PI / 2;
      group.add(ring);
    }
  }

  buildBarrel(group, woodMat, ironMat) {
    // 1. Authentic Curved Double-Tapered Bilge Bulge
    // 3 stepped cylinder tiers forming authentic stave curvature
    const midSection = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.36, 16), woodMat);
    midSection.position.y = 0.44;
    midSection.castShadow = true;
    group.add(midSection);

    const topSection = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.44, 0.26, 16), woodMat);
    topSection.position.y = 0.74;
    topSection.castShadow = true;
    group.add(topSection);

    const btmSection = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.38, 0.26, 16), woodMat);
    btmSection.position.y = 0.14;
    btmSection.castShadow = true;
    group.add(btmSection);

    // Recessed top chime rim & wooden bung plug
    const topChime = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.016, 6, 16), woodMat);
    topChime.rotation.x = Math.PI / 2;
    topChime.position.y = 0.87;
    group.add(topChime);

    const bung = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.03, 8), ironMat);
    bung.position.set(0.12, 0.86, 0.08);
    group.add(bung);

    // 2. Four Forged Iron Hoops with Relief
    const hoopConfigs = [
      { y: 0.80, r: 0.395, w: 0.035 }, // Top chime hoop
      { y: 0.56, r: 0.446, w: 0.040 }, // Upper bilge hoop
      { y: 0.32, r: 0.446, w: 0.040 }, // Lower bilge hoop
      { y: 0.08, r: 0.395, w: 0.035 }  // Bottom chime hoop
    ];
    for (const h of hoopConfigs) {
      const hoop = new THREE.Mesh(new THREE.CylinderGeometry(h.r, h.r, h.w, 16), ironMat);
      hoop.position.y = h.y;
      group.add(hoop);
    }
  }

  buildCrate(group, woodMat, ironMat) {
    const s = 0.68;

    // 1. Heavy Timber Corner Stiles & Frame Rails
    const stiles = [
      [-s / 2, -s / 2], [s / 2, -s / 2], [-s / 2, s / 2], [s / 2, s / 2]
    ];
    const postGeo = new THREE.BoxGeometry(0.065, s, 0.065);
    for (const [px, pz] of stiles) {
      const post = new THREE.Mesh(postGeo, woodMat);
      post.position.set(px, s / 2, pz);
      post.castShadow = true;
      group.add(post);
    }

    // Top & bottom perimeter rails
    for (const ry of [0.035, s - 0.035]) {
      for (const rz of [-s / 2, s / 2]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(s, 0.07, 0.04), woodMat);
        rail.position.set(0, ry, rz);
        group.add(rail);
      }
      for (const rx of [-s / 2, s / 2]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, s), woodMat);
        rail.position.set(rx, ry, 0);
        group.add(rail);
      }
    }

    // 2. Inset Horizontal Timber Planks
    const innerBox = new THREE.Mesh(new THREE.BoxGeometry(s - 0.08, s - 0.08, s - 0.08), woodMat);
    innerBox.position.y = s / 2;
    innerBox.castShadow = true;
    innerBox.receiveShadow = true;
    group.add(innerBox);

    // 3. Diagonal Structural X-Bracing on Faces
    const braceLen = Math.sqrt(2 * (s - 0.12) * (s - 0.12));
    for (const faceZ of [-s / 2 - 0.005, s / 2 + 0.005]) {
      const brace1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, braceLen, 0.015), woodMat);
      brace1.position.set(0, s / 2, faceZ);
      brace1.rotation.z = Math.PI / 4;
      group.add(brace1);

      const brace2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, braceLen, 0.015), woodMat);
      brace2.position.set(0, s / 2, faceZ);
      brace2.rotation.z = -Math.PI / 4;
      group.add(brace2);
    }

    // 4. Forged Iron Corner Angle Brackets
    for (const [cx, cz] of stiles) {
      for (const cy of [0.05, s - 0.05]) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.075), ironMat);
        cap.position.set(cx, cy, cz);
        group.add(cap);
      }
    }
  }

  buildLantern(group, ironMat, emberMat) {
    const fireMat = emberMat || this.materials.get('ember');
    const glassMat = this.materials.get('ice.glacial') || ironMat;
    const brassMat = this.materials.get('metal.brass_gold') || ironMat;

    // 1. Stepped Wrought-Iron Plinth Base
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 0.24), ironMat);
    base.position.y = 0.02;
    base.castShadow = true;
    group.add(base);

    // 4 Slender Corner Posts
    const postGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.32, 6);
    const postPos = [[-0.09, -0.09], [0.09, -0.09], [-0.09, 0.09], [0.09, 0.09]];
    for (const [px, pz] of postPos) {
      const post = new THREE.Mesh(postGeo, ironMat);
      post.position.set(px, 0.20, pz);
      post.castShadow = true;
      group.add(post);
    }

    // 2. Translucent Glass Enclosure Panes
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.30, 0.17), glassMat);
    glass.position.y = 0.20;
    group.add(glass);

    // 3. Pyramidal Vented Chimney Canopy & Suspension Ring
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.12, 4), ironMat);
    canopy.rotation.y = Math.PI / 4;
    canopy.position.y = 0.40;
    canopy.castShadow = true;
    group.add(canopy);

    const smokeCap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.03, 8), ironMat);
    smokeCap.position.y = 0.47;
    group.add(smokeCap);

    // Forged iron ring hanger
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 16), ironMat);
    ring.position.y = 0.52;
    group.add(ring);

    // 4. Interior Brass Candle Socket, Beeswax Candle, & Flame
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.02, 10), brassMat);
    socket.position.y = 0.05;
    group.add(socket);

    const candle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.10, 10),
      this.materials.get('wax.candle') || ironMat
    );
    candle.position.y = 0.11;
    group.add(candle);

    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.035, 8), fireMat);
    flame.position.y = 0.18;
    group.add(flame);
  }

  // ==========================================
  // MODERN JAPANESE & NINTENDO WORKSPACE
  // ==========================================

  buildTokyoDesk(group, woodMat, metalMat) {
    const deskGroup = new THREE.Group();

    // 1. Heavy Solid Birch Butcher-Block Top (with chamfered edge) — Merged
    const topW = 1.68, topH = 0.045, topD = 0.82;
    const topGeo = this.createTransformedBox(topW, topH, topD, 0, 0.73, 0);
    const chamferGeo = this.createTransformedBox(topW, 0.015, 0.015, 0, 0.745, topD / 2 - 0.007);
    const mergedTopGeo = this.mergeGeometries([topGeo, chamferGeo]);
    const topMesh = new THREE.Mesh(mergedTopGeo, woodMat);
    topMesh.castShadow = true;
    topMesh.receiveShadow = true;
    deskGroup.add(topMesh);

    // 2. Dual-Stage Motorized Steel Frame, Columns, Feet, Glides & Foam Pads — Merged into 1 draw call
    const steelGeos = [];
    // Legs
    steelGeos.push(this.createTransformedBox(0.08, 0.68, 0.05, -0.64, 0.35, 0));
    steelGeos.push(this.createTransformedBox(0.08, 0.68, 0.05, 0.64, 0.35, 0));
    // Telescoping sleeves
    steelGeos.push(this.createTransformedBox(0.065, 0.28, 0.045, -0.64, 0.48, 0));
    steelGeos.push(this.createTransformedBox(0.065, 0.28, 0.045, 0.64, 0.48, 0));
    // Foot skids
    steelGeos.push(this.createTransformedBox(0.09, 0.028, 0.68, -0.64, 0.014, 0));
    steelGeos.push(this.createTransformedBox(0.09, 0.028, 0.68, 0.64, 0.014, 0));
    // Leveling glides
    [[-0.64, -0.28], [-0.64, 0.28], [0.64, -0.28], [0.64, 0.28]].forEach(([gx, gz]) => {
      steelGeos.push(this.createTransformedCylinder(0.022, 0.022, 0.008, 12, gx, 0.004, gz));
    });
    // Crossbeam, cable tray, grommet
    steelGeos.push(this.createTransformedBox(1.28, 0.045, 0.04, 0, 0.68, -0.15));
    steelGeos.push(this.createTransformedBox(0.85, 0.06, 0.12, 0, 0.66, -0.28));
    steelGeos.push(this.createTransformedCylinder(0.032, 0.032, 0.046, 16, 0.55, 0.73, -0.28));

    // Acoustic foam monitor isolation wedges
    steelGeos.push(this.createTransformedBox(0.16, 0.025, 0.20, -0.68, 0.764, -0.16, 0, 0.28, 0));
    steelGeos.push(this.createTransformedBox(0.16, 0.025, 0.20, 0.68, 0.764, -0.16, 0, -0.28, 0));

    const mergedSteelGeo = this.mergeGeometries(steelGeos);
    const steelMesh = new THREE.Mesh(mergedSteelGeo, metalMat);
    steelMesh.castShadow = true;
    steelMesh.receiveShadow = true;
    deskGroup.add(steelMesh);

    // 3. Extended Premium Felt/Leather Deskmat
    const deskmatMat = this.getMat('fabric.tatami_border');
    const deskmat = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.004, 0.44), deskmatMat);
    deskmat.position.set(0, 0.754, 0.06);
    deskmat.receiveShadow = true;
    deskGroup.add(deskmat);

    // 4. Pair of Yamaha HS5 Studio Monitors — Batched by Material Component
    const speakerMat = metalMat;
    const wooferMat = this.getMat('ceramic.white');
    const tweeterMat = metalMat;

    const cabinetGeos = [
      this.createTransformedBox(0.15, 0.24, 0.18, -0.68, 0.897, -0.16, 0, 0.28, 0),
      this.createTransformedBox(0.15, 0.24, 0.18, 0.68, 0.897, -0.16, 0, -0.28, 0)
    ];
    const cabinetMesh = new THREE.Mesh(this.mergeGeometries(cabinetGeos), speakerMat);
    cabinetMesh.castShadow = true;
    deskGroup.add(cabinetMesh);

    // Woofers (White cones)
    const wooferGeos = [
      this.createTransformedCylinder(0.042, 0.025, 0.01, 16, -0.68 + Math.sin(0.28)*0.091, 0.862, -0.16 + Math.cos(0.28)*0.091, Math.PI / 2, 0, -0.28),
      this.createTransformedCylinder(0.042, 0.025, 0.01, 16, 0.68 + Math.sin(-0.28)*0.091, 0.862, -0.16 + Math.cos(-0.28)*0.091, Math.PI / 2, 0, 0.28)
    ];
    deskGroup.add(new THREE.Mesh(this.mergeGeometries(wooferGeos), wooferMat));

    // Tweeters
    const tweetGeo1 = new THREE.SphereGeometry(0.016, 10, 8);
    tweetGeo1.translate(-0.68 + Math.sin(0.28)*0.09, 0.952, -0.16 + Math.cos(0.28)*0.09);
    const tweetGeo2 = new THREE.SphereGeometry(0.016, 10, 8);
    tweetGeo2.translate(0.68 + Math.sin(-0.28)*0.09, 0.952, -0.16 + Math.cos(-0.28)*0.09);
    deskGroup.add(new THREE.Mesh(this.mergeGeometries([tweetGeo1, tweetGeo2]), tweeterMat));

    group.add(deskGroup);
  }

  buildNintendoRig(group, screenMat, marioScreenMat, blackMat, redJoyconMat, blueJoyconMat, whiteMat) {
    const rigGroup = new THREE.Group();
    const alumMat = this.getMat('metal.aluminum_brushed');
    const cableMat = blackMat;
    const cradleMat = this.getMat('wood.dark_oak');

    // ==========================================
    // 1. COMPOUND BLACK METAL & PLASTIC GEOMETRIES (1 Draw Call)
    // ==========================================
    const blackGeos = [];

    // Dual Articulated Monitor Gas-Spring Arm Mount
    blackGeos.push(this.createTransformedBox(0.10, 0.08, 0.08, 0, 0.75, -0.32));
    blackGeos.push(this.createTransformedCylinder(0.022, 0.022, 0.35, 16, 0, 0.92, -0.32));
    blackGeos.push(this.createTransformedCylinder(0.014, 0.014, 0.28, 12, -0.14, 1.05, -0.26, 0, 0, Math.PI / 3));
    blackGeos.push(this.createTransformedCylinder(0.014, 0.014, 0.28, 12, 0.16, 1.05, -0.26, 0, 0, -Math.PI / 3));

    // Monitor Bezels & Mounts
    blackGeos.push(this.createTransformedBox(0.72, 0.42, 0.02, -0.16, 1.07, -0.18, 0, 0.07, 0));
    blackGeos.push(this.createTransformedBox(0.05, 0.04, 0.04, -0.16, 1.29, -0.18, 0, 0.07, 0));
    blackGeos.push(this.createTransformedBox(0.30, 0.48, 0.02, 0.38, 1.08, -0.16, 0, -0.26, 0));

    // Gaming Mouse
    blackGeos.push(this.createTransformedBox(0.062, 0.026, 0.11, 0.24, 0.768, 0.09));

    // Nintendo Switch Body in Dock
    const dockRot = -0.22;
    blackGeos.push(this.createTransformedBox(0.165, 0.095, 0.014, 0.56, 0.836, -0.04, 0, dockRot, 0));

    // Pro Controller Body & Sticks
    const proRot = -0.35;
    blackGeos.push(this.createTransformedBox(0.14, 0.085, 0.045, 0.55, 0.819, 0.16, 0.35, proRot, 0));
    blackGeos.push(this.createTransformedCylinder(0.012, 0.008, 0.016, 10, 0.55 - 0.035, 0.834, 0.16 + 0.018, 0.35, proRot, 0));
    blackGeos.push(this.createTransformedCylinder(0.012, 0.008, 0.016, 10, 0.55 + 0.025, 0.814, 0.16 + 0.022, 0.35, proRot, 0));

    // Headphone Stand & Headset
    blackGeos.push(this.createTransformedCylinder(0.06, 0.065, 0.014, 16, -0.64, 0.761, -0.15));
    blackGeos.push(this.createTransformedCylinder(0.008, 0.008, 0.26, 12, -0.64, 0.884, -0.15));
    blackGeos.push(this.createTransformedCylinder(0.02, 0.02, 0.08, 12, -0.64, 1.014, -0.15, Math.PI / 2, 0, 0));

    const hpBand = new THREE.TorusGeometry(0.075, 0.012, 8, 16, Math.PI);
    hpBand.translate(-0.64, 1.004, -0.15);
    blackGeos.push(hpBand);

    blackGeos.push(this.createTransformedCylinder(0.032, 0.032, 0.028, 14, -0.715, 0.924, -0.15, 0, 0, Math.PI / 2));
    blackGeos.push(this.createTransformedCylinder(0.032, 0.032, 0.028, 14, -0.565, 0.924, -0.15, 0, 0, Math.PI / 2));

    // Desk Lamp
    blackGeos.push(this.createTransformedBox(0.05, 0.06, 0.05, -0.68, 0.784, -0.28));
    blackGeos.push(this.createTransformedCylinder(0.006, 0.006, 0.28, 8, -0.62, 0.894, -0.24, 0, 0, -0.42));
    blackGeos.push(this.createTransformedCylinder(0.006, 0.006, 0.26, 8, -0.50, 1.074, -0.20, 0, 0, 0.52));

    const shadeGeo = new THREE.ConeGeometry(0.06, 0.10, 16, 1, true);
    const shadeM = new THREE.Matrix4().makeRotationZ(-0.85);
    shadeGeo.applyMatrix4(shadeM);
    shadeGeo.translate(-0.42, 1.154, -0.18);
    blackGeos.push(shadeGeo);

    const blackMesh = new THREE.Mesh(this.mergeGeometries(blackGeos), blackMat);
    blackMesh.castShadow = true;
    blackMesh.receiveShadow = true;
    rigGroup.add(blackMesh);

    // ==========================================
    // 2. COMPOUND ALUMINUM GEOMETRIES (1 Draw Call)
    // ==========================================
    const alumGeos = [
      this.createTransformedCylinder(0.009, 0.009, 0.44, 12, -0.16, 1.31, -0.145, 0, 0.07, Math.PI / 2),
      this.createTransformedBox(0.32, 0.018, 0.12, -0.06, 0.765, 0.09)
    ];
    const alumMesh = new THREE.Mesh(this.mergeGeometries(alumGeos), alumMat);
    alumMesh.castShadow = true;
    rigGroup.add(alumMesh);

    // ==========================================
    // 3. COMPOUND CERAMIC / WHITE GLOSS GEOMETRIES (1 Draw Call)
    // ==========================================
    const whiteGeos = [];
    // Keycaps
    whiteGeos.push(this.createTransformedBox(0.30, 0.012, 0.10, -0.06, 0.778, 0.09));
    // OLED Dock
    whiteGeos.push(this.createTransformedBox(0.18, 0.105, 0.052, 0.56, 0.807, -0.04, 0, dockRot, 0));
    // Coffee Mug body + handle
    whiteGeos.push(this.createTransformedCylinder(0.038, 0.035, 0.09, 16, -0.48, 0.798, 0.06));
    const handleGeo = new THREE.TorusGeometry(0.024, 0.006, 8, 14);
    const handleM = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    handleGeo.applyMatrix4(handleM);
    handleGeo.translate(-0.525, 0.798, 0.06);
    whiteGeos.push(handleGeo);

    const whiteMesh = new THREE.Mesh(this.mergeGeometries(whiteGeos), whiteMat);
    whiteMesh.castShadow = true;
    rigGroup.add(whiteMesh);

    // ==========================================
    // 4. DISPLAYS & SCREENS (2 Draw Calls)
    // ==========================================
    const primDisplay = new THREE.Mesh(new THREE.PlaneGeometry(0.69, 0.39), screenMat);
    primDisplay.position.set(-0.16, 1.07, -0.169);
    primDisplay.rotation.y = 0.07;
    rigGroup.add(primDisplay);

    const secDisplay = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.45), marioScreenMat);
    secDisplay.position.set(0.38, 1.08, -0.149);
    secDisplay.rotation.y = -0.26;
    rigGroup.add(secDisplay);

    // ==========================================
    // 5. ACCENT ACCESSORIES (Joy-Cons, Stand, Liquid, Cable)
    // ==========================================
    // Blue Joy-Con
    const blueGeo = this.createTransformedBox(0.032, 0.095, 0.015, 0.56 - Math.cos(dockRot) * 0.098, 0.836, -0.04 - Math.sin(dockRot) * 0.098, 0, dockRot, 0);
    rigGroup.add(new THREE.Mesh(blueGeo, blueJoyconMat));

    // Red Joy-Con + ESC key merged
    const redGeos = [
      this.createTransformedBox(0.032, 0.095, 0.015, 0.56 + Math.cos(dockRot) * 0.098, 0.836, -0.04 + Math.sin(dockRot) * 0.098, 0, dockRot, 0),
      this.createTransformedBox(0.018, 0.014, 0.018, -0.198, 0.782, 0.052)
    ];
    rigGroup.add(new THREE.Mesh(this.mergeGeometries(redGeos), redJoyconMat));

    // Enter key (Golden brass)
    const enterGeo = this.createTransformedBox(0.036, 0.014, 0.018, 0.068, 0.782, 0.095);
    rigGroup.add(new THREE.Mesh(enterGeo, this.getMat('metal.brass_gold')));

    // Coiled cable
    const cableGeo = this.createTransformedCylinder(0.012, 0.012, 0.18, 8, -0.08, 0.766, 0, 0, 0, Math.PI / 2);
    rigGroup.add(new THREE.Mesh(cableGeo, cableMat));

    // Wooden Controller Stand
    const standGeos = [
      this.createTransformedBox(0.12, 0.018, 0.08, 0.55, 0.763, 0.16, 0, proRot, 0),
      this.createTransformedBox(0.06, 0.07, 0.02, 0.55, 0.799, 0.14, -0.25, proRot, 0)
    ];
    rigGroup.add(new THREE.Mesh(this.mergeGeometries(standGeos), cradleMat));

    // Coffee Liquid (Dark glazed ceramic)
    const coffeeGeo = new THREE.CircleGeometry(0.034, 14);
    coffeeGeo.rotateX(-Math.PI / 2);
    coffeeGeo.translate(-0.48, 0.835, 0.06);
    rigGroup.add(new THREE.Mesh(coffeeGeo, this.getMat('ceramic.dish')));

    // Dock LED
    const dockLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.004, 6, 6),
      this.getMat('ember')
    );
    dockLed.position.set(0.56 - 0.07, 0.774, -0.013);
    rigGroup.add(dockLed);

    group.add(rigGroup);
  }

  buildTokyoApartmentShell(group, wallMat, woodMat, tatamiMat, borderMat, glassMat, frameMat, skylineMat, acMat) {
    const shellGroup = new THREE.Group();
    shellGroup.position.set(0, 0, 0);

    // ==========================================
    // 1. ARCHITECTURAL DIORAMA PLINTH (STUDIO BASE)
    // ==========================================
    const plinthW = 4.4;
    const plinthD = 4.4;
    const plinthH = 0.16;

    // Dark slate beveled base
    const baseMat = this.getMat('stone.rough_local');
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(plinthW, plinthH, plinthD), baseMat);
    plinth.position.set(0, -plinthH / 2, 0);
    plinth.receiveShadow = true;
    shellGroup.add(plinth);

    // Polished dark walnut perimeter walkway
    const woodBorder = new THREE.Mesh(new THREE.BoxGeometry(plinthW - 0.04, 0.012, plinthD - 0.04), woodMat);
    woodBorder.position.set(0, 0.006, 0);
    woodBorder.receiveShadow = true;
    shellGroup.add(woodBorder);

    // ==========================================
    // 2. RECESSED 6-MAT TATAMI INLAY (HARDWARE INSTANCED)
    // ==========================================
    const matW = 0.92;
    const matL = 1.84;
    const thickness = 0.022;

    const mats = [
      { x: -0.92, z: -0.46, rot: 0 },
      { x: -0.92, z: 1.38, rot: 0 },
      { x: 0.92, z: -1.38, rot: 0 },
      { x: 0.92, z: 0.46, rot: 0 },
      { x: 0.0, z: -1.38, rot: Math.PI / 2 },
      { x: 0.0, z: 1.38, rot: Math.PI / 2 }
    ];

    const matGeo = new THREE.BoxGeometry(matW - 0.015, thickness, matL - 0.015);
    const instMats = new THREE.InstancedMesh(matGeo, tatamiMat, mats.length);
    instMats.receiveShadow = true;

    const borderGeo = new THREE.BoxGeometry(0.04, thickness + 0.002, matL);
    const instBorders = new THREE.InstancedMesh(borderGeo, borderMat, mats.length * 2);

    const dummy = new THREE.Object3D();
    mats.forEach((m, idx) => {
      dummy.position.set(m.x, thickness / 2 + 0.012, m.z);
      dummy.rotation.set(0, m.rot, 0);
      dummy.updateMatrix();
      instMats.setMatrixAt(idx, dummy.matrix);

      // Dark cloth borders (heri)
      dummy.position.set(m.x + Math.cos(m.rot) * (matW / 2 - 0.02), thickness / 2 + 0.012, m.z + Math.sin(m.rot) * (matW / 2 - 0.02));
      dummy.updateMatrix();
      instBorders.setMatrixAt(idx * 2, dummy.matrix);

      dummy.position.set(m.x - Math.cos(m.rot) * (matW / 2 - 0.02), thickness / 2 + 0.012, m.z - Math.sin(m.rot) * (matW / 2 - 0.02));
      dummy.updateMatrix();
      instBorders.setMatrixAt(idx * 2 + 1, dummy.matrix);
    });
    instMats.instanceMatrix.needsUpdate = true;
    instBorders.instanceMatrix.needsUpdate = true;
    shellGroup.add(instMats);
    shellGroup.add(instBorders);

    // ==========================================
    // 3. ARCHITECTURAL WALLS, TIMBER BEAMS & ENTRYWAY (MERGED)
    // ==========================================
    const wallH = 2.65;
    const wallThick = 0.12;
    const rightWallW = 1.6;
    const windowW = plinthW - rightWallW - wallThick;
    const headerH = 0.35;

    // Plaster Walls — Merged into 1 draw call
    const wallGeos = [
      this.createTransformedBox(wallThick, wallH, plinthD, -plinthW / 2 + wallThick / 2, wallH / 2, 0),
      this.createTransformedBox(rightWallW, wallH, wallThick, plinthW / 2 - rightWallW / 2, wallH / 2, -plinthD / 2 + wallThick / 2),
      this.createTransformedBox(windowW, headerH, wallThick, -plinthW / 2 + wallThick + windowW / 2, wallH - headerH / 2, -plinthD / 2 + wallThick / 2)
    ];
    const wallsMesh = new THREE.Mesh(this.mergeGeometries(wallGeos), wallMat);
    wallsMesh.receiveShadow = true;
    shellGroup.add(wallsMesh);

    // Architectural Woodwork: Baseboards, Rafters, Shoji Kumiko Lattice & Lantern Frame — Merged into 1 draw call
    const timberGeos = [];
    timberGeos.push(this.createTransformedBox(0.02, 0.10, plinthD, -plinthW / 2 + wallThick + 0.01, 0.05, 0));
    timberGeos.push(this.createTransformedBox(0.02, 0.04, plinthD, -plinthW / 2 + wallThick + 0.01, 2.15, 0));
    timberGeos.push(this.createTransformedBox(rightWallW, 0.10, 0.02, plinthW / 2 - rightWallW / 2, 0.05, -plinthD / 2 + wallThick + 0.01));

    // Low-profile entryway shoe cabinet (getabako) along right wall
    timberGeos.push(this.createTransformedBox(0.28, 0.72, 0.90, plinthW / 2 - 0.20, 0.36, -1.2));
    timberGeos.push(this.createTransformedBox(0.32, 0.035, 0.96, plinthW / 2 - 0.20, 0.738, -1.2));

    // Exposed Hinoki Timber Ceiling Rafters
    [-1.2, 0, 1.2].forEach(bz => {
      timberGeos.push(this.createTransformedBox(plinthW, 0.08, 0.12, 0, wallH + 0.04, bz));
    });

    // Shoji outer frame & Kumiko lattice bars
    const shojiX = plinthW / 2 - 0.06;
    const shojiFrameW = 1.8;
    const shojiFrameH = wallH;
    timberGeos.push(this.createTransformedBox(0.06, shojiFrameH, 0.06, shojiX, shojiFrameH / 2, 0.3 - shojiFrameW / 2));
    timberGeos.push(this.createTransformedBox(0.06, shojiFrameH, 0.06, shojiX, shojiFrameH / 2, 0.3 + shojiFrameW / 2));
    timberGeos.push(this.createTransformedBox(0.06, 0.08, shojiFrameW, shojiX, shojiFrameH - 0.04, 0.3));

    for (let ki = 1; ki <= 6; ki++) {
      const kz = 0.3 - shojiFrameW / 2 + (shojiFrameW / 7) * ki;
      timberGeos.push(this.createTransformedBox(0.02, shojiFrameH - 0.2, 0.015, shojiX, shojiFrameH / 2, kz));
    }
    for (let kj = 1; kj <= 8; kj++) {
      const ky = (shojiFrameH / 9) * kj;
      timberGeos.push(this.createTransformedBox(0.02, 0.015, shojiFrameW - 0.1, shojiX, ky, 0.3));
    }

    // Japanese Andon Lantern timber base & 4 posts
    timberGeos.push(this.createTransformedBox(0.22, 0.04, 0.22, 1.65, 0.034, 1.65));
    for (const [lx, lz] of [[-0.09, -0.09], [0.09, -0.09], [-0.09, 0.09], [0.09, 0.09]]) {
      timberGeos.push(this.createTransformedBox(0.015, 0.42, 0.015, 1.65 + lx, 0.264, 1.65 + lz));
    }

    const timberMesh = new THREE.Mesh(this.mergeGeometries(timberGeos), woodMat);
    shellGroup.add(timberMesh);

    // Translucent Washi Rice Paper Screen Panel & Lantern Shade (Merged into 1 Draw Call)
    const paperMat = this.getMat('paper.shoji');
    const washiGeo = new THREE.PlaneGeometry(shojiFrameW - 0.1, shojiFrameH - 0.2);
    washiGeo.rotateY(Math.PI / 2);
    washiGeo.translate(shojiX, shojiFrameH / 2, 0.3);
    const shadeBoxGeo = new THREE.BoxGeometry(0.17, 0.38, 0.17);
    shadeBoxGeo.translate(1.65, 0.264, 1.65);
    shellGroup.add(new THREE.Mesh(this.mergeGeometries([washiGeo, shadeBoxGeo]), paperMat));



    // ==========================================
    // 4. BALCONY SLIDING WINDOW & PANORAMIC TOKYO SKYLINE (MERGED)
    // ==========================================
    const winGroup = new THREE.Group();
    const winCenter = -plinthW / 2 + wallThick + windowW / 2;
    winGroup.position.set(winCenter, 0, -plinthD / 2 + wallThick / 2);

    const glassH = wallH - headerH;
    const frameThick = 0.06;
    const frameDepth = 0.06;

    // Window Frame — Merged into 1 draw call
    const winFrameGeos = [
      this.createTransformedBox(frameThick, glassH, frameDepth, -windowW / 2 + frameThick / 2, glassH / 2, 0),
      this.createTransformedBox(frameThick, glassH, frameDepth, windowW / 2 - frameThick / 2, glassH / 2, 0),
      this.createTransformedBox(windowW, frameThick, frameDepth, 0, glassH - frameThick / 2, 0),
      this.createTransformedBox(windowW, frameThick, frameDepth, 0, frameThick / 2, 0),
      this.createTransformedBox(frameThick, glassH, frameDepth * 0.7, 0, glassH / 2, 0),
      // Handrail
      this.createTransformedBox(windowW + 0.2, 0.04, 0.04, 0, 1.02, -0.85)
    ];
    winGroup.add(new THREE.Mesh(this.mergeGeometries(winFrameGeos), frameMat));

    // Transparent Glass Panes & Balustrade — Merged into 1 draw call
    const glassGeos = [
      this.createTransformedBox(windowW / 2 - 0.02, glassH - 0.08, 0.015, -windowW / 4, glassH / 2, 0.015),
      this.createTransformedBox(windowW / 2 - 0.02, glassH - 0.08, 0.015, windowW / 4, glassH / 2, -0.015),
      this.createTransformedBox(windowW, 0.92, 0.015, 0, 0.51, -0.85)
    ];
    winGroup.add(new THREE.Mesh(this.mergeGeometries(glassGeos), glassMat));

    // Exterior Balcony Slab
    const balconySlab = new THREE.Mesh(new THREE.BoxGeometry(windowW + 0.2, 0.12, 0.9), baseMat);
    balconySlab.position.set(0, -0.06, -0.45);
    winGroup.add(balconySlab);

    // Decking Planks — Merged into 1 draw call
    const deckPlankMat = woodMat;
    const deckGeos = [];
    for (let dp = -0.75; dp <= -0.15; dp += 0.12) {
      deckGeos.push(this.createTransformedBox(windowW + 0.16, 0.015, 0.10, 0, 0.008, dp));
    }
    winGroup.add(new THREE.Mesh(this.mergeGeometries(deckGeos), deckPlankMat));

    shellGroup.add(winGroup);

    // WIDE CURVED PANORAMIC TOKYO SKYLINE (Encompasses entire rear & right backdrop, 0 void leaks)
    const skylineGeo = new THREE.CylinderGeometry(5.2, 5.2, 4.8, 36, 1, true, Math.PI * 0.45, Math.PI * 1.10);
    skylineGeo.scale(-1, 1, 1);
    const skylineMesh = new THREE.Mesh(skylineGeo, skylineMat);
    skylineMesh.position.set(0, 1.8, -0.4);
    shellGroup.add(skylineMesh);

    // ==========================================
    // 5. WALL-MOUNTED DAIKIN MINI-SPLIT AC UNIT
    // ==========================================
    const acUnit = new THREE.Group();
    acUnit.position.set(-plinthW / 2 + wallThick + 0.11, 2.25, -0.6);
    acUnit.rotation.y = Math.PI / 2;

    const acBody = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.26, 0.18), acMat);
    acBody.castShadow = true;
    acUnit.add(acBody);

    // Dual Air Deflector Louvers
    const louver1 = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.016, 0.06), woodMat);
    louver1.position.set(0, -0.09, 0.05);
    louver1.rotation.x = 0.28;
    acUnit.add(louver1);

    const louver2 = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.014, 0.05), woodMat);
    louver2.position.set(0, -0.11, 0.04);
    louver2.rotation.x = 0.35;
    acUnit.add(louver2);

    // Digital Temperature Display Screen
    const acDisplay = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.03, 0.005),
      new THREE.MeshStandardMaterial({ color: 0x059669, emissive: 0x10b981, emissiveIntensity: 1.8 })
    );
    acDisplay.position.set(0.26, 0.02, 0.093);
    acUnit.add(acDisplay);

    // Green Power Indicator LED
    const acLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.006, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 2.2 })
    );
    acLed.position.set(0.36, -0.05, 0.095);
    acUnit.add(acLed);

    shellGroup.add(acUnit);

    group.add(shellGroup);
  }

  buildErgonomicChair(group, fabricMat, metalMat) {
    const chairGroup = new THREE.Group();

    // 1. Die-Cast Aluminum 5-Star Base, Cylinder, Spine & Armrests — Merged into 1 single draw call
    const metalGeos = [];
    metalGeos.push(this.createTransformedCylinder(0.028, 0.034, 0.32, 12, 0, 0.22, 0));
    metalGeos.push(this.createTransformedCylinder(0.022, 0.022, 0.18, 12, 0, 0.30, 0));

    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      metalGeos.push(this.createTransformedBox(0.32, 0.022, 0.032, Math.cos(angle) * 0.17, 0.08, Math.sin(angle) * 0.17, 0, -angle, 0));
      // Dual-wheel casters
      metalGeos.push(this.createTransformedCylinder(0.025, 0.025, 0.012, 8, Math.cos(angle) * 0.30 - 0.01, 0.035, Math.sin(angle) * 0.30, 0, 0, Math.PI / 2));
      metalGeos.push(this.createTransformedCylinder(0.025, 0.025, 0.012, 8, Math.cos(angle) * 0.30 + 0.01, 0.035, Math.sin(angle) * 0.30, 0, 0, Math.PI / 2));
    }

    // Seat frame rim
    metalGeos.push(this.createTransformedBox(0.52, 0.045, 0.50, 0, 0.44, 0));

    // Spine skeleton
    metalGeos.push(this.createTransformedBox(0.06, 0.58, 0.035, 0, 0.74, -0.24, -0.06, 0, 0));
    metalGeos.push(this.createTransformedBox(0.03, 0.22, 0.025, -0.12, 0.94, -0.25, 0, 0, -0.32));
    metalGeos.push(this.createTransformedBox(0.03, 0.22, 0.025, 0.12, 0.94, -0.25, 0, 0, 0.32));
    metalGeos.push(this.createTransformedBox(0.34, 0.12, 0.035, 0, 0.62, -0.19));

    // Armrests
    metalGeos.push(this.createTransformedCylinder(0.016, 0.016, 0.18, 10, -0.27, 0.53, -0.02));
    metalGeos.push(this.createTransformedBox(0.09, 0.025, 0.25, -0.27, 0.62, -0.02));
    metalGeos.push(this.createTransformedCylinder(0.016, 0.016, 0.18, 10, 0.27, 0.53, -0.02));
    metalGeos.push(this.createTransformedBox(0.09, 0.025, 0.25, 0.27, 0.62, -0.02));

    const mergedMetalMesh = new THREE.Mesh(this.mergeGeometries(metalGeos), metalMat);
    mergedMetalMesh.castShadow = true;
    chairGroup.add(mergedMetalMesh);

    // 2. Breathable Mesh Seat Pan & Backrest — Merged into 1 draw call
    const fabricGeos = [];
    fabricGeos.push(this.createTransformedBox(0.48, 0.035, 0.46, 0, 0.455, 0.01));
    fabricGeos.push(this.createTransformedCylinder(0.022, 0.022, 0.48, 12, 0, 0.445, 0.24, 0, 0, Math.PI / 2));
    fabricGeos.push(this.createTransformedBox(0.46, 0.56, 0.03, 0, 0.76, -0.21, -0.07, 0, 0));

    const mergedFabricMesh = new THREE.Mesh(this.mergeGeometries(fabricGeos), fabricMat);
    mergedFabricMesh.castShadow = true;
    mergedFabricMesh.receiveShadow = true;
    chairGroup.add(mergedFabricMesh);

    group.add(chairGroup);
  }

  buildTatamiFloor(group, tatamiMat, borderMat) {
    const matW = 0.92;
    const matL = 1.84;
    const thickness = 0.03;

    const mats = [
      { x: -0.92, z: -0.46, rot: 0 },
      { x: -0.92, z: 1.38, rot: 0 },
      { x: 0.92, z: -1.38, rot: 0 },
      { x: 0.92, z: 0.46, rot: 0 },
      { x: 0.0, z: -1.38, rot: Math.PI / 2 },
      { x: 0.0, z: 1.38, rot: Math.PI / 2 }
    ];

    const matGeo = new THREE.BoxGeometry(matW - 0.01, thickness, matL - 0.01);
    const borderGeo = new THREE.BoxGeometry(0.04, thickness + 0.002, matL);

    for (const m of mats) {
      const matMesh = new THREE.Mesh(matGeo, tatamiMat);
      matMesh.position.set(m.x, thickness / 2, m.z);
      matMesh.rotation.y = m.rot;
      matMesh.receiveShadow = true;
      group.add(matMesh);

      const b1 = new THREE.Mesh(borderGeo, borderMat);
      b1.position.set(m.x + Math.cos(m.rot) * (matW / 2 - 0.02), thickness / 2, m.z + Math.sin(m.rot) * (matW / 2 - 0.02));
      b1.rotation.y = m.rot;
      group.add(b1);

      const b2 = new THREE.Mesh(borderGeo, borderMat);
      b2.position.set(m.x - Math.cos(m.rot) * (matW / 2 - 0.02), thickness / 2, m.z - Math.sin(m.rot) * (matW / 2 - 0.02));
      b2.rotation.y = m.rot;
      group.add(b2);
    }
  }

  buildShojiWindow(group, woodMat, paperMat) {
    const frameW = 2.4;
    const frameH = 1.8;
    const frameD = 0.06;

    const frameGeo = new THREE.BoxGeometry(frameW, frameH, frameD);
    const outerFrame = new THREE.Mesh(frameGeo, woodMat);
    outerFrame.position.y = frameH / 2;
    group.add(outerFrame);

    const paper = new THREE.Mesh(new THREE.PlaneGeometry(frameW - 0.12, frameH - 0.12), paperMat);
    paper.position.set(0, frameH / 2, 0.01);
    group.add(paper);

    const latticeMat = woodMat;
    const vertCount = 8;
    for (let i = 1; i < vertCount; i++) {
      const vx = -frameW / 2 + (frameW / vertCount) * i;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.018, frameH - 0.12, 0.015), latticeMat);
      bar.position.set(vx, frameH / 2, 0.018);
      group.add(bar);
    }

    const horizCount = 6;
    for (let j = 1; j < horizCount; j++) {
      const hy = (frameH / horizCount) * j;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(frameW - 0.12, 0.018, 0.015), latticeMat);
      bar.position.set(0, hy, 0.018);
      group.add(bar);
    }
  }

  buildBonsai(group, ceramicMat, greenMat, woodMat) {
    const bonsaiGroup = new THREE.Group();

    // 1. Carved Dark Rosewood Display Stand (Base + 4 Feet merged into 1 Draw Call)
    const standMat = new THREE.MeshStandardMaterial({ color: 0x22130c, roughness: 0.7 });
    const standGeos = [
      this.createTransformedBox(0.24, 0.018, 0.18, 0, 0.009, 0),
      this.createTransformedBox(0.02, 0.01, 0.02, -0.10, 0.005, -0.07),
      this.createTransformedBox(0.02, 0.01, 0.02, 0.10, 0.005, -0.07),
      this.createTransformedBox(0.02, 0.01, 0.02, -0.10, 0.005, 0.07),
      this.createTransformedBox(0.02, 0.01, 0.02, 0.10, 0.005, 0.07)
    ];
    const standMesh = new THREE.Mesh(this.mergeGeometries(standGeos), standMat);
    standMesh.castShadow = true;
    bonsaiGroup.add(standMesh);

    // 2. Glazed Oval Ceramic Bonsai Dish (1 Draw Call)
    const potGeo = new THREE.CylinderGeometry(0.12, 0.09, 0.05, 20);
    potGeo.scale(1.15, 1, 0.85);
    potGeo.translate(0, 0.043, 0);
    const potMesh = new THREE.Mesh(potGeo, ceramicMat);
    potMesh.castShadow = true;
    bonsaiGroup.add(potMesh);

    // Moss Bed Ground Cover & River Pebbles (Merged 1 Draw Call)
    const mossMat = new THREE.MeshStandardMaterial({ color: 0x2e4a24, roughness: 0.95 });
    const mossGeos = [];
    const baseMoss = new THREE.CylinderGeometry(0.11, 0.11, 0.01, 16);
    baseMoss.scale(1.1, 1, 0.82);
    baseMoss.translate(0, 0.068, 0);
    mossGeos.push(baseMoss);

    const p1 = new THREE.SphereGeometry(0.014, 8, 6);
    p1.translate(-0.06, 0.075, 0.03);
    mossGeos.push(p1);
    const p2 = new THREE.SphereGeometry(0.011, 8, 6);
    p2.translate(0.05, 0.073, -0.02);
    mossGeos.push(p2);
    bonsaiGroup.add(new THREE.Mesh(this.mergeGeometries(mossGeos), mossMat));

    // 3. Gnarled Driftwood Trunk & Branches (Merged 1 Draw Call)
    const trunkGeos = [
      this.createTransformedCylinder(0.022, 0.038, 0.12, 10, 0.01, 0.12, 0, 0, 0, 0.22),
      this.createTransformedCylinder(0.015, 0.022, 0.11, 10, 0.035, 0.21, -0.01, 0, 0, -0.38),
      this.createTransformedCylinder(0.008, 0.014, 0.10, 8, -0.04, 0.24, 0.02, 0, 0, 0.85),
      this.createTransformedCylinder(0.009, 0.013, 0.09, 8, 0.08, 0.27, -0.02, 0, 0, -0.75)
    ];
    const trunkMesh = new THREE.Mesh(this.mergeGeometries(trunkGeos), woodMat);
    trunkMesh.castShadow = true;
    bonsaiGroup.add(trunkMesh);

    // 4. Multi-Tiered Organic Foliage Clouds (Merged into 1 Draw Call)
    const foliageGeos = [];
    const addCloud = (x, y, z, sx, sy, sz) => {
      const g1 = new THREE.SphereGeometry(0.045, 8, 6);
      g1.scale(sx, sy, sz);
      g1.translate(x, y, z);
      foliageGeos.push(g1);

      const g2 = new THREE.SphereGeometry(0.032, 8, 6);
      g2.scale(sx * 0.9, sy * 0.9, sz * 0.9);
      g2.translate(x + sx * 0.02, y + sy * 0.01, z + 0.02);
      foliageGeos.push(g2);
    };

    addCloud(-0.09, 0.26, 0.02, 1.4, 0.55, 1.1);
    addCloud(0.12, 0.29, -0.02, 1.5, 0.55, 1.1);
    addCloud(0.02, 0.35, 0, 1.6, 0.6, 1.2);
    addCloud(-0.02, 0.31, -0.05, 1.2, 0.5, 0.9);

    const foliageMesh = new THREE.Mesh(this.mergeGeometries(foliageGeos), greenMat);
    foliageMesh.castShadow = true;
    bonsaiGroup.add(foliageMesh);

    group.add(bonsaiGroup);
  }

  buildGameShelf(group, woodMat, redMat) {
    const shelfGroup = new THREE.Group();

    // 1. Staggered Dual Birch Floating Shelves — Merged into 1 draw call
    const shelfGeos = [
      this.createTransformedBox(1.35, 0.035, 0.24, 0, 0.15, 0),
      this.createTransformedBox(1.10, 0.035, 0.24, 0.15, -0.22, 0)
    ];
    const shelvesMesh = new THREE.Mesh(this.mergeGeometries(shelfGeos), woodMat);
    shelvesMesh.castShadow = true;
    shelfGroup.add(shelvesMesh);

    // 2. Row of 12 Physical Nintendo Switch Game Cases — Hardware Instanced (1 draw call)
    const caseGeo = new THREE.BoxGeometry(0.016, 0.17, 0.105);
    const spineColors = [
      0xff3b20, 0x0284c7, 0x16a34a, 0xeab308, 0x9333ea,
      0xff3b20, 0xef4444, 0x0ea5e9, 0xf97316, 0xff3b20, 0x10b981, 0xff3b20
    ];

    const caseMat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.05 });
    const instCases = new THREE.InstancedMesh(caseGeo, caseMat, spineColors.length);
    instCases.castShadow = true;
    instCases.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const tmpColor = new THREE.Color();

    spineColors.forEach((col, i) => {
      dummy.position.set(-0.54 + i * 0.024, 0.25, 0);
      dummy.rotation.set(0, 0, (i === 11) ? -0.14 : 0);
      dummy.updateMatrix();
      instCases.setMatrixAt(i, dummy.matrix);
      tmpColor.setHex(col);
      instCases.setColorAt(i, tmpColor);
    });
    instCases.instanceMatrix.needsUpdate = true;
    if (instCases.instanceColor) instCases.instanceColor.needsUpdate = true;
    shelfGroup.add(instCases);

    // Sleek Metal Bookend
    const bookendMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.4 });
    const bookend = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.16, 0.09), bookendMat);
    bookend.position.set(-0.56, 0.245, 0);
    shelfGroup.add(bookend);

    // 3. Lower Shelf: Stack of Nintendo Design Artbooks
    const book1 = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.035, 0.18), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 }));
    book1.position.set(-0.25, -0.18, 0);
    shelfGroup.add(book1);
    const book2 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.028, 0.16), new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.6 }));
    book2.position.set(-0.25, -0.15, 0);
    shelfGroup.add(book2);

    // 4. Miniature Famicom / NES Console Collectible
    const famicomGroup = new THREE.Group();
    famicomGroup.position.set(0.08, -0.17, 0);
    const fBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.09), new THREE.MeshStandardMaterial({ color: 0xe5e5e5, roughness: 0.5 }));
    famicomGroup.add(fBody);
    const fStripe = new THREE.Mesh(new THREE.BoxGeometry(0.122, 0.012, 0.05), new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.5 }));
    famicomGroup.add(fStripe);
    shelfGroup.add(famicomGroup);

    // 5. Golden Triforce Collectible Relic (Illuminated with subtle warm aura)
    const triGroup = new THREE.Group();
    triGroup.position.set(0.48, 0.23, 0);
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.45,
      roughness: 0.22,
      metalness: 0.92
    });

    const tri1 = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.075, 3), goldMat);
    tri1.position.set(0, 0.04, 0);
    triGroup.add(tri1);

    shelfGroup.add(triGroup);

    group.add(shelfGroup);
  }

  // ==========================================
  // SKYRIM: SCHOOL / COLLEGE OF WINTERHOLD ARCHETYPES
  // ==========================================

  buildWinterholdShell(group, stoneMat, carvedMat, runeMat, bannerMat, ironMat, auroraMat, witchlightMat, iceMat) {
    const shellGroup = new THREE.Group();

    const plinthW = 4.8;
    const plinthD = 4.8;
    const plinthH = 0.22;
    const wallH = 3.6;
    const wallThick = 0.24;
    const rearZ = -plinthD / 2 + wallThick / 2;
    const winW = 1.35;
    const winH = 2.4;
    const headerH = 0.7;
    const daisR = 1.65;

    // 1. COMPOUNDED NORDIC STONE WALLS & FLOOR (1 Merged Draw Call)
    const stoneGeos = [
      this.createTransformedBox(plinthW - 0.06, 0.02, plinthD - 0.06, 0, 0.01, 0), // Floor
      this.createTransformedBox(wallThick, wallH, plinthD, -plinthW / 2 + wallThick / 2, wallH / 2, 0), // Left Wall
      this.createTransformedBox(1.3, wallH, wallThick, -1.75, wallH / 2, rearZ), // Back Wall L
      this.createTransformedBox(1.3, wallH, wallThick, 1.75, wallH / 2, rearZ), // Back Wall R
      this.createTransformedBox(plinthW, headerH, wallThick, 0, wallH - headerH / 2, rearZ) // Back Header Lintel
    ];
    const stoneMesh = new THREE.Mesh(this.mergeGeometries(stoneGeos), stoneMat);
    stoneMesh.receiveShadow = true;
    shellGroup.add(stoneMesh);

    // 2. COMPOUNDED CARVED GRANITE PLINTH, DAIS & ARCHITECTURAL RELIEF (1 Merged Draw Call)
    const carvedGeos = [
      this.createTransformedBox(plinthW, plinthH, plinthD, 0, -plinthH / 2, 0), // Plinth
      this.createTransformedCylinder(daisR, daisR + 0.08, 0.05, 32, 0, 0.025, 0), // Dais
      this.createTransformedBox(0.12, 0.16, plinthD, -plinthW / 2 + wallThick + 0.06, 0.1, 0), // Trim L
      this.createTransformedBox(0.44, wallH, wallThick + 0.06, 0, wallH / 2, rearZ), // Center Pillar
      this.createTransformedBox(0.16, 0.22, plinthD, -1.0, wallH - 0.08, 0), // Rib 1
      this.createTransformedBox(plinthW, 0.22, 0.16, 0, wallH - 0.08, -0.6) // Rib 2
    ];

    const windowPositions = [-0.85, 0.85];
    for (const wx of windowPositions) {
      // Sill
      carvedGeos.push(this.createTransformedBox(winW + 0.08, 0.14, wallThick + 0.1, wx, 0.85, rearZ));
      // Gothic arch peak cone
      const archPeakGeo = new THREE.ConeGeometry(winW / 2 + 0.05, 0.55, 3);
      archPeakGeo.rotateZ(Math.PI);
      archPeakGeo.translate(wx, 0.85 + winH + 0.15, rearZ);
      carvedGeos.push(archPeakGeo);
    }
    const carvedMesh = new THREE.Mesh(this.mergeGeometries(carvedGeos), carvedMat);
    carvedMesh.receiveShadow = true;
    shellGroup.add(carvedMesh);

    // 3. GLOWING ARCANE RUNE INLAY (1 Draw Call)
    const runeMesh = new THREE.Mesh(new THREE.CylinderGeometry(daisR - 0.1, daisR - 0.1, 0.02, 32), runeMat);
    runeMesh.position.set(0, 0.051, 0);
    runeMesh.receiveShadow = true;
    shellGroup.add(runeMesh);



    // Floating Arcane Rune Motes (Magical particles)
    const particleCount = 75;
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    // Deterministic particle layout (Law G): fixed-seed mulberry32 instead of Math.random
    let _s = 0x5eed1e55;
    const rand = () => { _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let p = 0; p < particleCount; p++) {
      const theta = rand() * Math.PI * 2;
      const radius = rand() * (daisR - 0.2);
      particlePositions[p * 3] = Math.cos(theta) * radius;
      particlePositions[p * 3 + 1] = 0.15 + rand() * 2.2;
      particlePositions[p * 3 + 2] = Math.sin(theta) * radius;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: 0x38bdf8,
      size: 0.038,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });
    const motes = new THREE.Points(particleGeo, particleMat);
    shellGroup.add(motes);

    // 4. FROSTED GLACIAL ICE WINDOW PANES (Merged 1 Draw Call)
    const iceGeos = [];
    for (const wx of windowPositions) {
      iceGeos.push(this.createTransformedBox(winW, winH, 0.02, wx, 0.85 + winH / 2, rearZ));
    }
    shellGroup.add(new THREE.Mesh(this.mergeGeometries(iceGeos), iceMat));

    // 5. WROUGHT-IRON ARCHITECTURAL & CHANDELIER ELEMENTS (Merged 1 Draw Call)
    const ironGeos = [];
    for (const wx of windowPositions) {
      // Window vertical mullion
      ironGeos.push(this.createTransformedCylinder(0.015, 0.015, winH, 8, wx, 0.85 + winH / 2, rearZ + 0.02));
      // Window horizontal bars
      ironGeos.push(this.createTransformedCylinder(0.015, 0.015, winW, 8, wx, 0.85 + winH * 0.4, rearZ + 0.02, 0, 0, Math.PI / 2));
      ironGeos.push(this.createTransformedCylinder(0.015, 0.015, winW, 8, wx, 0.85 + winH * 0.75, rearZ + 0.02, 0, 0, Math.PI / 2));
    }

    // Chandelier iron components
    const chX = 0, chY = 2.75, chZ = -0.4;
    for (let c = 0; c < 4; c++) {
      const ca = (c / 4) * Math.PI * 2 + Math.PI / 4;
      ironGeos.push(this.createTransformedCylinder(0.008, 0.008, 0.85, 6,
        chX + Math.cos(ca) * 0.28, chY + 0.42, chZ + Math.sin(ca) * 0.28,
        Math.sin(ca) * 0.22, 0, Math.cos(ca) * -0.22
      ));
    }
    // Chandelier iron ring
    const chRingGeo = new THREE.TorusGeometry(0.58, 0.035, 8, 20);
    chRingGeo.rotateX(Math.PI / 2);
    chRingGeo.translate(chX, chY, chZ);
    ironGeos.push(chRingGeo);

    // Chandelier cups & flames
    const chFlameGeos = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const bx = chX + Math.cos(a) * 0.58;
      const bz = chZ + Math.sin(a) * 0.58;

      ironGeos.push(this.createTransformedCylinder(0.07, 0.03, 0.09, 8, bx, chY + 0.04, bz));

      const flameGeo = new THREE.ConeGeometry(0.045, 0.12, 8);
      flameGeo.translate(bx, chY + 0.12, bz);
      chFlameGeos.push(flameGeo);
    }

    // Banner hanging rods
    ironGeos.push(this.createTransformedCylinder(0.015, 0.015, 0.82, 8, -1.75, 3.02, rearZ + 0.16, 0, 0, Math.PI / 2));
    ironGeos.push(this.createTransformedCylinder(0.015, 0.015, 0.82, 8, 1.75, 3.02, rearZ + 0.16, 0, 0, Math.PI / 2));

    shellGroup.add(new THREE.Mesh(this.mergeGeometries(ironGeos), ironMat));
    shellGroup.add(new THREE.Mesh(this.mergeGeometries(chFlameGeos), witchlightMat));

    // 6. CURVED PANORAMIC SEA OF GHOSTS & AURORA
    const auroraGeo = new THREE.CylinderGeometry(3.2, 3.2, 4.8, 32, 1, true, Math.PI * 0.65, Math.PI * 0.70);
    auroraGeo.scale(-1, 1, 1);
    const auroraMesh = new THREE.Mesh(auroraGeo, auroraMat);
    auroraMesh.position.set(0, 2.2, -1.2);
    shellGroup.add(auroraMesh);

    // 7. TAPESTRY BANNERS (Merged 1 Draw Call)
    const bannerGeos = [
      this.createTransformedBox(0.68, 1.8, 0.02, -1.75, 2.1, rearZ + 0.14),
      this.createTransformedBox(0.68, 1.8, 0.02, 1.75, 2.1, rearZ + 0.14)
    ];
    const bannerMesh = new THREE.Mesh(this.mergeGeometries(bannerGeos), bannerMat);
    bannerMesh.castShadow = true;
    shellGroup.add(bannerMesh);

    group.add(shellGroup);
  }

  buildLibraryShell(group, stoneMat, woodMat, glassMat, skylineMat) {
    const shellGroup = new THREE.Group();

    const plinthW = 5.4;
    const plinthD = 5.2;
    const plinthH = 0.18;
    const wallH = 3.8;
    const wallThick = 0.24;
    const rearZ = -plinthD / 2 + wallThick / 2;
    const winW = 1.4;
    const winH = 2.2;
    const headerH = 0.8;

    // 1. COMPOUNDED SCRIPTORIUM STONE WALLS & FLOOR (1 Merged Draw Call)
    const stoneGeos = [
      this.createTransformedBox(plinthW, plinthH, plinthD, 0, -plinthH / 2, 0), // Floor Plinth
      this.createTransformedBox(wallThick, wallH, plinthD, -plinthW / 2 + wallThick / 2, wallH / 2, 0), // Left Masonry Wall
      this.createTransformedBox(1.9, wallH, wallThick, -1.75, wallH / 2, rearZ), // Back Wall Left
      this.createTransformedBox(1.9, wallH, wallThick, 1.75, wallH / 2, rearZ),  // Back Wall Right
      this.createTransformedBox(plinthW, headerH, wallThick, 0, wallH - headerH / 2, rearZ), // Upper Lintel Header
      this.createTransformedBox(winW + 0.16, 0.16, wallThick + 0.12, 0, 0.92, rearZ), // Gothic Window Sill
      this.createTransformedBox(wallThick, wallH, 3.2, plinthW / 2 - wallThick / 2, wallH / 2, rearZ + 1.6), // Right Masonry Wall Return
      this.createTransformedBox(0.12, 0.24, plinthD, -plinthW / 2 + wallThick + 0.06, 0.12, 0), // Stone Baseboard Plinth L
      this.createTransformedBox(0.12, 0.24, 3.2, plinthW / 2 - wallThick - 0.06, 0.12, rearZ + 1.6) // Stone Baseboard Plinth R
    ];

    // Gothic Arch Peak
    const archPeakGeo = new THREE.ConeGeometry(winW / 2 + 0.04, 0.55, 3);
    archPeakGeo.rotateZ(Math.PI);
    archPeakGeo.translate(0, 0.92 + winH + 0.15, rearZ);
    stoneGeos.push(archPeakGeo);

    const stoneMesh = new THREE.Mesh(this.mergeGeometries(stoneGeos), stoneMat);
    stoneMesh.receiveShadow = true;
    shellGroup.add(stoneMesh);

    // 2. COMPOUNDED TIMBER CEILING BEAMS & OAK WAINSCOTING (1 Merged Draw Call)
    const woodGeos = [
      // Wall wainscoting paneling (lower 1.1m)
      this.createTransformedBox(0.04, 1.1, plinthD - wallThick, -plinthW / 2 + wallThick + 0.02, 0.55, 0),
      this.createTransformedBox(1.85, 1.1, 0.04, -1.75, 0.55, rearZ + wallThick / 2 + 0.02),
      this.createTransformedBox(1.85, 1.1, 0.04, 1.75, 0.55, rearZ + wallThick / 2 + 0.02),
      this.createTransformedBox(0.04, 1.1, 3.1, plinthW / 2 - wallThick - 0.02, 0.55, rearZ + 1.6),
      // Wainscot chair rail trim
      this.createTransformedBox(0.06, 0.06, plinthD - wallThick, -plinthW / 2 + wallThick + 0.03, 1.12, 0),
      this.createTransformedBox(1.85, 0.06, 0.06, -1.75, 1.12, rearZ + wallThick / 2 + 0.03),
      this.createTransformedBox(1.85, 0.06, 0.06, 1.75, 1.12, rearZ + wallThick / 2 + 0.03),
      this.createTransformedBox(0.06, 0.06, 3.1, plinthW / 2 - wallThick - 0.03, 1.12, rearZ + 1.6),
      // Exposed massive timber ceiling cross-beams
      this.createTransformedBox(plinthW, 0.22, 0.18, 0, wallH - 0.11, -1.8),
      this.createTransformedBox(plinthW, 0.22, 0.18, 0, wallH - 0.11, -0.4),
      this.createTransformedBox(plinthW, 0.22, 0.18, 0, wallH - 0.11, 1.0),
      // Window oak mullion bars
      this.createTransformedBox(0.03, winH, 0.06, 0, 0.92 + winH / 2, rearZ + 0.02),
      this.createTransformedBox(winW, 0.03, 0.06, 0, 0.92 + winH * 0.45, rearZ + 0.02)
    ];
    const woodMesh = new THREE.Mesh(this.mergeGeometries(woodGeos), woodMat);
    woodMesh.receiveShadow = true;
    woodMesh.castShadow = true;
    shellGroup.add(woodMesh);

    // 3. ARCHED WINDOW GLASS (1 Draw Call)
    const glassMesh = new THREE.Mesh(
      new THREE.BoxGeometry(winW, winH, 0.02),
      glassMat || this.getMat('glass.window')
    );
    glassMesh.position.set(0, 0.92 + winH / 2, rearZ);
    shellGroup.add(glassMesh);

    // 4. PANORAMIC MOONLIT MISTY MOUNTAINS VISTA (1 Draw Call)
    const skylineGeo = new THREE.CylinderGeometry(5.0, 5.0, 4.8, 36, 1, true, Math.PI * 0.45, Math.PI * 1.10);
    skylineGeo.scale(-1, 1, 1);
    const skylineMesh = new THREE.Mesh(skylineGeo, skylineMat || this.getMat('skyline.misty_mountains'));
    skylineMesh.position.set(0, 2.2, -0.6);
    shellGroup.add(skylineMesh);



    group.add(shellGroup);
  }

  buildAlchemistShell(group, stoneMat, woodMat, glassMat, skylineMat) {
    const shellGroup = new THREE.Group();

    const plinthW = 5.2;
    const plinthD = 5.0;
    const plinthH = 0.18;
    const wallH = 3.6;
    const wallThick = 0.22;
    const rearZ = -plinthD / 2 + wallThick / 2;
    const winW = 1.4;
    const winH = 1.8;
    const winX = 0.8;
    const headerH = 0.7;

    // 1. COMPOUNDED CELLAR STONE WALLS, PLINTH & VAULTED ARCH RIBS (1 Merged Draw Call)
    const stoneGeos = [
      this.createTransformedBox(plinthW, plinthH, plinthD, 0, -plinthH / 2, 0), // Floor Plinth
      this.createTransformedBox(wallThick, wallH, plinthD, -plinthW / 2 + wallThick / 2, wallH / 2, 0), // Left Wall
      this.createTransformedBox(wallThick, wallH, 2.6, plinthW / 2 - wallThick / 2, wallH / 2, rearZ + 1.3), // Right Wall Return
      // Back wall with arched window opening
      this.createTransformedBox(plinthW / 2 + winX - winW / 2, wallH, wallThick, (-plinthW / 2 + (winX - winW / 2)) / 2, wallH / 2, rearZ),
      this.createTransformedBox(plinthW / 2 - (winX + winW / 2), wallH, wallThick, (plinthW / 2 + (winX + winW / 2)) / 2, wallH / 2, rearZ),
      this.createTransformedBox(winW, 1.1, wallThick, winX, 0.55, rearZ), // Wall below window
      this.createTransformedBox(winW, headerH, wallThick, winX, wallH - headerH / 2, rearZ), // Header above window
      this.createTransformedBox(winW + 0.16, 0.14, wallThick + 0.1, winX, 1.12, rearZ), // Stone Window Sill
      // Vaulted ceiling transverse stone arch ribs
      this.createTransformedBox(plinthW, 0.22, 0.20, 0, wallH - 0.11, -1.6),
      this.createTransformedBox(plinthW, 0.22, 0.20, 0, wallH - 0.11, 0.4),
      // Baseboards
      this.createTransformedBox(0.10, 0.22, plinthD, -plinthW / 2 + wallThick + 0.05, 0.11, 0)
    ];

    // Romanesque semi-circular arch top over window
    const archTopGeo = new THREE.CylinderGeometry(winW / 2 + 0.04, winW / 2 + 0.04, wallThick, 16, 1, false, 0, Math.PI);
    archTopGeo.rotateZ(Math.PI / 2);
    archTopGeo.translate(winX, 1.1 + winH, rearZ);
    stoneGeos.push(archTopGeo);

    const stoneMesh = new THREE.Mesh(this.mergeGeometries(stoneGeos), stoneMat || this.getMat('stone.rough_local'));
    stoneMesh.receiveShadow = true;
    shellGroup.add(stoneMesh);

    // 2. COMPOUNDED APOTHECARY WOODEN WALL SHELVES & CEILING TIE BEAMS (1 Merged Draw Call)
    const woodGeos = [
      // Wall-mounted apothecary shelving on left wall
      this.createTransformedBox(0.26, 0.035, 2.8, -plinthW / 2 + wallThick + 0.13, 1.3, -0.6),
      this.createTransformedBox(0.26, 0.035, 2.8, -plinthW / 2 + wallThick + 0.13, 1.8, -0.6),
      this.createTransformedBox(0.26, 0.035, 2.8, -plinthW / 2 + wallThick + 0.13, 2.3, -0.6),
      // Shelf vertical upright supports
      this.createTransformedBox(0.04, 1.4, 0.24, -plinthW / 2 + wallThick + 0.13, 1.8, -1.9),
      this.createTransformedBox(0.04, 1.4, 0.24, -plinthW / 2 + wallThick + 0.13, 1.8, 0.7),
      // Window mullions
      this.createTransformedBox(0.03, winH, 0.05, winX, 1.1 + winH / 2, rearZ + 0.02),
      this.createTransformedBox(winW, 0.03, 0.05, winX, 1.1 + winH * 0.5, rearZ + 0.02)
    ];
    const woodMesh = new THREE.Mesh(this.mergeGeometries(woodGeos), woodMat || this.getMat('wood.dark_oak'));
    woodMesh.receiveShadow = true;
    woodMesh.castShadow = true;
    shellGroup.add(woodMesh);

    // 3. ARCHED WINDOW GLASS (1 Draw Call)
    const glassMesh = new THREE.Mesh(
      new THREE.BoxGeometry(winW, winH, 0.02),
      glassMat || this.getMat('glass.window')
    );
    glassMesh.position.set(winX, 1.1 + winH / 2, rearZ);
    shellGroup.add(glassMesh);

    // 4. PANORAMIC COBBLESTONE ALLEY VISTA (1 Draw Call)
    const skylineGeo = new THREE.CylinderGeometry(5.0, 5.0, 4.8, 36, 1, true, Math.PI * 0.45, Math.PI * 1.10);
    skylineGeo.scale(-1, 1, 1);
    const skylineMesh = new THREE.Mesh(skylineGeo, skylineMat || this.getMat('skyline.cobblestone_alley'));
    skylineMesh.position.set(0, 2.0, -0.6);
    shellGroup.add(skylineMesh);



    group.add(shellGroup);
  }

  buildArmoryShell(group, stoneMat, ironMat, woodMat, skylineMat) {
    const shellGroup = new THREE.Group();

    const plinthW = 5.2;
    const plinthD = 5.0;
    const plinthH = 0.20;
    const wallH = 3.6;
    const wallThick = 0.25;
    const rearZ = -plinthD / 2 + wallThick / 2;

    // 1. COMPOUNDED FORTRESS GRANITE WALLS & FLOOR (1 Merged Draw Call)
    const stoneGeos = [
      this.createTransformedBox(plinthW, plinthH, plinthD, 0, -plinthH / 2, 0), // Floor Plinth
      this.createTransformedBox(wallThick, wallH, plinthD, -plinthW / 2 + wallThick / 2, wallH / 2, 0), // Left Wall
      this.createTransformedBox(wallThick, wallH, 2.8, plinthW / 2 - wallThick / 2, wallH / 2, rearZ + 1.4), // Right Wall Return
      // Back wall with dual defensive arrow slits
      this.createTransformedBox(1.6, wallH, wallThick, -1.8, wallH / 2, rearZ),
      this.createTransformedBox(1.5, wallH, wallThick, 0.1, wallH / 2, rearZ),
      this.createTransformedBox(1.4, wallH, wallThick, 1.9, wallH / 2, rearZ),
      this.createTransformedBox(0.45, 1.0, wallThick, -0.85, 0.5, rearZ), // Wall below embrasure 1
      this.createTransformedBox(0.45, 0.8, wallThick, -0.85, wallH - 0.4, rearZ), // Wall above embrasure 1
      this.createTransformedBox(0.45, 1.0, wallThick, 1.0, 0.5, rearZ), // Wall below embrasure 2
      this.createTransformedBox(0.45, 0.8, wallThick, 1.0, wallH - 0.4, rearZ), // Wall above embrasure 2
      // Massive stone baseboards
      this.createTransformedBox(0.12, 0.25, plinthD, -plinthW / 2 + wallThick + 0.06, 0.125, 0),
      this.createTransformedBox(0.12, 0.25, 2.8, plinthW / 2 - wallThick - 0.06, 0.125, rearZ + 1.4)
    ];

    const stoneMesh = new THREE.Mesh(this.mergeGeometries(stoneGeos), stoneMat || this.getMat('stone.rough_local'));
    stoneMesh.receiveShadow = true;
    shellGroup.add(stoneMesh);

    // 2. COMPOUNDED HEAVY TIMBER ROOF TRUSSES (1 Merged Draw Call)
    const woodGeos = [
      this.createTransformedBox(plinthW, 0.24, 0.20, 0, wallH - 0.12, -1.6),
      this.createTransformedBox(plinthW, 0.24, 0.20, 0, wallH - 0.12, 0.5),
      // Wall corbels
      this.createTransformedBox(0.20, 0.35, 0.22, -plinthW / 2 + wallThick + 0.1, wallH - 0.35, -1.6),
      this.createTransformedBox(0.20, 0.35, 0.22, -plinthW / 2 + wallThick + 0.1, wallH - 0.35, 0.5)
    ];
    const woodMesh = new THREE.Mesh(this.mergeGeometries(woodGeos), woodMat || this.getMat('wood.weathered_oak'));
    woodMesh.receiveShadow = true;
    woodMesh.castShadow = true;
    shellGroup.add(woodMesh);

    // 3. COMPOUNDED IRON CORNER BRACKETS & WALL SCONCES (1 Merged Draw Call)
    const ironGeos = [
      // Wall torch sconce backplates
      this.createTransformedBox(0.08, 0.32, 0.02, -plinthW / 2 + wallThick + 0.02, 2.0, -0.6),
      this.createTransformedBox(0.08, 0.32, 0.02, -plinthW / 2 + wallThick + 0.02, 2.0, 1.2),
      // Torch sconce arms
      this.createTransformedCylinder(0.015, 0.015, 0.25, 8, -plinthW / 2 + wallThick + 0.12, 2.0, -0.6, 0, 0, Math.PI / 3),
      this.createTransformedCylinder(0.015, 0.015, 0.25, 8, -plinthW / 2 + wallThick + 0.12, 2.0, 1.2, 0, 0, Math.PI / 3),
      // Beam iron straps
      this.createTransformedBox(0.04, 0.26, 0.22, -0.8, wallH - 0.12, -1.6),
      this.createTransformedBox(0.04, 0.26, 0.22, 0.8, wallH - 0.12, -1.6)
    ];
    const ironMesh = new THREE.Mesh(this.mergeGeometries(ironGeos), ironMat || this.getMat('metal.forged_iron'));
    ironMesh.castShadow = true;
    shellGroup.add(ironMesh);

    // 4. PANORAMIC STORMY BASTION VISTA (1 Draw Call)
    const skylineGeo = new THREE.CylinderGeometry(5.0, 5.0, 4.8, 36, 1, true, Math.PI * 0.45, Math.PI * 1.10);
    skylineGeo.scale(-1, 1, 1);
    const skylineMesh = new THREE.Mesh(skylineGeo, skylineMat || this.getMat('skyline.stormy_bastion'));
    skylineMesh.position.set(0, 2.0, -0.6);
    shellGroup.add(skylineMesh);



    group.add(shellGroup);
  }

  buildForgePavilionShell(group, stoneMat, woodMat, skylineMat) {
    const shellGroup = new THREE.Group();

    const plinthW = 5.2;
    const plinthD = 5.0;
    const plinthH = 0.18;
    const postH = 3.2;
    const postThick = 0.18;

    // 1. COMPOUNDED WORKSHOP APRON & LOW STONE RETAINING WALL (1 Merged Draw Call)
    const stoneGeos = [
      this.createTransformedBox(plinthW, plinthH, plinthD, 0, -plinthH / 2, 0), // Floor Plinth
      // Low stone retaining ledge along rear & left
      this.createTransformedBox(0.24, 0.65, plinthD - 0.4, -plinthW / 2 + 0.12, 0.325, 0),
      this.createTransformedBox(plinthW - 0.4, 0.65, 0.24, 0, 0.325, -plinthD / 2 + 0.12),
      // Heavy stone post pedestals under posts
      this.createTransformedBox(0.32, 0.22, 0.32, -2.1, 0.11, -2.0),
      this.createTransformedBox(0.32, 0.22, 0.32, 2.1, 0.11, -2.0),
      this.createTransformedBox(0.32, 0.22, 0.32, -2.1, 0.11, 2.0),
      this.createTransformedBox(0.32, 0.22, 0.32, 2.1, 0.11, 2.0)
    ];
    const stoneMesh = new THREE.Mesh(this.mergeGeometries(stoneGeos), stoneMat || this.getMat('stone.rough_local'));
    stoneMesh.receiveShadow = true;
    shellGroup.add(stoneMesh);

    // 2. COMPOUNDED RUSTIC TIMBERFRAME PAVILION POSTS & ROOF TRUSSES (1 Merged Draw Call)
    const woodGeos = [
      // 4 Upright Cedar Posts
      this.createTransformedBox(postThick, postH, postThick, -2.1, postH / 2 + 0.22, -2.0),
      this.createTransformedBox(postThick, postH, postThick, 2.1, postH / 2 + 0.22, -2.0),
      this.createTransformedBox(postThick, postH, postThick, -2.1, postH / 2 + 0.22, 2.0),
      this.createTransformedBox(postThick, postH, postThick, 2.1, postH / 2 + 0.22, 2.0),
      // Longitudinal tie beams
      this.createTransformedBox(postThick, 0.20, 4.0, -2.1, postH + 0.12, 0),
      this.createTransformedBox(postThick, 0.20, 4.0, 2.1, postH + 0.12, 0),
      // Transverse header beams
      this.createTransformedBox(4.4, 0.20, postThick, 0, postH + 0.12, -2.0),
      this.createTransformedBox(4.4, 0.20, postThick, 0, postH + 0.12, 2.0),
      this.createTransformedBox(4.4, 0.20, postThick, 0, postH + 0.12, 0),
      // Timber rafters
      this.createTransformedBox(4.6, 0.10, 0.12, 0, postH + 0.32, -1.2),
      this.createTransformedBox(4.6, 0.10, 0.12, 0, postH + 0.32, 0.8)
    ];
    const woodMesh = new THREE.Mesh(this.mergeGeometries(woodGeos), woodMat || this.getMat('wood.dark_oak'));
    woodMesh.receiveShadow = true;
    woodMesh.castShadow = true;
    shellGroup.add(woodMesh);

    // 3. PANORAMIC ALPINE TWILIGHT VALLEY VISTA (1 Draw Call)
    const skylineGeo = new THREE.CylinderGeometry(5.2, 5.2, 5.0, 36, 1, true, Math.PI * 0.40, Math.PI * 1.20);
    skylineGeo.scale(-1, 1, 1);
    const skylineMesh = new THREE.Mesh(skylineGeo, skylineMat || this.getMat('skyline.twilight_valley'));
    skylineMesh.position.set(0, 2.2, -0.4);
    shellGroup.add(skylineMesh);



    group.add(shellGroup);
  }

  buildTavernHallShell(group, plasterMat, woodMat, stoneMat, glassMat, skylineMat) {
    const shellGroup = new THREE.Group();

    const plinthW = 5.2;
    const plinthD = 5.2;
    const plinthH = 0.18;
    const wallH = 3.6;
    const wallThick = 0.20;
    const rearZ = -plinthD / 2 + wallThick / 2;
    const winW = 1.4;
    const winH = 1.6;
    const winX = -1.2;

    // 1. COMPOUNDED DARK OAK FLOOR PLANKS & TUDOR HALF-TIMBERS (1 Merged Draw Call)
    const woodGeos = [
      this.createTransformedBox(plinthW, plinthH, plinthD, 0, -plinthH / 2, 0), // Floor Plinth
      // Tudor timber wall studs & plates along back wall
      this.createTransformedBox(plinthW, 0.14, wallThick + 0.02, 0, 0.07, rearZ), // Bottom wall-plate
      this.createTransformedBox(plinthW, 0.16, wallThick + 0.02, 0, wallH - 0.08, rearZ), // Top wall-plate
      this.createTransformedBox(0.14, wallH, wallThick + 0.02, -plinthW / 2 + 0.07, wallH / 2, rearZ),
      this.createTransformedBox(0.14, wallH, wallThick + 0.02, 0.4, wallH / 2, rearZ),
      this.createTransformedBox(0.14, wallH, wallThick + 0.02, plinthW / 2 - 0.07, wallH / 2, rearZ),
      // Diagonal knee braces
      this.createTransformedBox(0.10, 1.2, wallThick + 0.02, -0.3, 2.2, rearZ, 0, 0, Math.PI / 4),
      // Left wall studs
      this.createTransformedBox(wallThick + 0.02, 0.14, plinthD, -plinthW / 2 + wallThick / 2, 0.07, 0),
      this.createTransformedBox(wallThick + 0.02, 0.16, plinthD, -plinthW / 2 + wallThick / 2, wallH - 0.08, 0),
      this.createTransformedBox(wallThick + 0.02, wallH, 0.14, -plinthW / 2 + wallThick / 2, wallH / 2, -1.0),
      this.createTransformedBox(wallThick + 0.02, wallH, 0.14, -plinthW / 2 + wallThick / 2, wallH / 2, 1.0),
      // Massive ceiling timber cross-beams
      this.createTransformedBox(plinthW, 0.22, 0.18, 0, wallH - 0.11, -1.8),
      this.createTransformedBox(plinthW, 0.22, 0.18, 0, wallH - 0.11, 0),
      this.createTransformedBox(plinthW, 0.22, 0.18, 0, wallH - 0.11, 1.8),
      // Window mullions (Diamond Tudor pattern)
      this.createTransformedBox(0.03, winH, 0.04, winX, 1.1 + winH / 2, rearZ + 0.02),
      this.createTransformedBox(winW, 0.03, 0.04, winX, 1.1 + winH * 0.5, rearZ + 0.02)
    ];
    const woodMesh = new THREE.Mesh(this.mergeGeometries(woodGeos), woodMat || this.getMat('wood.dark_oak'));
    woodMesh.receiveShadow = true;
    woodMesh.castShadow = true;
    shellGroup.add(woodMesh);

    // 2. COMPOUNDED WARM LIME PLASTER NOGGING WALLS (1 Merged Draw Call)
    const plasterGeos = [
      // Left Wall Plaster
      this.createTransformedBox(wallThick, wallH - 0.2, plinthD - 0.1, -plinthW / 2 + wallThick / 2, wallH / 2, 0),
      // Back Wall Plaster around window
      this.createTransformedBox(plinthW / 2 + winX - winW / 2, wallH - 0.2, wallThick, (-plinthW / 2 + (winX - winW / 2)) / 2, wallH / 2, rearZ),
      this.createTransformedBox(plinthW / 2 - (winX + winW / 2), wallH - 0.2, wallThick, (plinthW / 2 + (winX + winW / 2)) / 2, wallH / 2, rearZ),
      this.createTransformedBox(winW, 1.1, wallThick, winX, 0.55, rearZ),
      this.createTransformedBox(winW, wallH - 1.1 - winH, wallThick, winX, 1.1 + winH + (wallH - 1.1 - winH) / 2, rearZ),
      // Right Wall Return Plaster behind fireplace
      this.createTransformedBox(wallThick, wallH, 2.8, plinthW / 2 - wallThick / 2, wallH / 2, rearZ + 1.4)
    ];
    const plasterMesh = new THREE.Mesh(this.mergeGeometries(plasterGeos), plasterMat || this.getMat('plaster.lime_warm'));
    plasterMesh.receiveShadow = true;
    shellGroup.add(plasterMesh);

    // 3. WINDOW GLASS (1 Draw Call)
    const glassMesh = new THREE.Mesh(
      new THREE.BoxGeometry(winW, winH, 0.02),
      glassMat || this.getMat('glass.window')
    );
    glassMesh.position.set(winX, 1.1 + winH / 2, rearZ);
    shellGroup.add(glassMesh);

    // 4. PANORAMIC MEDIEVAL VILLAGE SUNSET VISTA (1 Draw Call)
    const skylineGeo = new THREE.CylinderGeometry(5.0, 5.0, 4.8, 36, 1, true, Math.PI * 0.45, Math.PI * 1.10);
    skylineGeo.scale(-1, 1, 1);
    const skylineMesh = new THREE.Mesh(skylineGeo, skylineMat || this.getMat('skyline.village_sunset'));
    skylineMesh.position.set(0, 2.0, -0.6);
    shellGroup.add(skylineMesh);



    group.add(shellGroup);
  }

  buildArcaneEnchanter(group, stoneMat, carvedMat, soulGemMat, cyanGemMat, ironMat, brassMat, witchlightMat, pageMat, boneMat, hornMat, waxMat, emberMat) {
    const ivoryMat = boneMat || carvedMat;
    const darkHornMat = hornMat || ironMat;
    const candleWaxMat = waxMat || carvedMat;
    const fireMat = emberMat || witchlightMat;

    // 1. STEPPED NORDIC STONE ALTAR TABLE (Compounded into Stone & Carved 2 Draw Calls)
    const altarStoneGeos = [
      this.createTransformedBox(0.24, 0.52, 0.72, -0.68, 0.52, 0), // Leg Shaft L
      this.createTransformedBox(0.24, 0.52, 0.72, 0.68, 0.52, 0),  // Leg Shaft R
      this.createTransformedBox(1.92, 0.14, 0.98, 0, 0.93, 0)      // Tabletop slab
    ];
    const stoneMesh = new THREE.Mesh(this.mergeGeometries(altarStoneGeos), stoneMat);
    stoneMesh.castShadow = true;
    stoneMesh.receiveShadow = true;
    group.add(stoneMesh);

    const altarCarvedGeos = [
      this.createTransformedBox(2.0, 0.12, 1.05, 0, 0.06, 0),       // Sub-base
      this.createTransformedBox(0.32, 0.14, 0.82, -0.68, 0.19, 0), // Leg base L
      this.createTransformedBox(0.32, 0.14, 0.82, 0.68, 0.19, 0),  // Leg base R
      this.createTransformedBox(0.32, 0.08, 0.82, -0.68, 0.82, 0), // Leg cap L
      this.createTransformedBox(0.32, 0.08, 0.82, 0.68, 0.82, 0),  // Leg cap R
      this.createTransformedBox(1.98, 0.04, 1.04, 0, 0.99, 0),      // Carved border trim
      this.createTransformedCylinder(0.24, 0.26, 0.04, 16, 0, 1.01, -0.22), // Skull Dais
      this.createTransformedCylinder(0.07, 0.08, 0.025, 12, 0.34, 1.022, 0.18) // Velvet cushion for cyan gem
    ];

    // Grimoire leather covers
    const bookX = -0.38, bookY = 1.01, bookZ = 0.12, bookRotY = 0.28;
    const bookMatrix = new THREE.Matrix4().makeRotationY(bookRotY).setPosition(bookX, bookY, bookZ);
    
    const coverLGeo = new THREE.BoxGeometry(0.24, 0.016, 0.34);
    coverLGeo.rotateZ(0.10);
    coverLGeo.translate(-0.12, 0.01, 0);
    coverLGeo.applyMatrix4(bookMatrix);
    altarCarvedGeos.push(coverLGeo);

    const coverRGeo = new THREE.BoxGeometry(0.24, 0.016, 0.34);
    coverRGeo.rotateZ(-0.10);
    coverRGeo.translate(0.12, 0.01, 0);
    coverRGeo.applyMatrix4(bookMatrix);
    altarCarvedGeos.push(coverRGeo);

    const carvedMesh = new THREE.Mesh(this.mergeGeometries(altarCarvedGeos), carvedMat);
    carvedMesh.castShadow = true;
    carvedMesh.receiveShadow = true;
    group.add(carvedMesh);

    // 2. BRASS FOCUS RINGS & CLAW PEDESTAL (Compounded 1 Draw Call)
    const brassGeos = [];
    const runeRingGeo = new THREE.RingGeometry(0.25, 0.32, 28);
    runeRingGeo.rotateX(-Math.PI / 2);
    runeRingGeo.translate(0, 1.011, -0.22);
    brassGeos.push(runeRingGeo);

    // Claw pedestal at (0.42, 1.01, -0.10)
    const clawBaseX = 0.42, clawBaseY = 1.01, clawBaseZ = -0.10;
    brassGeos.push(this.createTransformedCylinder(0.09, 0.10, 0.05, 12, clawBaseX, clawBaseY + 0.025, clawBaseZ));
    for (let c = 0; c < 3; c++) {
      const ca = (c / 3) * Math.PI * 2;
      brassGeos.push(this.createTransformedCylinder(0.007, 0.012, 0.14, 8,
        clawBaseX + Math.cos(ca) * 0.065, clawBaseY + 0.09, clawBaseZ + Math.sin(ca) * 0.065,
        Math.sin(ca) * -0.28, 0, Math.cos(ca) * 0.28
      ));
      const tipGeo = new THREE.ConeGeometry(0.006, 0.022, 6);
      const tipRot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.sin(ca) * 0.45, 0, Math.cos(ca) * -0.45));
      tipGeo.applyMatrix4(tipRot);
      tipGeo.translate(clawBaseX + Math.cos(ca) * 0.052, clawBaseY + 0.165, clawBaseZ + Math.sin(ca) * 0.052);
      brassGeos.push(tipGeo);
    }
    group.add(new THREE.Mesh(this.mergeGeometries(brassGeos), brassMat));

    // Inner glowing cyan channel on table
    const glowRing = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.23, 28), witchlightMat);
    glowRing.rotation.x = -Math.PI / 2;
    glowRing.position.set(0, 1.012, -0.22);
    group.add(glowRing);

    // 3. ARTISAN ANATOMICAL DAEDRIC / BEAST SKULL (Compounded into Ivory Bones, Sweeping Horns, Carved Voids, & Soul Flames)
    const skull = new THREE.Group();
    skull.position.set(0, 1.05, -0.15);
    skull.scale.set(1.4, 1.4, 1.4);
    skull.rotation.x = 0.12;

    const ivoryGeos = [];

    // Braincase & Crest
    const brainGeo = new THREE.DodecahedronGeometry(0.082, 1);
    brainGeo.scale(0.96, 0.74, 1.18);
    brainGeo.translate(0, 0.075, -0.04);
    ivoryGeos.push(brainGeo);

    ivoryGeos.push(this.createTransformedBox(0.014, 0.024, 0.14, 0, 0.13, -0.03, -0.15, 0, 0)); // Crest
    ivoryGeos.push(this.createTransformedBox(0.058, 0.022, 0.042, -0.046, 0.078, 0.045, 0.12, -0.18, 0.14)); // Brow L
    ivoryGeos.push(this.createTransformedBox(0.058, 0.022, 0.042, 0.046, 0.078, 0.045, 0.12, 0.18, -0.14));  // Brow R
    ivoryGeos.push(this.createTransformedBox(0.048, 0.026, 0.12, 0, 0.038, 0.07, 0.20, 0, 0)); // Snout bridge
    ivoryGeos.push(this.createTransformedBox(0.038, 0.022, 0.04, 0, 0.022, 0.135)); // Snout tip

    // Zygomatic arches
    for (const cheekDir of [-1, 1]) {
      ivoryGeos.push(this.createTransformedBox(0.014, 0.02, 0.085, cheekDir * 0.076, 0.042, 0.015, 0.12, cheekDir * 0.32, cheekDir * -0.15));
    }

    // Maxilla & Beast Fangs
    ivoryGeos.push(this.createTransformedBox(0.076, 0.028, 0.08, 0, -0.005, 0.085));
    const teethOffsets = [-0.03, -0.018, -0.006, 0.006, 0.018, 0.03];
    for (let t = 0; t < teethOffsets.length; t++) {
      const isCanine = t === 0 || t === teethOffsets.length - 1;
      const toothH = isCanine ? 0.028 : 0.018;
      const toothW = isCanine ? 0.007 : 0.005;
      const toothGeo = new THREE.ConeGeometry(toothW, toothH, 4);
      toothGeo.rotateX(Math.PI - 0.2);
      toothGeo.translate(teethOffsets[t], -0.022, 0.125 - Math.abs(teethOffsets[t]) * 0.5);
      ivoryGeos.push(toothGeo);
    }
    const skullBoneMesh = new THREE.Mesh(this.mergeGeometries(ivoryGeos), ivoryMat);
    skullBoneMesh.castShadow = true;
    skull.add(skullBoneMesh);

    // Carved eye orbits & nostrils
    const skullCarvedGeos = [];
    const eyeFlamesGeos = [];
    for (const eyeDir of [-1, 1]) {
      skullCarvedGeos.push(this.createTransformedCylinder(0.022, 0.014, 0.032, 8, eyeDir * 0.044, 0.048, 0.052, 0.28, eyeDir * -0.22, 0));
      const flameGeo = new THREE.SphereGeometry(0.012, 8, 8);
      flameGeo.translate(eyeDir * 0.044, 0.048, 0.062);
      eyeFlamesGeos.push(flameGeo);

      const nostrilGeo = new THREE.ConeGeometry(0.007, 0.024, 3);
      const nRot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.4, 0, Math.PI));
      nostrilGeo.applyMatrix4(nRot);
      nostrilGeo.translate(eyeDir * 0.009, 0.018, 0.145);
      skullCarvedGeos.push(nostrilGeo);
    }
    skull.add(new THREE.Mesh(this.mergeGeometries(skullCarvedGeos), carvedMat));
    skull.add(new THREE.Mesh(this.mergeGeometries(eyeFlamesGeos), witchlightMat));

    // Sweeping Horns (Compounded 28 horn segments into 1 Mesh!)
    const hornGeos = [];
    for (const dir of [-1, 1]) {
      const segData = [
        { r1: 0.038, r2: 0.033, len: 0.044, rx: 0.28, ry: dir * 0.44, rz: dir * 0.26 },
        { r1: 0.033, r2: 0.028, len: 0.044, rx: 0.40, ry: dir * 0.40, rz: dir * 0.38 },
        { r1: 0.028, r2: 0.024, len: 0.044, rx: 0.50, ry: dir * 0.30, rz: dir * 0.46 },
        { r1: 0.024, r2: 0.020, len: 0.044, rx: 0.54, ry: dir * 0.12, rz: dir * 0.50 },
        { r1: 0.020, r2: 0.016, len: 0.044, rx: 0.46, ry: dir * -0.16, rz: dir * 0.44 },
        { r1: 0.016, r2: 0.012, len: 0.044, rx: 0.34, ry: dir * -0.32, rz: dir * 0.32 },
        { r1: 0.012, r2: 0.002, len: 0.054, rx: 0.22, ry: dir * -0.42, rz: dir * 0.20 }
      ];

      let parentMatrix = new THREE.Matrix4().makeTranslation(dir * 0.072, 0.098, -0.01);
      for (let s = 0; s < segData.length; s++) {
        const d = segData[s];
        const localMatrix = new THREE.Matrix4();
        const pos = new THREE.Vector3(0, s === 0 ? 0 : segData[s - 1].len * 0.85, 0);
        const rot = new THREE.Euler(d.rx, d.ry, d.rz);
        const q = new THREE.Quaternion().setFromEuler(rot);
        localMatrix.compose(pos, q, new THREE.Vector3(1, 1, 1));
        parentMatrix = parentMatrix.clone().multiply(localMatrix);

        const segGeo = new THREE.CylinderGeometry(d.r2, d.r1, d.len, 10);
        segGeo.translate(0, d.len / 2, 0);
        segGeo.applyMatrix4(parentMatrix);
        hornGeos.push(segGeo);

        const ringGeo = new THREE.TorusGeometry(d.r1 + 0.004, 0.0035, 6, 12);
        ringGeo.rotateX(Math.PI / 2);
        ringGeo.applyMatrix4(parentMatrix);
        hornGeos.push(ringGeo);
      }
    }
    const hornMesh = new THREE.Mesh(this.mergeGeometries(hornGeos), darkHornMat);
    hornMesh.castShadow = true;
    skull.add(hornMesh);

    group.add(skull);

    // 4. FACETED GRAND SOUL GEM (Compounded 1 Draw Call)
    const gemGroup = new THREE.Group();
    gemGroup.position.set(0.42, 1.01, -0.10);

    const gemClusterGeos = [];
    const gemPrismGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.15, 6);
    gemClusterGeos.push(gemPrismGeo);

    const gemTopGeo = new THREE.ConeGeometry(0.055, 0.075, 6);
    gemTopGeo.translate(0, 0.112, 0);
    gemClusterGeos.push(gemTopGeo);

    const gemBottomGeo = new THREE.ConeGeometry(0.055, 0.075, 6);
    gemBottomGeo.rotateX(Math.PI);
    gemBottomGeo.translate(0, -0.112, 0);
    gemClusterGeos.push(gemBottomGeo);

    const gemClusterMesh = new THREE.Mesh(this.mergeGeometries(gemClusterGeos), soulGemMat);
    gemClusterMesh.position.y = 0.18;
    gemClusterMesh.rotation.set(0.2, 0.4, 0.15);
    gemGroup.add(gemClusterMesh);

    const gemCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xc084fc, emissiveIntensity: 4.5 })
    );
    gemCore.position.y = 0.18;
    gemGroup.add(gemCore);



    group.add(gemGroup);

    // 5. SECONDARY CYAN SOUL GEM
    const cyanGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), cyanGemMat);
    cyanGem.position.set(0.34, 1.01 + 0.055, 0.18);
    cyanGem.rotation.set(0.25, 0.7, 0.15);
    group.add(cyanGem);

    // 6. CLUSTER OF RITUAL CANDLES (Compounded 3 Draw Calls)
    const candleWaxGeos = [];
    const candleWickGeos = [];
    const candleFlameGeos = [];
    const candleConfigs = [
      { x: 0.72, z: 0.15, h: 0.16, r: 0.02 },
      { x: 0.77, z: 0.19, h: 0.11, r: 0.018 },
      { x: 0.68, z: 0.18, h: 0.065, r: 0.017 }
    ];
    for (const c of candleConfigs) {
      candleWaxGeos.push(this.createTransformedCylinder(c.r * 2.2, c.r * 2.6, 0.008, 10, c.x, 1.01 + 0.004, c.z));
      candleWaxGeos.push(this.createTransformedCylinder(c.r, c.r, c.h, 10, c.x, 1.01 + c.h / 2, c.z));

      const drip = new THREE.SphereGeometry(c.r * 0.45, 6, 6);
      drip.scale(0.8, 1.6, 0.8);
      drip.translate(c.x + c.r * 0.85, 1.01 + c.h * 0.65, c.z);
      candleWaxGeos.push(drip);

      candleWickGeos.push(this.createTransformedCylinder(0.0015, 0.0015, 0.015, 4, c.x, 1.01 + c.h + 0.007, c.z));

      const flame = new THREE.ConeGeometry(0.012, 0.032, 8);
      flame.translate(c.x, 1.01 + c.h + 0.024, c.z);
      candleFlameGeos.push(flame);
    }
    const candleWaxMesh = new THREE.Mesh(this.mergeGeometries(candleWaxGeos), candleWaxMat);
    candleWaxMesh.castShadow = true;
    group.add(candleWaxMesh);

    group.add(new THREE.Mesh(this.mergeGeometries(candleWickGeos), ironMat));
    group.add(new THREE.Mesh(this.mergeGeometries(candleFlameGeos), fireMat));



    // 7. OPEN ILLUMINATED GRIMOIRE (Compounded 1 Draw Call for pages + ribbon)
    const pageGeos = [];
    const pageLGeo = new THREE.PlaneGeometry(0.22, 0.32);
    pageLGeo.rotateX(-Math.PI / 2);
    pageLGeo.rotateZ(0.10);
    pageLGeo.translate(-0.11, 0.022, 0);
    pageLGeo.applyMatrix4(bookMatrix);
    pageGeos.push(pageLGeo);

    const pageRGeo = new THREE.PlaneGeometry(0.22, 0.32);
    pageRGeo.rotateX(-Math.PI / 2);
    pageRGeo.rotateZ(-0.10);
    pageRGeo.translate(0.11, 0.022, 0);
    pageRGeo.applyMatrix4(bookMatrix);
    pageGeos.push(pageRGeo);

    group.add(new THREE.Mesh(this.mergeGeometries(pageGeos), pageMat));

    const ribbonGeo = new THREE.BoxGeometry(0.022, 0.002, 0.14);
    ribbonGeo.rotateX(0.35);
    ribbonGeo.translate(0.04, 0.025, 0.20);
    ribbonGeo.applyMatrix4(bookMatrix);
    group.add(new THREE.Mesh(ribbonGeo, witchlightMat));

    // 8. ALCHEMICAL ALEMBIC & FLASK (Compounded 1 Draw Call)
    const alembicGeos = [];
    const alembicX = -0.68, alembicY = 1.01, alembicZ = -0.18;

    const retortGeo = new THREE.SphereGeometry(0.07, 12, 12);
    retortGeo.translate(alembicX, alembicY + 0.07, alembicZ);
    alembicGeos.push(retortGeo);

    const swanGeo = new THREE.TorusGeometry(0.065, 0.01, 8, 16, Math.PI * 0.75);
    swanGeo.rotateZ(-0.3);
    swanGeo.translate(alembicX + 0.065, alembicY + 0.11, alembicZ);
    alembicGeos.push(swanGeo);

    const phialGeo = new THREE.CylinderGeometry(0.022, 0.028, 0.09, 10);
    phialGeo.translate(alembicX + 0.13, alembicY + 0.045, alembicZ);
    alembicGeos.push(phialGeo);

    group.add(new THREE.Mesh(this.mergeGeometries(alembicGeos), cyanGemMat));
  }

  buildArcanaeumBookshelf(group, woodMat, ironMat, navyMat, crimsonMat, pageMat, cyanGemMat) {
    const shardMat = cyanGemMat || this.materials.get('crystal.soul_gem_cyan');
    const w = 1.6;
    const h = 2.5;
    const d = 0.44;

    // 1. Dark Nordic Oak Bookshelf Frame & Shelves (Merged 1 Draw Call)
    const woodGeos = [
      this.createTransformedBox(0.06, h, d, -w / 2, h / 2, 0),
      this.createTransformedBox(0.06, h, d, w / 2, h / 2, 0),
      this.createTransformedBox(w, h, 0.03, 0, h / 2, -d / 2 + 0.015)
    ];

    const shelfHeights = [0.1, 0.7, 1.3, 1.9, h];
    for (const sh of shelfHeights) {
      woodGeos.push(this.createTransformedBox(w - 0.02, 0.04, d - 0.02, 0, sh, 0));
    }
    const woodMesh = new THREE.Mesh(this.mergeGeometries(woodGeos), woodMat);
    woodMesh.castShadow = true;
    group.add(woodMesh);

    // 2. Wrought-iron corner reinforcements (Merged 1 Draw Call)
    const bracketGeos = [];
    for (let cy of [0.05, h - 0.05]) {
      for (let cx of [-w / 2, w / 2]) {
        bracketGeos.push(this.createTransformedBox(0.08, 0.08, 0.08, cx, cy, d / 2));
      }
    }
    group.add(new THREE.Mesh(this.mergeGeometries(bracketGeos), ironMat));

    // 3. Ancient Grimoires, grouped by material (3 Draw Calls for 90+ books!)
    const navyBookGeos = [];
    const crimsonBookGeos = [];
    const woodBookGeos = [];

    for (let s = 0; s < 3; s++) {
      const baseY = shelfHeights[s] + 0.02;
      let curX = -w / 2 + 0.12;

      while (curX < w / 2 - 0.18) {
        const isLeaning = s === 1 && curX > 0.35 && curX < 0.55;
        const bookThick = 0.038 + ((curX * 17) % 0.025);
        const bookH = 0.27 + ((curX * 31) % 0.07);
        const bookD = 0.26;
        const matChoice = Math.abs(Math.floor(curX * 10)) % 3;

        let bGeo;
        if (isLeaning) {
          bGeo = this.createTransformedBox(bookThick, bookH, bookD, curX + bookThick / 2, baseY + bookH / 2 - 0.02, 0.02, 0, 0, -0.22);
        } else {
          bGeo = this.createTransformedBox(bookThick, bookH, bookD, curX + bookThick / 2, baseY + bookH / 2, 0.02);
        }

        if (matChoice === 0) navyBookGeos.push(bGeo);
        else if (matChoice === 1) crimsonBookGeos.push(bGeo);
        else woodBookGeos.push(bGeo);

        curX += bookThick + 0.010;
      }
    }

    if (navyBookGeos.length > 0) {
      const navyBooks = new THREE.Mesh(this.mergeGeometries(navyBookGeos), navyMat);
      navyBooks.castShadow = true;
      group.add(navyBooks);
    }
    if (crimsonBookGeos.length > 0) {
      const crimsonBooks = new THREE.Mesh(this.mergeGeometries(crimsonBookGeos), crimsonMat);
      crimsonBooks.castShadow = true;
      group.add(crimsonBooks);
    }
    if (woodBookGeos.length > 0) {
      const woodBooks = new THREE.Mesh(this.mergeGeometries(woodBookGeos), woodMat);
      woodBooks.castShadow = true;
      group.add(woodBooks);
    }

    // 4. Soul Gem Crystal Bookend
    const soulShard = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), shardMat);
    soulShard.position.set(0.52, shelfHeights[1] + 0.06, 0.08);
    soulShard.rotation.set(0.3, 0.5, 0.2);
    group.add(soulShard);

    // 5. Parchment Scrolls & Wax Seals (Merged 2 Draw Calls)
    const scrollGeos = [];
    const sealGeos = [];
    for (let sc = 0; sc < 6; sc++) {
      scrollGeos.push(this.createTransformedCylinder(0.022, 0.022, 0.26, 8, -0.45 + sc * 0.075, shelfHeights[3] + 0.03, 0, Math.PI / 2, 0, 0));
      sealGeos.push(this.createTransformedCylinder(0.008, 0.008, 0.006, 8, -0.45 + sc * 0.075, shelfHeights[3] + 0.045, 0));
    }
    const scrollsMesh = new THREE.Mesh(this.mergeGeometries(scrollGeos), pageMat);
    scrollsMesh.castShadow = true;
    group.add(scrollsMesh);
    group.add(new THREE.Mesh(this.mergeGeometries(sealGeos), crimsonMat));
  }

  buildArmillarySphere(group, stoneMat, brassMat, cyanGemMat) {
    // 1. Carved stone pedestal with stepped profile (Merged 1 Draw Call)
    const stoneGeos = [
      this.createTransformedCylinder(0.28, 0.32, 0.12, 16, 0, 0.06, 0),
      this.createTransformedCylinder(0.22, 0.26, 0.75, 16, 0, 0.495, 0),
      this.createTransformedCylinder(0.29, 0.21, 0.09, 16, 0, 0.915, 0)
    ];
    const stoneMesh = new THREE.Mesh(this.mergeGeometries(stoneGeos), stoneMat);
    stoneMesh.castShadow = true;
    stoneMesh.receiveShadow = true;
    group.add(stoneMesh);

    // 2. Brass Dial, Gimbal Rings & Pivot Pins (Merged 1 Draw Call)
    const orreryGroup = new THREE.Group();
    orreryGroup.position.y = 1.38;

    const dialBaseGeo = this.createTransformedCylinder(0.24, 0.25, 0.03, 20, 0, -0.405, 0);

    const mGeo = new THREE.TorusGeometry(0.40, 0.016, 8, 24, Math.PI);
    mGeo.rotateZ(-Math.PI / 2);
    mGeo.translate(0, -0.02, 0);

    const r1Geo = new THREE.TorusGeometry(0.36, 0.016, 8, 20);
    r1Geo.rotateX(0.42);

    const r2Geo = new THREE.TorusGeometry(0.28, 0.014, 8, 20);
    r2Geo.rotateY(0.65);
    r2Geo.rotateZ(0.28);

    const r3Geo = new THREE.TorusGeometry(0.20, 0.012, 8, 20);
    r3Geo.rotateX(-0.45);
    r3Geo.rotateY(-0.35);

    const brassGeos = [dialBaseGeo, mGeo, r1Geo, r2Geo, r3Geo];
    for (let p = 0; p < 4; p++) {
      const pa = (p / 4) * Math.PI * 2;
      const pinGeo = new THREE.SphereGeometry(0.016, 8, 6);
      pinGeo.translate(Math.cos(pa) * 0.36, 0, Math.sin(pa) * 0.36);
      brassGeos.push(pinGeo);
    }
    const brassMesh = new THREE.Mesh(this.mergeGeometries(brassGeos), brassMat);
    brassMesh.castShadow = true;
    orreryGroup.add(brassMesh);

    // 3. Core Floating Mystical Cyan Soul Core
    const coreCrystal = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 0), cyanGemMat);
    orreryGroup.add(coreCrystal);



    group.add(orreryGroup);
  }

  buildWinterholdBrazier(group, ironMat, witchlightMat, emberMat) {
    const fireMat = witchlightMat || this.materials.get('magic.witchlight_blue');
    const coalsMat = emberMat || this.materials.get('ember');

    // 1. Heavy Tripod Forged Iron Legs, Claw Feet & Fire Bowl (Merged 1 Draw Call)
    const ironGeos = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const legGeo = new THREE.CylinderGeometry(0.018, 0.022, 0.92, 8);
      const rotM = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.sin(a) * 0.24, 0, Math.cos(a) * -0.24));
      legGeo.applyMatrix4(rotM);
      legGeo.translate(Math.cos(a) * 0.22, 0.44, Math.sin(a) * 0.22);
      ironGeos.push(legGeo);

      const footGeo = new THREE.TorusGeometry(0.045, 0.014, 6, 10, Math.PI * 0.6);
      footGeo.rotateX(Math.PI / 2);
      footGeo.rotateY(-a + Math.PI / 2);
      footGeo.translate(Math.cos(a) * 0.32, 0.03, Math.sin(a) * 0.32);
      ironGeos.push(footGeo);
    }

    const braceRingGeo = new THREE.TorusGeometry(0.19, 0.012, 6, 16);
    braceRingGeo.rotateX(Math.PI / 2);
    braceRingGeo.translate(0, 0.46, 0);
    ironGeos.push(braceRingGeo);

    const bowlGeo = new THREE.CylinderGeometry(0.38, 0.20, 0.26, 12);
    bowlGeo.translate(0, 0.84, 0);
    ironGeos.push(bowlGeo);

    const bowlRimGeo = new THREE.TorusGeometry(0.38, 0.022, 8, 18);
    bowlRimGeo.rotateX(Math.PI / 2);
    bowlRimGeo.translate(0, 0.97, 0);
    ironGeos.push(bowlRimGeo);

    const ironMesh = new THREE.Mesh(this.mergeGeometries(ironGeos), ironMat);
    ironMesh.castShadow = true;
    group.add(ironMesh);

    // 2. Glowing Charcoal Bed & Ember Chunks (Merged 1 Draw Call)
    const coalGeos = [
      this.createTransformedCylinder(0.33, 0.22, 0.06, 10, 0, 0.94, 0)
    ];
    for (let c = 0; c < 5; c++) {
      const ca = (c / 5) * Math.PI * 2 + 0.3;
      const cr = 0.12 + (c % 3) * 0.07;
      const emberGeo = new THREE.DodecahedronGeometry(0.035, 0);
      emberGeo.rotateX(c * 0.8);
      emberGeo.rotateY(c * 1.2);
      emberGeo.translate(Math.cos(ca) * cr, 0.97, Math.sin(ca) * cr);
      coalGeos.push(emberGeo);
    }
    group.add(new THREE.Mesh(this.mergeGeometries(coalGeos), coalsMat));

    // 3. Swirling Multi-Petal Witchlight Flame (Merged 1 Draw Call)
    const fireGeos = [
      this.createTransformedCylinder(0, 0.11, 0.46, 8, 0, 1.16, 0, 0.08, 0.2, -0.06)
    ];
    const flameOffsets = [
      { r: 0.10, a: 0.2, h: 0.36, w: 0.08, rx: 0.18, rz: 0.14 },
      { r: 0.11, a: 2.3, h: 0.32, w: 0.07, rx: -0.16, rz: 0.18 },
      { r: 0.09, a: 4.4, h: 0.38, w: 0.075, rx: 0.12, rz: -0.20 }
    ];
    for (const f of flameOffsets) {
      const tongueGeo = new THREE.ConeGeometry(f.w, f.h, 6);
      const rotM = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(f.rx, f.a, f.rz));
      tongueGeo.applyMatrix4(rotM);
      tongueGeo.translate(Math.cos(f.a) * f.r, 1.08, Math.sin(f.a) * f.r);
      fireGeos.push(tongueGeo);
    }
    const coreGeo = new THREE.SphereGeometry(0.065, 8, 8);
    coreGeo.translate(0, 1.05, 0);
    fireGeos.push(coreGeo);
    group.add(new THREE.Mesh(this.mergeGeometries(fireGeos), fireMat));


  }

  buildSpellLectern(group, stoneMat, brassMat, navyMat, pageMat, cyanGemMat) {
    // Carved Stone Pedestal & Angled Desk (Merged 1 Draw Call)
    const stoneGeos = [
      this.createTransformedBox(0.42, 0.95, 0.42, 0, 0.475, 0),
      this.createTransformedBox(0.65, 0.06, 0.52, 0, 1.02, 0, 0.35, 0, 0)
    ];
    const stoneMesh = new THREE.Mesh(this.mergeGeometries(stoneGeos), stoneMat);
    stoneMesh.castShadow = true;
    group.add(stoneMesh);

    // Open ancient spell tome
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.02, 0.36), navyMat);
    book.position.set(0, 1.05, 0);
    book.rotation.x = 0.35;
    group.add(book);

    const page = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.32), pageMat);
    page.position.set(0, 1.07, 0);
    page.rotation.x = -Math.PI / 2 + 0.35;
    group.add(page);

    // Floating cyan soul shard marker
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.03, 0), cyanGemMat);
    shard.position.set(0.16, 1.15, -0.05);
    group.add(shard);
  }
}

