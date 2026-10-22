// Destructible props: geometry (cached per kind) + stats. Each prop instance = Group of shared-geometry meshes.
import * as THREE from 'three';
import { MB, Frame, G, PAL, dishGeom, getMaterials } from './kit.js';

const M = PAL.mil;
// hp, chaos, blast radius (for chain reactions), fx size, collider half extents + centre y
export const STATS = {
  fuelTank:    { hp: 60,  chaos: 200,  blast: 16, fx: 3,   coll: [4.2, 4, 4.2, 4] },
  gasSilo:     { hp: 120, chaos: 400,  blast: 20, fx: 3.5, coll: [3.2, 9, 3.2, 9] },
  sam:         { hp: 150, chaos: 500,  blast: 10, fx: 2.2, coll: [3.2, 1.8, 1.8, 1.8] },
  radar:       { hp: 120, chaos: 450,  blast: 8,  fx: 2,   coll: [2.5, 5, 2.5, 5] },
  generator:   { hp: 50,  chaos: 150,  blast: 7,  fx: 1.4, coll: [1.7, 1.2, 1.1, 1.2] },
  transformer: { hp: 60,  chaos: 200,  blast: 7,  fx: 1.4, coll: [1.6, 1.8, 1.3, 1.8] },
  commAntenna: { hp: 100, chaos: 300,  blast: 6,  fx: 1.6, coll: [1.2, 15, 1.2, 15] },
  satUplink:   { hp: 90,  chaos: 300,  blast: 6,  fx: 1.6, coll: [2.6, 2.5, 2.6, 2.5] },
  billboard:   { hp: 40,  chaos: 100,  blast: 4,  fx: 1,   coll: [5.2, 4.5, 0.5, 4.5] },
  loudspeaker: { hp: 20,  chaos: 75,   blast: 3,  fx: 0.6, coll: [0.4, 4, 0.4, 4] },
  statue:      { hp: 300, chaos: 1000, blast: 5,  fx: 1.5, coll: [1.6, 4.5, 1.6, 4.5] },
  flagpole:    { hp: 30,  chaos: 50,   blast: 2,  fx: 0.5, coll: [0.3, 6, 0.3, 6] },
  barrel:      { hp: 10,  chaos: 25,   blast: 6,  fx: 1,   coll: [0.35, 0.45, 0.35, 0.45], counts: false },
};

const cache = new Map();
function finish(mbs) { // {matName: MB} -> [{geom, mat}]
  const mats = getMaterials(); const out = [];
  for (const [k, mb] of Object.entries(mbs)) if (!mb.empty) out.push({ geom: mb.geometry(), mat: k, matObj: mats[k] });
  return out;
}
function lattice(F, mb, h, w, segs, c1, c2) {
  const step = h / segs;
  for (let i = 0; i < segs; i++) {
    const y0 = i * step, y1 = y0 + step, cc = i % 2 ? c1 : c2, k0 = w * (1 - 0.5 * y0 / h) / 2, k1 = w * (1 - 0.5 * y1 / h) / 2;
    const P = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let j = 0; j < 4; j++) {
      const [ax, az] = P[j], [bx, bz] = P[(j + 1) % 4];
      F.beam(mb, [ax * k0, y0, az * k0], [ax * k1, y1, az * k1], 0.09, cc);
      F.beam(mb, [ax * k0, y0, az * k0], [bx * k1, y1, bz * k1], 0.04, cc);
      F.beam(mb, [ax * k1, y1, az * k1], [bx * k1, y1, bz * k1], 0.05, cc);
    }
  }
}

