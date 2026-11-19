// Neon Harbor — boot and the one loop. The game object G carries everything the
// modules share; this file wires it up, runs the fixed-step simulation, owns the
// wanted level and the police response, the screens (title / playing / paused /
// busted / wasted / won) and the save. ?seed=N fixes the city. ?shot=start|play|
// chase|mission stages that scene (any other value stages play) instead of
// running the loop, paints it twice and
// sets window.__shotReady for a screenshot.

import { CAR, CITY, PLAYER, WANTED, angleDelta, clamp, dist2, makeRng, pick } from './config.js';
import { PLACES, buildWorld } from './world.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Cop, Ped, Player, Thug } from './entities.js';
import { Car, PoliceCar, TrafficCar, nearestCar } from './vehicles.js';
import { MissionManager } from './missions.js';
import { AudioSys } from './audio.js';
import { Hud } from './hud.js';
import { clearSave, loadSave, saveGame } from './save.js';
import { stageShot } from './shots.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;
const AUTOSAVE_SECONDS = 15;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const rng = makeRng(seed);

const G = {
  mode: 'title',
  elapsed: 0,
  cash: 0,
  wanted: 0,
  wantedTimer: 0,
  cameraYaw: Math.PI,
  camYawOffset: 0,
  camPitch: 5,
  shotFixedCamera: false,
  shotMode: !!shot,
  world: null,
  renderer: null,
  input: null,
  audio: new AudioSys(),
  hud: new Hud(),
  missions: null,
  player: null,
  cars: [],       // parked + stolen + the heist truck (drivable, not traffic)
  traffic: [],
  peds: [],
  thugs: [],
  cops: [],
  policeCars: [],
  autosaveTimer: AUTOSAVE_SECONDS,
  save: null,
};

function announce(message) { status.textContent = message; }

// --- spawning ---------------------------------------------------------------

function spawnParkedCar(x, z, heading, color) {
  const car = new Car(G, x, z, heading, color);
  G.cars.push(car);
  return car;
}

function spawnTrafficAt(x, z, loopIndex) {
  const loop = G.world.loops[loopIndex % G.world.loops.length];
  const car = new TrafficCar(G, loop, pick(rng, [0xffd23e, 0x39d5ff, 0xf2f2f2, 0x7dff9e]));
  car.x = x; car.z = z; car.syncMesh();
  G.traffic.push(car);
  return car;
}

function spawnThugsAt(x, z, n) {
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const thug = new Thug(G, x + Math.cos(a) * 6, z + Math.sin(a) * 6);
    G.thugs.push(thug);
  }
}

function clearDynamic() {
  const remove = (list) => {
    for (const e of list) {
      if (e.mesh) G.renderer.removeMesh(e.mesh);
    }
    list.length = 0;
  };
  remove(G.cars); remove(G.traffic); remove(G.peds);
  remove(G.thugs); remove(G.cops); remove(G.policeCars);
  if (G.player && G.player.mesh) G.renderer.removeMesh(G.player.mesh);
}

// --- wanted level + police --------------------------------------------------

function addWanted(n) {
  G.wanted = Math.min(WANTED.maxStars, G.wanted + n);
  G.wantedTimer = 0;
  syncPolice();
  G.audio.setSiren(G.wanted > 0);
}

function syncPolice(force = false) {
  const wantCars = Math.min(G.wanted, WANTED.maxPoliceCars);
  while (G.policeCars.length < wantCars) {
    const p = G.world.randomStreetPoint(rng);
    // Spawn away from the player so the chase arrives instead of appearing.
    if (Math.hypot(p.x - G.player.x, p.z - G.player.z) < 60 && !force) continue;
    G.policeCars.push(new PoliceCar(G, p.x, p.z));
  }
  while (G.policeCars.length > wantCars) {
    const car = G.policeCars.pop();
    G.renderer.removeMesh(car.mesh);
  }
  const wantCops = G.wanted >= 3 ? Math.min(G.wanted - 2, 3) : 0;
  while (G.cops.filter((c) => !c.dead).length < wantCops) {
    const a = rng() * Math.PI * 2;
    G.cops.push(new Cop(G, G.player.x + Math.cos(a) * 25, G.player.z + Math.sin(a) * 25));
  }
  while (G.cops.filter((c) => !c.dead).length > wantCops) {
    const cop = G.cops.find((c) => !c.dead);
    if (!cop) break;
    G.cops.splice(G.cops.indexOf(cop), 1);
    G.renderer.removeMesh(cop.mesh);
  }
}

