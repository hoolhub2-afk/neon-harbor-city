// Neon Harbor — tuning, palette and the seeded random number generator.
// Every number that shapes the city, the cars and the chase lives here, so the
// rest of the game reads like the design instead of a pile of magic numbers.

export const CITY = {
  half: 200,            // city extends -200..200 on x and z (sea beyond +z)
  streetEvery: 44,      // distance between street centrelines
  roadWidth: 12,        // asphalt width of each street
  block: 32,            // building block width between streets
  seaStart: 212,        // z where the beach ends and the water begins
  beachStart: 198,      // z where the sand starts
};

export const STREETS = [-176, -132, -88, -44, 0, 44, 88, 132, 176];

export const PALETTE = {
  sky: 0x87bfe8,
  fog: 0xa8c8e0,
  sun: 0xffe6b0,
  asphalt: 0x2c2f36,
  sidewalk: 0x8d8578,
  sand: 0xe8cf9a,
  sea: 0x1e7f8e,
  building: [0xe8b48a, 0xd97b6c, 0x7fb5a8, 0xf2e3c6, 0xc9a0c4, 0x8fb8d8, 0xe8a34c, 0x9db98a],
  roof: [0xc65b4e, 0x3e7d7a, 0xe8e0c8, 0x5b6b8c],
  neon: [0xff5ea8, 0x39d5ff, 0xffd23e, 0x7dff9e, 0xff7a3d],
  carPaint: [0xffd23e, 0x39d5ff, 0xff5ea8, 0x7dff9e, 0xf2f2f2, 0x2c2f36, 0xff7a3d, 0xc9a0c4],
  palmTrunk: 0x7a5a38,
  palmLeaf: 0x3f9e57,
  container: [0xd95f43, 0x3e7d9e, 0xe8b13c, 0x6fae5e],
};

export const PLAYER = {
  walkSpeed: 5.2,
  runSpeed: 8.4,
  radius: 0.55,
  maxHealth: 100,
  punchRange: 2.4,
  punchDamage: 30,
  punchCooldown: 0.45,
  shootRange: 42,
  shootDamage: 34,
  magSize: 12,
  reloadTime: 1.6,
};

export const CAR = {
  accel: 15,
  brake: 34,
  reverseAccel: 10,
  maxSpeed: 27,
  maxReverse: 9,
  turnRate: 1.9,
  radius: 1.9,
};

export const WANTED = {
  maxStars: 5,
  decaySeconds: 14,     // out of police sight this long loses one star
  sightRange: 46,
  policePerStar: 1,
  maxPoliceCars: 5,
};

export const MISSIONS = [
  { id: 1, name: 'FIRST RUN', reward: 300 },
  { id: 2, name: 'GETAWAY DRIVER', reward: 500 },
  { id: 3, name: 'COLLECTING DEBTS', reward: 700 },
  { id: 4, name: 'CANNERY AMBUSH', reward: 900 },
  { id: 5, name: 'HARBOR HEIST', reward: 2000 },
];

// mulberry32: small fast seeded RNG. The same seed always builds the same city,
// so ?shot= scenes and replays are deterministic.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
export function range(rng, min, max) { return min + rng() * (max - min); }
export function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
// Shortest signed angle from a to b, in radians.
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}
