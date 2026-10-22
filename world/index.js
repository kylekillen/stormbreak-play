// World system: builds Corvana (terrain, regions, sites, roads, vegetation) and exposes game.world.
import { createTerrain, HALF } from './terrain.js';
import { planRoads, buildRoadMesh } from './roads.js';
import { createVegetation } from './vegetation.js';
import { mulberry32 } from './noise.js';

const REGION_DEFS = [ // original province names; anchors are relative to island frames
  { id: 'marivento', name: 'Marivento', island: 0, u: -0.45, v: 0.1 },
  { id: 'altaforra', name: 'Altaforra', island: 0, u: 0.4, v: -0.1 },
  { id: 'costasalvi', name: 'Costa Salvi', island: 1, u: 0.0, v: -0.45 },
  { id: 'pietrabruna', name: 'Pietrabruna', island: 1, u: 0.0, v: 0.45 },
  { id: 'valleorsina', name: 'Valle Orsina', island: 2, u: -0.4, v: 0.0 },
  { id: 'santelmira', name: "Sant'Elmira", island: 2, u: 0.45, v: 0.05 },
];

function voronoiPolys(centers) { // clip the map square by perpendicular bisectors
  return centers.map((c, i) => {
    let poly = [[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF]];
    centers.forEach((o, j) => {
      if (i === j) return;
      const nx = o.x - c.x, nz = o.z - c.z, mx = (o.x + c.x) / 2, mz = (o.z + c.z) / 2;
      const side = p => (p[0] - mx) * nx + (p[1] - mz) * nz; // <=0 keeps c's side
      const out = [];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length], sa = side(a), sb = side(b);
        if (sa <= 0) out.push(a);
        if ((sa < 0) !== (sb < 0) && sa !== sb) { const t = sa / (sa - sb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
      }
      poly = out;
    });
    return poly.map(([x, z]) => ({ x, z }));
  });
}

function placeholderSites(game, T) {
  const rnd = mulberry32(game.seed * 5 + 1), out = [];
  const spec = [['city', 1, 150], ['town', 2, 95], ['village', 4, 55], ['base', 2, 90], ['outpost', 2, 40]];
  T.islands.slice(0, 3).forEach((is, ii) => {
    const list = ii === 0 ? [...spec, ['airbase', 1, 220]] : ii === 1 ? [...spec, ['naval', 1, 120]] : spec;
    for (const [type, count, radius] of list) for (let c = 0; c < count; c++) {
      for (let tries = 0; tries < 400; tries++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.8;
        const u = Math.cos(a) * r * is.rx, v = Math.sin(a) * r * is.rz;
        const x = is.x + u * is.c - v * is.s, z = is.z + u * is.s + v * is.c;
        const h = T.heightAt(x, z), sl = T.slopeAt(x, z);
        const okH = type === 'naval' ? h > 1 && h < 25 && T.heightAt(x + 300, z) < 0 || T.heightAt(x - 300, z) < 0 : h > 6 && h < (type === 'outpost' ? 900 : type === 'base' ? 600 : 300);
        if (!okH || sl > 0.18 || out.some(s => Math.hypot(s.x - x, s.z - z) < s.radius + radius + 250)) continue;
        out.push({ id: `${type}-${ii}-${c}`, type, name: `${type} ${ii}${c}`, x, z, radius }); break;
      }
    }
  });
  return out;
}