function onNpcKilled(npc, kind) {
  if (kind === 'thug') {
    G.cash += 25;
    G.hud.toast('Crew down — +$25');
    G.missions.onThugDown();
  } else if (kind === 'cop') {
    addWanted(1);
    G.hud.toast('You dropped a cop — the heat is on');
  } else if (kind === 'ped') {
    addWanted(1);
  }
}

// --- world (re)build ---------------------------------------------------------

function resetWorld() {
  const keepMission = G.missions ? G.missions.index : 0;
  clearDynamic();
  G.wanted = 0;
  G.wantedTimer = 0;
  G.cars = []; G.traffic = []; G.peds = []; G.thugs = []; G.cops = []; G.policeCars = [];
  G.player = new Player(G, PLACES.cafe.x, PLACES.cafe.z - 8);
  // Parked cars from the city data, plus the heist truck in the Harbor Yard.
  for (const pc of G.world.parkedCars) spawnParkedCar(pc.x, pc.z, pc.heading, pc.color);
  const truck = new Car(G, PLACES.heistTruck.x, PLACES.heistTruck.z, Math.PI / 2, 0xd95f43, { truck: true });
  G.cars.push(truck);
  G.truck = truck;
  // Traffic and pedestrians.
  for (let i = 0; i < 8; i += 1) {
    const loop = G.world.loops[i % G.world.loops.length];
    const start = loop[Math.floor(rng() * loop.length)];
    const car = new TrafficCar(G, loop, pick(rng, [0xffd23e, 0x39d5ff, 0xf2f2f2, 0x7dff9e, 0xff7a3d]));
    car.x = start.x; car.z = start.z; car.syncMesh();
    G.traffic.push(car);
  }
  for (let i = 0; i < 12; i += 1) {
    const line = G.world.walkLines[i % G.world.walkLines.length];
    G.peds.push(new Ped(G, line, pick(rng, [0xe8b48a, 0x7fb5a8, 0xc9a0c4, 0xf2e3c6, 0x8fb8d8])));
  }
  G.missions = new MissionManager(G);
  if (keepMission > 0) {
    G.missions.index = Math.min(keepMission, 4);
    G.missions.step = 0;
    G.missions._describe();
  }
  G.cameraYaw = Math.PI;
  G.camYawOffset = 0;
  G.shotFixedCamera = false;
}

function syncAllMeshes() {
  const p = G.player;
  p.mesh.position.set(p.x, 0, p.z);
  p.mesh.rotation.y = -p.heading - Math.PI / 2;
  p.mesh.visible = p.onFoot;
  for (const list of [G.cars, G.traffic, G.policeCars]) for (const c of list) c.syncMesh();
  for (const list of [G.peds, G.thugs, G.cops]) {
    for (const n of list) {
      n.mesh.position.set(n.x, 0, n.z);
      n.mesh.rotation.y = -n.heading - Math.PI / 2;
    }
  }
}

// --- screens / save -----------------------------------------------------------

function saveGameNow() {
  saveGame({
    cash: G.cash,
    missionIndex: G.missions.index,
    health: Math.round(G.player.health),
    ammo: G.player.ammo,
    x: G.player.x,
    z: G.player.z,
  });
}

function applySave(save) {
  G.cash = save.cash;
  G.player.health = save.health;
  G.player.ammo = save.ammo;
  G.player.x = save.x;
  G.player.z = save.z;
  G.missions.index = Math.min(save.missionIndex, 4);
  G.missions.step = 0;
  G.missions._describe();
  G.hud.toast('Save loaded — welcome back, Rook');
}

function showEnd(title, sub, text) {
  document.getElementById('endTitle').textContent = title;
  document.getElementById('endSub').textContent = sub;
  document.getElementById('endText').textContent = text;
  G.hud.showScreen('endScreen');
}

function endGame(kind) {
  if (G.mode !== 'playing') return;
  G.audio.setSiren(false);
  G.audio.setEngine(0, false);
  if (kind === 'busted') {
    G.mode = 'busted';
    const fine = Math.min(G.cash, 100);
    G.cash -= fine;
    showEnd('BUSTED', 'THE HARBOR PD CAUGHT UP WITH ROOK',
      `Marina posts your $${fine} bail. The heat is off — for now.`);
    announce('Busted. The police caught you.');
  } else if (kind === 'wasted') {
    G.mode = 'wasted';
    const lost = Math.min(G.cash, 150);
    G.cash -= lost;
    showEnd('WASTED', 'ROOK GOT FLATLINED',
      `You wake up in the clinic minus $${lost} in hospital bills. The city is still yours to take.`);
    announce('Wasted. You were killed.');
  }
  saveGameNow();
}

