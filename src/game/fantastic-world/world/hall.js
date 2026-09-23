// world/hall.js — The Fantastic Hall. A great candlelit library room:
// wood-plank floor, wainscot walls, floor-to-beam bookshelves, a circular
// moon-window with a cushioned seat (south), and an arched doorway to the
// dream garden (north).
import * as THREE from 'three';
import { ctx } from '../core/ctx.js';
import { P } from '../core/palette.js';

export const HALL = { w: 24, d: 23, h: 8.6 };  // x span, z span, height
export const NOOK = { x: 8.5, z: 8.5 };        // rainbow reading nook (SE corner)
const HW = HALL.w / 2, HD = HALL.d / 2;

// ── procedural wood floor texture ───────────────────────────────────────────
function woodTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#5d4128'; g.fillRect(0, 0, 512, 512);
  const plankH = 64;
  for (let row = 0; row < 8; row++) {
    const y = row * plankH;
    const off = (row % 2) * 128;
    g.fillStyle = `hsl(${26 + (row % 3) * 3}, ${38 + (row % 2) * 6}%, ${24 + (row % 4) * 2.5}%)`;
    g.fillRect(0, y, 512, plankH - 2);
    // grain
    g.strokeStyle = 'rgba(30,18,8,0.35)'; g.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      const gy = y + 6 + i * 6.5 + Math.sin(row * 7 + i) * 2;
      g.moveTo(0, gy);
      for (let x = 0; x <= 512; x += 32) g.lineTo(x, gy + Math.sin((x + row * 91) * 0.02 + i) * 2.4);
      g.stroke();
    }
    // plank seams
    g.fillStyle = 'rgba(20,10,4,0.55)';
    for (let sx = off; sx < 512; sx += 256) g.fillRect(sx, y, 3, plankH);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, y + plankH - 2, 512, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ── wall builder with rectangular holes (window / door) ─────────────────────
function wallWithHole(w, h, hole) {
  // hole: {x, y, w, h} in wall-local coords (centre-origin) or null
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(w / 2, h); shape.lineTo(-w / 2, h); shape.closePath();
  if (hole) {
    const p = new THREE.Path();
    if (hole.round) {
      p.absarc(hole.x, hole.y, hole.r, 0, Math.PI * 2, true);
    } else {
      const hw = hole.w / 2;
      p.moveTo(hole.x - hw, hole.y); p.lineTo(hole.x + hw, hole.y);
      p.lineTo(hole.x + hw, hole.y + hole.h - hw); // arch spring
      p.absarc(hole.x, hole.y + hole.h - hw, hw, 0, Math.PI, false);
      p.lineTo(hole.x - hw, hole.y);
    }
    shape.holes.push(p);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false });
  return geo;
}

