// Neon Harbor — deterministic screenshot scenes behind ?shot=start|play|chase|mission.
// Any other ?shot= value stages the play (driving) scene: a shot hook must
// always land in gameplay, never on the title screen — 'start' is the only
// shot that shows the title.
// Each scene stages a fixed, seeded slice of the real game (same code, same rules),
// then freezes the simulation so the frame is stable: the camera, the wanted level,
// the traffic and the mission banner are exactly what a player would see there.

import { PLACES } from './world.js';

// Place the player in a car at (x, z) heading `h`, with a few traffic cars around.
function stageDrive(G, x, z, heading, wanted) {
  const player = G.player;
  const car = G.spawnParkedCar(x, z, heading, 0xffd23e);
  car.owned = true;
  player.enterCar(car, true);
  car.speed = 12;
  G.wanted = wanted;
  G.syncPolice(true);
  // Traffic ahead and alongside, mid-loop.
  const loop = G.world.loops[0];
  for (let i = 0; i < 4; i += 1) {
    const p = loop[i % loop.length];
    const t = G.spawnTrafficAt(p.x + 6, p.z + 6, i);
    t.speed = 8;
  }
  G.cameraYaw = heading + Math.PI;
  G.camPitch = 3;
  G.hud.setHint('');
}

export function stageShot(name, G) {
  // Reset to a clean, seeded world first.
  G.resetWorld(1);
  const player = G.player;
  if (name === 'start') {
    // Title screen over a high view of the city and the sea.
    G.mode = 'title';
    player.x = 0; player.z = 40; player.heading = Math.PI;
    G.missions.index = 0; G.missions.step = 0;
    G.missions._describe();
    G.renderer.setFixedCamera(-70, 118, 268, 0, 10, -80);
    G.shotFixedCamera = true;
    G.hud.showScreen('titleScreen');
    return;
  }
  if (name === 'play' || name === 'drive') {
    G.mode = 'playing';
    G.missions.index = 0; G.missions.step = 0;
    G.missions._describe();
    stageDrive(G, 0, -60, 0, 0);
    G.hud.showScreen(null);
    return;
  }
  if (name === 'chase') {
    G.mode = 'playing';
    G.missions.index = 1; G.missions.step = 1; G.missions.timer = 62;
    G.missions._describe();
    stageDrive(G, 44, -20, 0, 3);
    // Police converging ahead of the player, in frame: two flanking, one close behind.
    const p1 = G.policeCars[0], p2 = G.policeCars[1], p3 = G.policeCars[2];
    if (p1) { p1.x = 37; p1.z = -8; p1.heading = 0.5; p1.speed = 16; p1.syncMesh(); }
    if (p2) { p2.x = 51; p2.z = -10; p2.heading = -0.4; p2.speed = 15; p2.syncMesh(); }
    if (p3) { p3.x = 40; p3.z = -28; p3.heading = 0; p3.speed = 15; p3.syncMesh(); }
    G.hud.showScreen(null);
    return;
  }
  if (name === 'mission') {
    G.mode = 'playing';
    G.missions.index = 3; G.missions.step = 1; G.missions.thugsLeft = 4;
    G.missions._describe();
    player.x = PLACES.cannery.x + 6; player.z = PLACES.cannery.z - 8;
    player.heading = Math.PI * 0.85;
    player.health = 82;
    player.ammo = 9;
    G.spawnThugsAt(PLACES.cannery.x, PLACES.cannery.z, 4);
    // Two thugs closing in right in front of the player, two more by the cannery.
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    G.thugs[0].x = player.x + fx * 4.5; G.thugs[0].z = player.z + fz * 4.5; G.thugs[0].aggro = true;
    G.thugs[1].x = player.x + fx * 7 + fz * 3; G.thugs[1].z = player.z + fz * 7 - fx * 3; G.thugs[1].aggro = true;
    G.cameraYaw = player.heading + Math.PI + 0.35;
    G.camPitch = 4;
    G.hud.showScreen(null);
    return;
  }
  // Default: play — driving third-person gameplay. 'start' is the only shot
  // that shows the title screen; any other ?shot= value lands here.
  G.mode = 'playing';
  G.missions.index = 0; G.missions.step = 0;
  G.missions._describe();
  stageDrive(G, 0, -60, 0, 0);
  G.hud.showScreen(null);
}