function onStoryComplete() {
  G.mode = 'won';
  G.audio.setSiren(false);
  showEnd('HEIST COMPLETE', 'THE HARBOR IS YOURS',
    `Five jobs, one clean getaway. Marina wires the last cut — you walk away with $${G.cash.toLocaleString('en-US')}. Free roam continues: the city never sleeps.`);
  announce('Heist complete. The story is done — free roam continues.');
}

function respawn() {
  resetWorld();
  G.player.x = PLACES.cafe.x; G.player.z = PLACES.cafe.z - 8;
  G.player.health = PLAYER.maxHealth;
  G.mode = 'playing';
  G.hud.showScreen(null);
  announce('Playing.');
}

function startGame(fromSave) {
  G.audio.init();
  resetWorld();
  if (fromSave && G.save) applySave(G.save);
  G.mode = 'playing';
  G.hud.showScreen(null);
  G.hud.toast(fromSave ? 'Welcome back to Neon Harbor' : 'Marina: first job — pick up the package at the docks');
  announce('Playing. Follow the yellow waypoint.');
}

// --- one simulation step ------------------------------------------------------

function step(dt) {
  G.elapsed += dt;
  const p = G.player;
  const input = G.input;

  // Camera orbit from the mouse.
  const { dx, dy } = input.consumeMouse();
  G.camYawOffset += dx * 0.005;
  G.camPitch = clamp(G.camPitch + dy * 0.04, 2, 16);

  // Pause.
  if (input.hit('Escape') || input.hit('KeyP')) {
    G.mode = 'paused';
    G.hud.showScreen('pauseScreen');
    announce('Paused.');
    return;
  }

  // Interact / enter-exit car.
  if (input.hit('KeyE')) {
    if (!G.missions.tryInteract()) {
      if (p.onFoot) {
        const car = nearestCar(G, p.x, p.z, 3.6);
        if (car) p.enterCar(car);
        else G.hud.setHint('No car close enough — walk up to one and press E');
      } else {
        p.exitCar();
      }
    }
  }

  // Combat.
  if (input.hit('Space')) p.punch();
  if (input.clicked) p.shoot();
  if (input.hit('KeyR')) p.reload();

  // Player + driving.
  if (p.onFoot) {
    p.update(dt);
  } else {
    const dv = input.driveVector();
    p.car.drive(dt, dv.throttle, dv.steer);
    p.update(dt);
    // Running over pedestrians is a crime, even by accident.
    for (const ped of G.peds) {
      if (ped.dead) continue;
      if (dist2(p.x, p.z, ped.x, ped.z) < 4.8) {
        ped.die();
        G.audio.thud();
        G.renderer.addShake(0.4);
      }
    }
    // Bumping traffic cars slows both down.
    for (const t of G.traffic) {
      if (dist2(p.car.x, p.car.z, t.x, t.z) < 13) {
        t.shove(p.car.x, p.car.z, 0.15);
        p.car.speed *= 0.995;
      }
    }
  }

  // World life.
  for (const t of G.traffic) t.update(dt);
  for (const ped of G.peds) ped.update(dt);
  for (const thug of G.thugs) thug.update(dt);
  for (const cop of G.cops) cop.update(dt);
  for (const pc of G.policeCars) pc.update(dt);

  // Wanted decay: out of every cop's sight long enough, the heat cools.
  if (G.wanted > 0) {
    const nearest = [...G.policeCars, ...G.cops].filter((c) => !c.dead)
      .reduce((m, c) => Math.min(m, Math.hypot(c.x - p.x, c.z - p.z)), Infinity);
    if (nearest > WANTED.sightRange) {
      G.wantedTimer += dt;
      if (G.wantedTimer >= WANTED.decaySeconds) {
        G.wanted -= 1;
        G.wantedTimer = 0;
        syncPolice();
        G.audio.setSiren(G.wanted > 0);
        if (G.wanted === 0) G.hud.toast('You lost them — heat is off');
      }
    } else {
      G.wantedTimer = 0;
    }
  }

  // Missions.
  G.missions.update(dt);

  // Engine + siren follow the driving.
  const driving = !p.onFoot;
  G.audio.setEngine(driving ? Math.abs(p.car.speed) / CAR.maxSpeed : 0, driving);
  G.audio.setSiren(G.wanted > 0);

  // Autosave.
  G.autosaveTimer -= dt;
  if (G.autosaveTimer <= 0) {
    G.autosaveTimer = AUTOSAVE_SECONDS;
    saveGameNow();
  }

  // Hint line: what E does right now.
  if (p.onFoot) {
    const car = nearestCar(G, p.x, p.z, 3.6);
    if (G.missions.target && Math.hypot(p.x - G.missions.target.x, p.z - G.missions.target.z) < 6) {
      G.hud.setHint('Press E — mission action');
    } else if (car) {
      G.hud.setHint(car.stolen || car.owned ? 'Press E — get in' : 'Press E — steal car');
    } else {
      G.hud.setHint('');
    }
  } else {
    G.hud.setHint('Press E — get out   ·   W/S drive   ·   A/D steer');
  }
}