export function createHall() {
  const hall = new THREE.Group();
  hall.name = 'FantasticHall';

  const woodMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTexture(), roughness: 0.82 });
  const plasterMat = new THREE.MeshStandardMaterial({ color: P.plaster, roughness: 0.95 });
  const darkWoodMat = new THREE.MeshStandardMaterial({ color: P.woodDark, roughness: 0.8 });
  const trimMat = new THREE.MeshStandardMaterial({ color: P.wood, roughness: 0.75 });

  // floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALL.w, HALL.d), woodMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  hall.add(floor);

  // ceiling + beams
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALL.w, HALL.d),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = HALL.h;
  hall.add(ceil);
  const beamGeo = new THREE.BoxGeometry(0.42, 0.5, HALL.d);
  for (let i = -2; i <= 2; i++) {
    const beam = new THREE.Mesh(beamGeo, darkWoodMat);
    beam.position.set(i * 4.6, HALL.h - 0.25, 0);
    hall.add(beam);
  }

  // ── walls ──
  // south (z=+HD): circular moon window, centre y 3.4, r 2.2
  const south = new THREE.Mesh(
    wallWithHole(HALL.w, HALL.h, { round: true, x: 0, y: 3.4, r: 2.2 }), plasterMat);
  south.rotation.y = Math.PI; south.position.set(0, 0, HD + 0.35);
  hall.add(south);

  // north (z=-HD): arched doorway w 3.2 h 4.6
  const north = new THREE.Mesh(
    wallWithHole(HALL.w, HALL.h, { x: 0, y: 0, w: 3.2, h: 4.6 }), plasterMat);
  north.position.set(0, 0, -HD - 0.35);
  hall.add(north);

  // east/west: solid (bookshelves cover them)
  const sideGeo = wallWithHole(HALL.d, HALL.h, null);
  const east = new THREE.Mesh(sideGeo, plasterMat);
  east.rotation.y = -Math.PI / 2; east.position.set(HW + 0.35, 0, 0);
  hall.add(east);
  const west = new THREE.Mesh(sideGeo, plasterMat);
  west.rotation.y = Math.PI / 2; west.position.set(-HW - 0.35, 0, 0);
  hall.add(west);

  // wainscot: full band on south; north band splits around the arched doorway
  const wainS = new THREE.Mesh(new THREE.BoxGeometry(HALL.w, 1.5, 0.08), trimMat);
  wainS.position.set(0, 0.75, HD - 0.02);
  hall.add(wainS);
  const segW = HALL.w / 2 - ctx.doorway.halfW;
  for (const s of [-1, 1]) {
    const wainN = new THREE.Mesh(new THREE.BoxGeometry(segW, 1.5, 0.08), trimMat);
    wainN.position.set(s * (ctx.doorway.halfW + segW / 2), 0.75, -HD + 0.02);
    hall.add(wainN);
  }

  // moon-window frame (brass ring) + seat
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.13, 12, 48),
    new THREE.MeshStandardMaterial({ color: P.brass, roughness: 0.35, metalness: 0.7 }));
  ring.position.set(0, 3.4, HD - 0.02);
  hall.add(ring);
  const ring2 = ring.clone(); ring2.scale.setScalar(0.72); ring2.position.z = HD - 0.06;
  hall.add(ring2);

  const seat = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.5, 1.3), trimMat);
  seat.position.set(0, 0.9, HD - 0.85);
  hall.add(seat);
  const cushionMat = new THREE.MeshStandardMaterial({ color: P.rugRed, roughness: 0.95 });
  for (let i = -1; i <= 1; i++) {
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.18, 1.15), cushionMat);
    cushion.position.set(i * 1.5, 1.24, HD - 0.85);
    hall.add(cushion);
  }
  ctx.colliders.push({ x: 0, z: HD - 0.85, r: 1.15 });
  seat.userData.interact = {
    label: 'sit at the moon window',
    kind: 'sit',
    pos: new THREE.Vector3(0, 0, HD - 1.75),
    lookAt: new THREE.Vector3(0, 3.2, HD + 30),
  };
  ctx.interactables.push(seat);

  // rainbow reading nook (SE corner, image batch 2b) — small bed + nightstand
  const nookFrameMat = new THREE.MeshStandardMaterial({ color: P.woodDark, roughness: 0.8 });
  const quiltMat = new THREE.MeshStandardMaterial({ color: 0xd97a3c, roughness: 0.92 });
  const nook = new THREE.Group();
  const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.32, 2.2), nookFrameMat);
  bedFrame.position.y = 0.3;
  nook.add(bedFrame);
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.24, 2.0),
    new THREE.MeshStandardMaterial({ color: P.pageCream, roughness: 0.95 }));
  mattress.position.y = 0.58;
  nook.add(mattress);
  const quilt = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.14, 1.3), quiltMat);
  quilt.position.set(0, 0.76, -0.3);
  nook.add(quilt);
  const quiltFold = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.2, 0.34), quiltMat);
  quiltFold.position.set(0, 0.8, 0.42);
  nook.add(quiltFold);
  const nightstand = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.5), nookFrameMat);
  nightstand.position.set(1.05, 0.3, -0.85);
  nook.add(nightstand);
  nook.position.set(NOOK.x, 0, NOOK.z);
  hall.add(nook);
  ctx.colliders.push({ x: NOOK.x, z: NOOK.z, r: 1.2 });
  bedFrame.userData.interact = {
    label: 'curl up in the nook', kind: 'sit',
    pos: new THREE.Vector3(NOOK.x, 0, NOOK.z),
    lookAt: new THREE.Vector3(NOOK.x, 3.0, NOOK.z - 1.9),
  };
  ctx.interactables.push(bedFrame);

  // big rug
  const rug = new THREE.Mesh(new THREE.CircleGeometry(4.4, 48),
    new THREE.MeshStandardMaterial({ color: P.rugRed, roughness: 1 }));
  rug.rotation.x = -Math.PI / 2; rug.position.y = 0.012;
  hall.add(rug);
  const rugTrim = new THREE.Mesh(new THREE.RingGeometry(3.9, 4.4, 48),
    new THREE.MeshStandardMaterial({ color: P.rugGold, roughness: 1 }));
  rugTrim.rotation.x = -Math.PI / 2; rugTrim.position.y = 0.016;
  hall.add(rugTrim);

  buildShelves(hall);

  // wall AABBs (thin) with the north doorway gap
  const t = 0.6;
  ctx.walls.push(
    { minX: -HW - t, maxX: HW + t, minZ: HD - 0.1, maxZ: HD + t },              // south
    { minX: -HW - t, maxX: -ctx.doorway.halfW, minZ: -HD - t, maxZ: -HD + 0.1 }, // north left of door
    { minX: ctx.doorway.halfW, maxX: HW + t, minZ: -HD - t, maxZ: -HD + 0.1 },   // north right of door
    { minX: -HW - t, maxX: -HW + 0.55, minZ: -HD - t, maxZ: HD + t },            // west (shelf depth)
    { minX: HW - 0.55, maxX: HW + t, minZ: -HD - t, maxZ: HD + t },              // east
  );

  ctx.hall = hall;
  return hall;
}