function build(kind) {
  const F = new Frame(0, 0, 0, 0); const mil = new MB(), con = new MB(), dark = new MB(), red = new MB(), spinMil = new MB(), poster = new MB(), bronze = new MB(), stone = new MB();
  let spin = null, flag = null;
  switch (kind) {
    case 'fuelTank': {
      F.box(con, 0, 0.15, 0, 9.6, 0.3, 9.6, 0x9a9890);
      F.geo(mil, G.cyl24, 0, 3.8, 0, 0, 8, 7, 8, M.white);
      F.geo(mil, G.cyl24, 0, 5.6, 0, 0, 8.08, 1, 8.08, M.red);
      F.geo(mil, G.cyl24, 0, 2.2, 0, 0, 8.08, 0.25, 8.08, M.red);
      F.geo(mil, G.cone24, 0, 7.75, 0, 0, 8.2, 0.9, 8.2, 0xcfcfc8);
      for (let y = 0.6; y < 7.2; y += 0.45) F.box(dark, 4.15, y, 0, 0.06, 0.06, 0.7, M.dark);
      F.box(dark, 4.15, 3.9, 0.35, 0.08, 7.4, 0.08, M.dark); F.box(dark, 4.15, 3.9, -0.35, 0.08, 7.4, 0.08, M.dark);
      F.geo(dark, G.cyl8, -3, 0.8, 4.4, 0, 0.5, 0.5, 3, M.grey, false, Math.PI / 2);
      F.box(mil, -3, 0.8, 5.9, 0.8, 1, 0.8, M.yellow);
      break;
    }
    case 'gasSilo': {
      F.geo(con, G.cyl24, 0, 0.3, 0, 0, 7.5, 0.6, 7.5, 0x9a9890);
      F.geo(mil, G.cyl24, 0, 8, 0, 0, 6, 15.4, 6, 0xdedcd4);
      for (const y of [12.5, 14.2]) F.geo(mil, G.cyl24, 0, y, 0, 0, 6.08, 0.8, 6.08, M.red);
      F.geo(mil, G.dome, 0, 15.7, 0, 0, 6, 3, 6, 0xcfcfc8);
      F.geo(dark, G.cyl24, 0, 10, 0, 0, 7.2, 0.12, 7.2, M.dark);
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; F.box(dark, Math.cos(a) * 3.55, 10.5, Math.sin(a) * 3.55, 0.05, 1, 0.05, M.dark); }
      F.geo(dark, G.cyl8, 3.4, 8, 0, 0, 0.35, 16, 0.35, M.grey);
      F.box(mil, 3.06, 4, 0, 0.05, 1.4, 1.4, M.yellow);
      break;
    }
    case 'sam': {
      F.box(mil, 0, 0.9, 0, 6.2, 1.2, 2.8, M.olive); F.box(mil, 2.4, 1.9, 0, 1.4, 1.2, 2.6, M.olive);
      F.box(dark, 2.95, 2.1, 0, 0.1, 0.6, 2.2, 0x22282c);
      for (const x of [-2.2, -0.6, 1.2, 2.4]) for (const z of [-1.3, 1.3]) F.geo(dark, G.cyl12, x, 0.5, z, 0, 1, 0.45, 1, 0x1b1b1b, false, Math.PI / 2);
      const S = new Frame(0, 0, 0, 0);
      S.geo(spinMil, G.cyl12, 0, 1.75, 0, 0, 1.8, 0.5, 1.8, M.olive);
      for (const [x, y] of [[-0.45, 2.6], [0.45, 2.6], [-0.45, 3.3], [0.45, 3.3]]) {
        S.box(spinMil, x, y, 0, 0.62, 0.62, 5, M.olive, 0, -0.6);
        S.geo(spinMil, G.cone8, x, y + Math.sin(0.6) * 2.6, Math.cos(0.6) * 2.6, 0, 0.5, 0.6, 0.5, M.white, false, 0.6 + Math.PI / 2 - 0.0);
      }
      spin = { y: 0, speed: 0.25, sweep: true };
      break;
    }
    case 'radar': {
      lattice(F, dark, 6, 3.2, 2, M.grey, M.grey);
      F.box(mil, 0, 6.3, 0, 3.4, 0.4, 3.4, M.grey);
      F.box(mil, 2.6, 1.3, 0, 2.2, 2.6, 2.2, M.olive);
      const S = new Frame(0, 0, 0, 0);
      S.geo(spinMil, G.cyl12, 0, 6.9, 0, 0, 0.9, 0.8, 0.9, M.dark);
      S.geo(spinMil, dishGeom(4, 1.4), 0, 8.4, 0.4, 0, 1, 1, 1, M.white, false, -Math.PI / 2 + 0.35);
      S.beam(spinMil, [0, 8.4, 0.4], [0, 8.9, 3.6], 0.06, M.dark); S.box(spinMil, 0, 8.95, 3.7, 0.4, 0.4, 0.4, M.dark);
      spin = { y: 0, speed: 1.1 };
      break;
    }
    case 'generator': {
      F.box(con, 0, 0.1, 0, 3.8, 0.2, 2.6, 0x8c8a84);
      F.box(mil, 0, 1.15, 0, 3.2, 1.9, 1.9, M.yellow);
      for (let i = 0; i < 6; i++) F.box(dark, -1.2 + i * 0.22, 1.3, 0.96, 0.1, 1.1, 0.04, M.dark);
      F.box(dark, 1, 1.4, 0.97, 0.9, 0.7, 0.04, 0x30343a);
      F.geo(dark, G.cyl8, 1.2, 2.6, -0.5, 0, 0.22, 1.2, 0.22, M.dark);
      for (let i = 0; i < 8; i++) F.box(red, -1.61, 0.35, -0.9 + i * 0.24, 0.02, 0.2, 0.12, i % 2 ? M.black : M.yellow);
      break;
    }
    case 'transformer': {
      F.box(con, 0, 0.2, 0, 3.6, 0.4, 3, 0x8c8a84);
      F.box(mil, 0, 1.6, 0, 2.4, 2.4, 1.6, 0x6f7a72);
      for (let i = 0; i < 7; i++) F.box(mil, -1.05 + i * 0.35, 1.5, 0.95, 0.08, 2, 0.4, 0x606b63);
      for (const x of [-0.7, 0, 0.7]) { for (let k = 0; k < 4; k++) F.geo(dark, G.cyl8, x, 2.95 + k * 0.18, 0, 0, 0.32 - k * 0.03, 0.12, 0.32 - k * 0.03, 0x7a4a2a); F.geo(dark, G.cyl8, x, 3.7, 0, 0, 0.06, 0.4, 0.06, M.grey); }
      F.box(mil, 0, 1.8, -0.81, 0.8, 0.8, 0.02, M.yellow);
      break;
    }
    case 'commAntenna': {
      F.box(con, 0, 0.25, 0, 3.4, 0.5, 3.4, 0x8c8a84);
      lattice(F, mil, 30, 2.2, 8, M.red, M.white);
      for (const [y, a] of [[22, 0], [25, 2.1], [18, 4.2]]) F.box(mil, Math.cos(a) * 0.9, y, Math.sin(a) * 0.9, 0.5, 2.4, 0.18, M.white, -a);
      F.geo(dark, G.cyl8, 0, 32, 0, 0, 0.12, 4, 0.12, M.grey);
      F.geo(red, G.sphere, 0, 34.1, 0, 0, 0.45, 0.45, 0.45, 0xff2010);
      break;
    }
    case 'satUplink': {
      F.box(con, 0, 0.15, 0, 5, 0.3, 5, 0x8c8a84);
      F.box(mil, -1.6, 1.1, -1.6, 1.6, 1.6, 1.6, M.grey);
      F.geo(dark, G.cyl12, 0, 1.4, 0, 0, 0.8, 2.6, 0.8, M.grey);
      F.geo(mil, dishGeom(2.6, 0.9), 0, 3.1, 0, 0, 1, 1, 1, M.white, false, -0.75);
      F.beam(dark, [0, 3.1, 0], [0, 5.0, 1.6], 0.05, M.dark); F.box(dark, 0, 5.05, 1.65, 0.35, 0.35, 0.35, M.dark);
      break;
    }
    case 'billboard': {
      for (const x of [-3.5, 3.5]) F.box(dark, x, 2.5, 0, 0.35, 5, 0.35, M.dark);
      F.box(mil, 0, 6.2, -0.12, 10.4, 5.4, 0.25, M.dark);
      F.box(dark, 0, 3.4, 0.5, 10, 0.12, 0.9, M.grey);
      for (const x of [-3, 0, 3]) F.box(dark, x, 3.5, 0.9, 0.5, 0.25, 0.4, M.dark);
      const g = new THREE.PlaneGeometry(10, 5); F.geo(poster, g, 0, 6.2, 0.02, 0, 1, 1, 1, 0xffffff, true);
      break;
    }
    case 'loudspeaker': {
      F.geo(dark, G.cyl8, 0, 4, 0, 0, 0.22, 8, 0.22, M.grey);
      F.box(dark, 0, 2.2, 0.18, 0.4, 0.55, 0.2, M.olive);
      for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; F.geo(mil, G.cone8, Math.sin(a) * 0.45, 7.3, Math.cos(a) * 0.45, a, 0.7, 1.1, 0.7, 0xb8b8b0, false, -Math.PI / 2 - 0.25); }
      break;
    }
    case 'flagpole': {
      F.geo(dark, G.cyl8, 0, 6, 0, 0, 0.18, 12, 0.18, 0xd8d8d0);
      F.geo(dark, G.sphere, 0, 12.1, 0, 0, 0.35, 0.35, 0.35, 0xc9a43a);
      F.geo(stone, G.cyl12, 0, 0.3, 0, 0, 1.6, 0.6, 1.6, 0xd8cdb4);
      flag = { x: 0.1, y: 11.6, w: 3.6, h: 2.2 };
      break;
    }
    case 'barrel': {
      F.geo(mil, G.cyl12, 0, 0.45, 0, 0, 0.6, 0.9, 0.6, 0xb3261e);
      for (const y of [0.25, 0.65]) F.geo(dark, G.cyl12, 0, y, 0, 0, 0.62, 0.05, 0.62, 0x401010);
      F.box(mil, 0, 0.5, 0.3, 0.25, 0.2, 0.02, M.yellow);
      break;
    }
    case 'statue': { // figure only (pedestal is static): stylised general in greatcoat, arm raised
      const c = 0x8a6a3a;
      F.geo(bronze, G.cone8, 0, 2.2, 0, 0, 2.2, 4.2, 1.7, c, false, Math.PI); // coat skirt (inverted cone)
      F.box(bronze, 0, 4.9, 0, 1.6, 2.2, 1.0, c);
      F.box(bronze, 0, 5.85, 0, 2.3, 0.5, 1.1, c); // shoulders
      F.geo(bronze, G.sphere, 0, 6.6, 0, 0, 0.85, 1.0, 0.9, c);
      F.geo(bronze, G.cyl12, 0, 7.15, 0.05, 0, 1.0, 0.35, 1.0, c); F.geo(bronze, G.cyl12, 0, 7.0, 0.2, 0, 1.25, 0.08, 1.4, c);
      F.box(bronze, 1.35, 6.6, 0.1, 0.42, 2.0, 0.42, c, 0, 0, 0.5); // raised right arm
      F.box(bronze, -1.15, 4.8, 0.1, 0.4, 1.9, 0.4, c, 0, 0, -0.08);
      F.box(bronze, 0, 0.15, 0, 2.4, 0.3, 2.0, c);
      break;
    }
  }
  const parts = finish({ metal: mil, concrete: con, paint: dark, redLight: red, poster, bronze, stone });
  const spinParts = spin ? finish({ metal: spinMil }) : [];
  return { parts, spinParts, spin, flag };
}

export function propDef(kind) { if (!cache.has(kind)) cache.set(kind, build(kind)); return cache.get(kind); }

// crumpled charred copy of the prop geometry (cached)
const wreckCache = new Map();
export function wreckParts(kind) {
  if (wreckCache.has(kind)) return wreckCache.get(kind);
  const d = propDef(kind), out = [];
  let s = 99; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5;
  const sq = kind === 'commAntenna' ? 0.08 : kind === 'gasSilo' ? 0.22 : kind === 'statue' ? 0.25 : 0.4;
  for (const p of [...d.parts, ...d.spinParts]) {
    if (p.mat === 'poster' || p.mat === 'redLight') continue;
    const g = p.geom.clone(), P = g.attributes.position;
    for (let i = 0; i < P.count; i++) { const y = P.getY(i); P.setXYZ(i, P.getX(i) * (1 + rnd() * 0.25) + rnd() * 0.4, Math.max(0.05, y * sq + rnd() * 0.3), P.getZ(i) * (1 + rnd() * 0.25) + rnd() * 0.4); }
    g.deleteAttribute('color'); g.computeVertexNormals(); out.push(g);
  }
  wreckCache.set(kind, out); return out;
}
