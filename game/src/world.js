// Neon Harbor — the city itself, built from a seed. Streets on a grid, blocks full of
// low-poly buildings, a sand beach and teal sea to the south, container docks to the
// east, palms and lamps along the sidewalks. Pure data: no three.js in here, so the
// renderer and the minimap both read the same city. Collision is circle-vs-AABB.

import { CITY, PALETTE, STREETS, clamp, makeRng, pick, range } from './config.js';

// Named places the missions and the story point at. All original names.
export const PLACES = {
  cafe: { x: -22, z: -22, label: "Marina's Cafe" },        // Palm Row, the fixer's base
  docksPickup: { x: 182, z: 148, label: 'Harbor Docks' },  // east docks, mission 1 pickup
  cannery: { x: -154, z: 154, label: 'Old Cannery' },      // west, mission 4 ambush
  heights: { x: 110, z: -154, label: 'Marina Heights' },   // north, mission 2 checkpoint area
  heistTruck: { x: 182, z: 104, label: 'Harbor Yard' },    // east docks, mission 5 truck
  dropoff: { x: -154, z: -154, label: 'North Depot' },     // mission 5 drop-off
  debtorA: { x: 66, z: 66, label: 'Palm Row flat' },
  debtorB: { x: -110, z: 22, label: 'Cannery Row flat' },
  debtorC: { x: 22, z: -110, label: 'Heights flat' },
  checkpointB: { x: -88, z: -88, label: 'Checkpoint B' },
  checkpointC: { x: 88, z: 88, label: 'Checkpoint C' },
};