// --- frame --------------------------------------------------------------------

function updateCamera(dt) {
  if (G.shotFixedCamera) return;
  const p = G.player;
  const heading = p.car ? p.car.heading : p.heading;
  const targetYaw = heading + Math.PI + G.camYawOffset;
  G.cameraYaw += angleDelta(G.cameraYaw, targetYaw) * Math.min(1, dt * 2.5);
  const dist = p.onFoot ? 7.5 : 12.5;
  const height = p.onFoot ? 3.4 : 4.2;
  G.renderer.updateCamera(dt, { x: p.x, z: p.z, heading }, G.cameraYaw, G.camPitch, dist, height);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, MAX_FRAME);
  last = now;
  if (G.mode === 'playing') {
    accumulator += dt;
    while (accumulator >= STEP) {
      step(STEP);
      accumulator -= STEP;
      if (G.mode !== 'playing') { accumulator = 0; break; }
    }
    updateCamera(dt);
  } else if (G.mode === 'title' && !G.shotFixedCamera) {
    // The title backdrop stays alive: traffic rolls, peds wander, camera drifts.
    accumulator += dt;
    while (accumulator >= STEP) {
      for (const t of G.traffic) t.update(STEP);
      for (const ped of G.peds) ped.update(STEP);
      accumulator -= STEP;
    }
    G.cameraYaw += dt * 0.02;
    G.renderer.updateCamera(dt, { x: 0, z: 0, heading: 0 }, G.cameraYaw, 30, 150, 60);
  }
  G.renderer.update(dt, G.elapsed);
  G.renderer.render();
  G.hud.update(G, dt);
  G.input.endFrame();
}

// --- boot ---------------------------------------------------------------------

let last = performance.now();
let accumulator = 0;

G.world = buildWorld(seed);
G.renderer = new Renderer(canvas, G.world);
G.input = new Input(canvas);
G.save = loadSave();

G.addWanted = addWanted;
G.syncPolice = syncPolice;
G.onNpcKilled = onNpcKilled;
G.spawnThugsAt = spawnThugsAt;
G.spawnParkedCar = spawnParkedCar;
G.spawnTrafficAt = spawnTrafficAt;
G.endGame = endGame;
G.onStoryComplete = onStoryComplete;
G.saveGame = saveGameNow;
G.resetWorld = resetWorld;
G.syncAllMeshes = syncAllMeshes;

resetWorld();

document.getElementById('btnStart').addEventListener('click', () => startGame(false));
const btnContinue = document.getElementById('btnContinue');
if (G.save) {
  btnContinue.classList.remove('hidden');
  btnContinue.addEventListener('click', () => startGame(true));
}
document.getElementById('btnResume').addEventListener('click', () => {
  G.mode = 'playing';
  G.hud.showScreen(null);
  announce('Playing.');
});
document.getElementById('btnQuitTitle').addEventListener('click', () => {
  saveGameNow();
  clearSave();
  G.mode = 'title';
  resetWorld();
  G.hud.showScreen('titleScreen');
});
document.getElementById('btnRespawn').addEventListener('click', () => respawn());
document.getElementById('btnEndTitle').addEventListener('click', () => {
  saveGameNow();
  G.mode = 'title';
  resetWorld();
  G.hud.showScreen('titleScreen');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && G.mode === 'playing') {
    G.mode = 'paused';
    G.hud.showScreen('pauseScreen');
    announce('Paused.');
  }
});

if (shot) {
  stageShot(shot, G);
  syncAllMeshes();
  // Snap the third-person camera behind the player (the start shot places its
  // own fixed high camera instead, so skip it there).
  if (!G.shotFixedCamera) updateCamera(1);
  let painted = 0;
  (function paint() {
    G.renderer.update(1 / 60, G.elapsed);
    G.renderer.render();
    G.hud.update(G, 1 / 60);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  })();
} else {
  G.hud.showScreen('titleScreen');
  announce('Neon Harbor. Press Start Engine to play.');
  requestAnimationFrame(frame);
}