export default {
  name: 'world',
  async init(game) {
    const THREE = game.THREE, t0 = performance.now();
    const before = new Set(game.scene.children);
    const T = createTerrain(game);
    const tH = performance.now();
    const rc = (game.RAPIER && new game.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }));
    const ownerOfCollider = c => {
      if (!c) return null;
      const o = game.world?.colliderOwner?.get?.(c.handle); if (o) return o;
      const p = game.player; if (p?.collider && p.collider.handle === c.handle) return p;
      return null;
    };
    const world = game.world = Object.assign(game.world || {}, {
      seaLevel: 0, size: 2 * HALF, half: HALF, terrain: T, roads: [], settlements: [], bases: [], sites: [],
      heightAt: T.heightAt, normalAt: T.normalAt, slopeAt: T.slopeAt,
      isWater: (x, z) => T.heightAt(x, z) < 0,
      // raycast(origin, dir, max = 1000, opts?) -> { point, normal, distance, collider, owner } | null
      // opts: terrainOnly (heightfield only), exclude (collider | handle | owner object | fn(owner, collider) | array/Set of those),
      //       excludePlayer (skip the player's own capsule), filter fn(collider, owner) -> keep?, dynamic (also hit dynamic bodies).
      // Without opts it behaves as before (every fixed collider, sensors/dynamic/kinematic excluded) plus `owner`.
      raycast(origin, dir, max = 1000, opts = null) {
        const W = game.physics, o = opts || {};
        if (W && rc && T.collider && !(o.terrainOnly && !T.collider)) {
          const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
          rc.origin = { x: origin.x, y: origin.y, z: origin.z }; rc.dir = { x: dir.x / l, y: dir.y / l, z: dir.z / l };
          const F = game.RAPIER.QueryFilterFlags;
          const flags = (o.dynamic ? 0 : F.EXCLUDE_DYNAMIC) | F.EXCLUDE_KINEMATIC | F.EXCLUDE_SENSORS;
          const pc = game.player?.collider;
          let pred;
          if (o.terrainOnly) { const th = T.collider.handle; pred = c => c.handle === th; }
          else if (opts && (o.exclude != null || o.filter || o.excludePlayer)) {
            const ex = o.exclude, list = ex == null || typeof ex === 'function' ? null : (Array.isArray(ex) || ex instanceof Set ? [...ex] : [ex]);
            pred = c => {
              if (o.excludePlayer && pc && c.handle === pc.handle) return false;
              const ow = ownerOfCollider(c);
              if (typeof ex === 'function' && ex(ow, c)) return false;
              if (list) for (const e of list) { if (e === c || e === c.handle || (ow && e === ow) || (e && e.handle === c.handle)) return false; }
              return o.filter ? !!o.filter(c, ow) : true;
            };
          }
          const hit = pred ? W.castRayAndGetNormal(rc, max, true, flags, undefined, undefined, undefined, pred) : W.castRayAndGetNormal(rc, max, true, flags);
          if (hit) { const d = hit.timeOfImpact; return { point: new THREE.Vector3(origin.x + rc.dir.x * d, origin.y + rc.dir.y * d, origin.z + rc.dir.z * d), normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), distance: d, collider: hit.collider, owner: ownerOfCollider(hit.collider), terrain: hit.collider.handle === T.collider.handle }; }
          return null;
        }
        // fallback: march the heightfield
        const l = Math.hypot(dir.x, dir.y, dir.z) || 1, dx = dir.x / l, dy = dir.y / l, dz = dir.z / l;
        let prev = 0;
        for (let d = 0; d <= max; d += 2) {
          const x = origin.x + dx * d, y = origin.y + dy * d, z = origin.z + dz * d;
          if (y <= T.heightAt(x, z)) {
            let a = prev, b = d; for (let k = 0; k < 12; k++) { const m = (a + b) / 2; (origin.y + dy * m <= T.heightAt(origin.x + dx * m, origin.z + dz * m)) ? b = m : a = m; }
            const px = origin.x + dx * b, pz = origin.z + dz * b;
            return { point: new THREE.Vector3(px, origin.y + dy * b, pz), normal: T.normalAt(px, pz), distance: b, collider: null, owner: null, terrain: true };
          }
          prev = d;
        }
        return null;
      },
    });

    // ---- regions ----
    const centers = REGION_DEFS.map(r => { const is = T.islands[r.island]; const u = r.u * is.rx, v = r.v * is.rz; return { x: is.x + u * is.c - v * is.s, z: is.z + u * is.s + v * is.c }; });
    const polys = voronoiPolys(centers);
    world.regions = REGION_DEFS.map((r, i) => ({ id: r.id, name: r.name, island: r.island, center: centers[i], polygon: polys[i], siteIds: [] }));
    world.regionAt = (x, z) => { let b = null, bd = Infinity; for (const r of world.regions) { const d = (r.center.x - x) ** 2 + (r.center.z - z) ** 2; if (d < bd) { bd = d; b = r; } } return b; };

    // ---- sites (settlements engineer plans; fallback placeholders) ----
    let S = null, sites = null;
    try { S = (await import('./settlements.js')).default; } catch (e) { console.warn('[world] settlements.js unavailable:', e.message); }
    try { if (S?.plan) sites = S.plan(game); } catch (e) { console.error('[world] settlements.plan failed', e); }
    if (!Array.isArray(sites) || !sites.length) sites = placeholderSites(game, T);
    for (const s of sites) {
      s.radius = s.radius || 60;
      const reg = world.regionAt(s.x, s.z); s.regionId = s.regionId || reg.id;
      world.regions.find(r => r.id === s.regionId)?.siteIds.push(s.id);
      if (T.heightAt(s.x, s.z) > -2) T.flattenSite(s);
    }
    world.sites = sites;

    // ---- roads ----
    let roadMesh = null;
    try {
      world.roads = planRoads(T, sites);
      for (const r of world.roads) T.flattenRoad(r.points, r.width);
      T.applyRoads();
    } catch (e) { console.error('[world] roads failed', e); world.roads = []; }

    // ---- surface, collider, meshes ----
    await T.initGPU();
    T.finalize();
    T.buildCollider();
    game.scene.add(T.root);
    if (world.roads.length) { roadMesh = buildRoadMesh(game, T, world.roads); game.scene.add(roadMesh); }
    for (const r of world.roads) for (const p of r.points) p.y = T.heightAt(p.x, p.z) + 0.07;

    // ---- spawn point: a beach near a village ----
    const vil = sites.find(s => s.type === 'village') || sites[0];
    let best = null, bd = Infinity;
    if (vil) for (let r = vil.radius; r < 1500 && !best; r += 40) for (let a = 0; a < 48; a++) {
      const x = vil.x + Math.cos(a / 48 * 6.283) * r, z = vil.z + Math.sin(a / 48 * 6.283) * r, h = T.heightAt(x, z);
      if (h > 0.6 && h < 3 && T.slopeAt(x, z) < 0.12) { const d = Math.hypot(x - vil.x, z - vil.z); if (d < bd) { bd = d; best = { x, z }; } }
    }
    best = best || (vil ? { x: vil.x, z: vil.z } : { x: T.islands[0].x, z: T.islands[0].z });
    world.spawnPoint = new THREE.Vector3(best.x, T.heightAt(best.x, best.z) + 1.5, best.z);

    // ---- settlements build ----
    try { if (S?.build) await S.build(game); } catch (e) { console.error('[world] settlements.build failed', e); }
    world.settlements = world.settlements?.length ? world.settlements : sites.filter(s => ['city', 'town', 'village'].includes(s.type));
    world.bases = world.bases?.length ? world.bases : sites.filter(s => ['base', 'airbase', 'naval', 'outpost'].includes(s.type));

    // ---- destructible placeholders (settlements owns the real protocol) ----
    if (!world.registerDestructible) {
      const list = world.destructibles = world.destructibles || new Set();
      world.registerDestructible = (obj) => { list.add(obj); return obj; };
      world.damageDestructible = (obj, amt, pos) => {
        const d = obj?.userData?.destructible; if (!d || d.hp <= 0) return;
        d.hp -= amt;
        if (d.hp <= 0) {
          const p = obj.getWorldPosition(new THREE.Vector3());
          game.fx?.explosion?.(p, 6); game.gfx?.shake?.(0.6);
          obj.visible = false; list.delete(obj);
          game.events.emit('destructible:destroyed', { obj, pos: p, kind: d.kind, chaos: d.chaos || 0, baseId: d.baseId });
          if (d.chaos) game.events.emit('chaos', { amount: d.chaos, pos: p, reason: d.kind });
        }
      };
    }

    // ---- landmarks (after settlements: needs registerDestructible) ----
    try { const L = await import('./landmarks.js'); world._landmarks = L.buildLandmarks(game, T, sites); }
    catch (e) { console.error('[world] landmarks failed', e); }

    // ---- vegetation ----
    try { world.vegetation = createVegetation(game, T, [...sites, ...(world.landmarks || []).map(l => ({ id: 'lm-' + l.id, type: 'landmark', x: l.x, z: l.z, radius: l.id === 'colossus' ? 28 : 16 }))]); game.scene.add(world.vegetation.root); }
    catch (e) { console.error('[world] vegetation failed', e); }

    // tag everything world added so gfx's central shadow culling leaves it alone (world manages its own casters)
    for (const c of game.scene.children) if (!before.has(c)) c.userData.sbOwner = 'world';
    world.stats = { genMs: Math.round(tH - t0), totalMs: Math.round(performance.now() - t0), sites: sites.length, roads: world.roads.length, veg: world.vegetation?.counts };
    console.log('[world] ready', world.stats);
  },
  update(dt, game) {
    const w = game.world; if (!w?.terrain) return;
    w.terrain.update(game.camera);
    w.vegetation?.update(dt, game.camera);
    w._landmarks?.update(dt);
  },
};