// ── bookshelves: full east & west walls, instanced books ────────────────────
function buildShelves(hall) {
  const frameMat = new THREE.MeshStandardMaterial({ color: P.woodDark, roughness: 0.78 });
  const shelfGeo = new THREE.BoxGeometry(0.5, 0.07, 2.9);
  const NBAYS = 7, BAYW = 2.95, SHELVES = 6;

  const bookGeo = new THREE.BoxGeometry(1, 1, 1);
  const bookMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  const perWall = NBAYS * SHELVES * 14;
  const col = new THREE.Color();

  for (const side of [-1, 1]) {
    const x = side * (HALL.w / 2 - 0.32);
    const wallG = new THREE.Group();

    // vertical frames
    for (let b = 0; b <= NBAYS; b++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, HALL.h - 0.4, 0.16), frameMat);
      post.position.set(x, (HALL.h - 0.4) / 2, -HALL.d / 2 + 0.5 + b * BAYW);
      wallG.add(post);
    }
    const books = new THREE.InstancedMesh(bookGeo, bookMat, perWall);
    let bi = 0;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pv = new THREE.Vector3();
    const rot = new THREE.Euler();

    for (let b = 0; b < NBAYS; b++) {
      const zc = -HALL.d / 2 + 0.5 + BAYW / 2 + b * BAYW;
      for (let sh = 0; sh < SHELVES; sh++) {
        const y = 0.55 + sh * 1.32;
        const board = new THREE.Mesh(shelfGeo, frameMat);
        board.position.set(x, y - 0.05, zc);
        wallG.add(board);
        // a row of books with organic variety + occasional gaps/leaners
        let zOff = -1.28;
        while (zOff < 1.22 && bi < perWall) {
          const bw = 0.09 + Math.random() * 0.1;          // spine thickness
          if (Math.random() < 0.07) { zOff += bw + 0.22; continue; }  // gap
          const bh = 0.62 + Math.random() * 0.34;
          const bd = 0.62 + Math.random() * 0.16;
          const lean = Math.random() < 0.08 ? side * (0.12 + Math.random() * 0.12) : 0;
          pv.set(x - side * 0.02, y + bh / 2, zc + zOff);
          rot.set(0, 0, lean); q.setFromEuler(rot);
          s.set(bd, bh, bw);
          m.compose(pv, q, s);
          books.setMatrixAt(bi, m);
          col.setHex(P.books[(Math.random() * P.books.length) | 0])
             .offsetHSL(0, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.08);
          books.setColorAt(bi, col);
          bi++; zOff += bw + 0.012;
        }
      }
    }
    books.count = bi;
    books.instanceMatrix.needsUpdate = true;
    if (books.instanceColor) books.instanceColor.needsUpdate = true;
    wallG.add(books);
    hall.add(wallG);
  }
}