export function buildWorld(seed) {
  const rng = makeRng(seed);
  const buildings = [];   // {x, z, w, d, h, color, roof, neon}
  const colliders = [];   // {minX, maxX, minZ, maxZ} AABBs for buildings + dock walls
  const palms = [];       // {x, z, s}
  const lamps = [];       // {x, z}
  const containers = [];  // {x, z, color, rot}
  const cranes = [];      // {x, z}
  const parkedCars = [];  // {x, z, heading, color} — cars the player can steal

  // Buildings: one or two per block, kept off the streets and off the beach.
  for (let bx = 0; bx < STREETS.length - 1; bx += 1) {
    for (let bz = 0; bz < STREETS.length - 1; bz += 1) {
      const cx = (STREETS[bx] + STREETS[bx + 1]) / 2;
      const cz = (STREETS[bz] + STREETS[bz + 1]) / 2;
      if (cz > CITY.beachStart - 16) continue; // beach blocks stay open
      const count = rng() < 0.55 ? 1 : 2;
      for (let n = 0; n < count; n += 1) {
        const w = range(rng, 12, 20), d = range(rng, 12, 20);
        const ox = count === 1 ? 0 : (n === 0 ? -8 : 8);
        const oz = count === 1 ? 0 : (n === 0 ? -7 : 7);
        const x = cx + ox, z = cz + oz;
        const h = range(rng, 7, 34) * (rng() < 0.12 ? 1.7 : 1); // a few towers
        const color = pick(rng, PALETTE.building);
        const roof = pick(rng, PALETTE.roof);
        const neon = rng() < 0.4 ? pick(rng, PALETTE.neon) : null;
        buildings.push({ x, z, w, d, h, color, roof, neon });
        colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
      }
    }
  }

  // Palms along the beach front and a few on Palm Row; lamps at intersections.
  for (let x = -180; x <= 180; x += 24) {
    palms.push({ x: x + range(rng, -4, 4), z: 190, s: range(rng, 0.9, 1.3) });
    if (rng() < 0.5) palms.push({ x: x + range(rng, -4, 4), z: -178, s: range(rng, 0.8, 1.2) });
  }
  for (const sx of STREETS) for (const sz of STREETS) {
    if (rng() < 0.6) lamps.push({ x: sx + 8, z: sz + 8 });
  }

  // Harbor docks: container stacks and two cranes on the east edge. Keep the
  // mission spots (pickup, truck) clear of containers so they stay reachable.
  for (let i = 0; i < 26; i += 1) {
    const c = {
      x: range(rng, 178, 194), z: range(rng, 92, 180),
      color: pick(rng, PALETTE.container), rot: rng() < 0.5 ? 0 : Math.PI / 2,
    };
    if (Math.hypot(c.x - 182, c.z - 148) < 9) continue;
    if (Math.hypot(c.x - 182, c.z - 104) < 9) continue;
    containers.push(c);
  }
  cranes.push({ x: 188, z: 120 }, { x: 188, z: 165 });
  // Dock walls: east edge and north edge only — the yard stays open from the city.
  colliders.push({ minX: 196, maxX: 200, minZ: 86, maxZ: 186 });
  colliders.push({ minX: 176, maxX: 200, minZ: 86, maxZ: 90 });
  for (const c of containers) {
    const hw = c.rot === 0 ? 3 : 1.3, hd = c.rot === 0 ? 1.3 : 3;
    colliders.push({ minX: c.x - hw, maxX: c.x + hw, minZ: c.z - hd, maxZ: c.z + hd });
  }

  // Parked cars along street edges, stealable with E.
  const parkSpots = [];
  for (let i = 0; i < 10; i += 1) {
    const street = pick(rng, STREETS);
    const along = range(rng, -160, 160);
    const horizontal = rng() < 0.5;
    const x = horizontal ? along : street + 8.5;
    const z = horizontal ? street + 8.5 : along;
    parkSpots.push({ x, z, heading: horizontal ? 0 : Math.PI / 2 });
  }
  for (const s of parkSpots) {
    parkedCars.push({ x: s.x, z: s.z, heading: s.heading, color: pick(rng, PALETTE.carPaint) });
  }

  // Traffic loops: rectangles around blocks, driven by the AI cars.
  const loops = [];
  for (let i = 0; i < 8; i += 1) {
    const bx = Math.floor(rng() * (STREETS.length - 1));
    const bz = Math.floor(rng() * (STREETS.length - 1));
    const x0 = STREETS[bx], x1 = STREETS[bx + 1], z0 = STREETS[bz], z1 = STREETS[bz + 1];
    if (z1 > CITY.beachStart - 16) continue;
    const cw = rng() < 0.5;
    const pts = cw
      ? [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }]
      : [{ x: x0, z: z0 }, { x: x0, z: z1 }, { x: x1, z: z1 }, { x: x1, z: z0 }];
    loops.push(pts);
  }

  // Pedestrian wander lines: sidewalk rings around blocks.
  const walkLines = [];
  for (let i = 0; i < 10; i += 1) {
    const bx = Math.floor(rng() * (STREETS.length - 1));
    const bz = Math.floor(rng() * (STREETS.length - 1));
    const x0 = STREETS[bx] + 9, x1 = STREETS[bx + 1] - 9;
    const z0 = STREETS[bz] + 9, z1 = STREETS[bz + 1] - 9;
    if (z1 > CITY.beachStart - 16) continue;
    walkLines.push([{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }]);
  }

  // --- queries used by gameplay, the renderer and the minimap ---

  function nearestStreet(v) {
    let best = STREETS[0], bd = Infinity;
    for (const s of STREETS) { const d = Math.abs(s - v); if (d < bd) { bd = d; best = s; } }
    return best;
  }

  function onRoad(x, z) {
    const half = CITY.roadWidth / 2;
    return Math.abs(x - nearestStreet(x)) <= half || Math.abs(z - nearestStreet(z)) <= half;
  }

  // Push a circle (x, z, radius) out of every building AABB it overlaps.
  // Returns true when a push happened (a hit), and mutates the given point.
  function collideCircle(p, radius) {
    let hit = false;
    for (const c of colliders) {
      const nx = clamp(p.x, c.minX, c.maxX);
      const nz = clamp(p.z, c.minZ, c.maxZ);
      const dx = p.x - nx, dz = p.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      hit = true;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        p.x = nx + (dx / d) * radius;
        p.z = nz + (dz / d) * radius;
      } else {
        // Centre inside the box: shove out along the smallest penetration axis.
        const px = Math.min(p.x - c.minX, c.maxX - p.x);
        const pz = Math.min(p.z - c.minZ, c.maxZ - p.z);
        if (px < pz) p.x = p.x - c.minX < c.maxX - p.x ? c.minX - radius : c.maxX + radius;
        else p.z = p.z - c.minZ < c.maxZ - p.z ? c.minZ - radius : c.maxZ + radius;
      }
    }
    // City walls (except the open sea to the south).
    if (p.x < -CITY.half + radius) { p.x = -CITY.half + radius; hit = true; }
    if (p.x > CITY.half - radius) { p.x = CITY.half - radius; hit = true; }
    if (p.z < -CITY.half + radius) { p.z = -CITY.half + radius; hit = true; }
    if (p.z > CITY.seaStart - radius) { p.z = CITY.seaStart - radius; hit = true; }
    return hit;
  }

  function randomStreetPoint(rngFn) {
    const street = pick(rngFn, STREETS);
    const along = range(rngFn, -170, 170);
    return rngFn() < 0.5 ? { x: along, z: street } : { x: street, z: along };
  }

  return {
    seed, buildings, colliders, palms, lamps, containers, cranes, parkedCars,
    loops, walkLines, onRoad, collideCircle, randomStreetPoint, nearestStreet,
  };
}
