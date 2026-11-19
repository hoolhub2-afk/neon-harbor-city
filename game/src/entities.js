// Neon Harbor — the people. The player on foot, pedestrians who wander and flee,
// thugs who fight, and police on foot who chase and arrest. Each one owns a mesh
// from the renderer and a small update() the main loop calls with the game state.

import { PLAYER, clamp, dist2, angleDelta } from './config.js';

function syncPersonMesh(mesh, x, z, heading, moving, dt) {
  mesh.position.set(x, 0, z);
  mesh.rotation.y = -heading - Math.PI / 2;
  const u = mesh.userData;
  if (moving) {
    u.walkPhase += dt * 10;
    const s = Math.sin(u.walkPhase) * 0.55;
    u.legL.rotation.z = s; u.legR.rotation.z = -s;
    u.armL.rotation.z = -s * 0.7; u.armR.rotation.z = s * 0.7;
  } else {
    u.legL.rotation.z *= 0.8; u.legR.rotation.z *= 0.8;
    u.armL.rotation.z *= 0.8; u.armR.rotation.z *= 0.8;
  }
}

export class Player {
  constructor(G, x, z) {
    this.G = G;
    this.x = x; this.z = z;
    this.heading = Math.PI; // facing north into the city
    this.speed = 0;
    this.health = PLAYER.maxHealth;
    this.ammo = PLAYER.magSize;
    this.reloading = 0;
    this.punchCooldown = 0;
    this.invulnerable = 0;
    this.car = null;        // the Car being driven, or null on foot
    this.mesh = G.renderer.makePersonMesh('player', 0x2e8b8b);
    this.mesh.visible = true;
  }

  get onFoot() { return this.car === null; }

  enterCar(car, silent = false) {
    const G = this.G;
    if (this.car) return false;
    // A traffic car leaves the traffic pool and becomes the player's ride.
    const ti = G.traffic.indexOf(car);
    if (ti !== -1) G.traffic.splice(ti, 1);
    if (!G.cars.includes(car)) G.cars.push(car);
    this.car = car;
    this.heading = car.heading;
    this.x = car.x;
    this.z = car.z;
    if (!car.owned && !car.stolen) {
      car.stolen = true;
      const policeNear = [...G.policeCars, ...G.cops].some(
        (c) => !c.dead && Math.hypot(c.x - this.x, c.z - this.z) < 46);
      if (policeNear) {
        G.addWanted(1);
        G.hud.toast('Car stolen — the law saw you!');
      } else {
        G.hud.toast('Car stolen');
      }
    }
    this.mesh.visible = false;
    G.missions.onEnterCar();
    if (!silent) G.audio.setEngine(0, true);
    return true;
  }

  exitCar() {
    const G = this.G;
    if (!this.car) return;
    const car = this.car;
    car.speed = 0;
    this.car = null;
    // Step out to the side of the car.
    this.x = car.x + Math.cos(car.heading) * 2.2;
    this.z = car.z - Math.sin(car.heading) * 2.2;
    const p = { x: this.x, z: this.z };
    G.world.collideCircle(p, 0.55);
    this.x = p.x; this.z = p.z;
    this.heading = car.heading;
    this.mesh.visible = true;
    G.audio.setEngine(0, false);
  }

  update(dt) {
    const G = this.G, input = G.input;
    if (this.invulnerable > 0) this.invulnerable -= dt;
    if (this.punchCooldown > 0) this.punchCooldown -= dt;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) { this.ammo = PLAYER.magSize; G.hud.flashAmmo(); }
    }
    if (!this.onFoot) {
      // Driving: the mesh hides inside the car; position follows the car.
      this.x = this.car.x; this.z = this.car.z; this.heading = this.car.heading;
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const mv = input.moveVector();
    const running = input.down('ShiftLeft') || input.down('ShiftRight');
    const speed = running ? PLAYER.runSpeed : PLAYER.walkSpeed;
    // Movement is relative to the camera yaw.
    const camYaw = G.cameraYaw;
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    const mx = fx * mv.y + rx * mv.x;
    const mz = fz * mv.y + rz * mv.x;
    const moving = Math.hypot(mx, mz) > 0.01;
    if (moving) {
      const targetHeading = Math.atan2(mx, mz);
      this.heading += angleDelta(this.heading, targetHeading) * Math.min(1, dt * 12);
      const p = { x: this.x + mx * speed * dt, z: this.z + mz * speed * dt };
      G.world.collideCircle(p, PLAYER.radius);
      this.x = p.x; this.z = p.z;
      this.speed = speed;
    } else {
      this.speed = 0;
    }
    syncPersonMesh(this.mesh, this.x, this.z, this.heading, moving, dt);
  }

  punch() {
    if (this.punchCooldown > 0 || !this.onFoot) return false;
    this.punchCooldown = PLAYER.punchCooldown;
    this.G.audio.punch();
    const G = this.G;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let hitAny = false;
    for (const npc of [...G.thugs, ...G.cops, ...G.peds]) {
      if (npc.dead) continue;
      const d = Math.hypot(npc.x - this.x, npc.z - this.z);
      if (d > PLAYER.punchRange) continue;
      const dot = ((npc.x - this.x) * fx + (npc.z - this.z) * fz) / Math.max(d, 0.01);
      if (dot < 0.3) continue;
      npc.damage(PLAYER.punchDamage, this.x, this.z);
      G.renderer.burst(npc.x, 1.2, npc.z, 0xffe9a8, 8, 3);
      hitAny = true;
    }
    return hitAny;
  }

  shoot() {
    const G = this.G;
    if (!this.onFoot || this.reloading > 0) return;
    if (this.ammo <= 0) { G.audio.click(); this.reload(); return; }
    this.ammo -= 1;
    G.audio.gunshot();
    G.renderer.addShake(0.25);
    // Muzzle flash at the player's hand, toward the camera aim.
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    G.renderer.burst(this.x + fx * 0.8, 1.4, this.z + fz * 0.8, 0xffd23e, 6, 5);
    // Hit the nearest NPC near the aim ray.
    let best = null, bestD = PLAYER.shootRange;
    for (const npc of [...G.thugs, ...G.cops, ...G.peds]) {
      if (npc.dead) continue;
      const dx = npc.x - this.x, dz = npc.z - this.z;
      const along = dx * fx + dz * fz;
      if (along < 0.5 || along > PLAYER.shootRange) continue;
      const perp = Math.abs(dx * fz - dz * fx);
      if (perp > 1.3) continue;
      if (along < bestD) { bestD = along; best = npc; }
    }
    if (best) {
      best.damage(PLAYER.shootDamage, this.x, this.z);
      G.renderer.burst(best.x, 1.3, best.z, 0xff5a5a, 10, 4);
    }
    G.hud.flashAmmo();
  }

  reload() {
    if (this.ammo === PLAYER.magSize || this.reloading > 0) return;
    this.reloading = PLAYER.reloadTime;
    this.G.audio.click();
  }

  damage(amount, fromX, fromZ) {
    if (this.invulnerable > 0 || !this.onFoot) return;
    this.health = Math.max(0, this.health - amount);
    this.invulnerable = 0.5;
    this.G.audio.thud();
    this.G.renderer.addShake(0.5);
    this.G.hud.flashDamage();
    if (this.health <= 0) this.G.endGame('wasted');
  }
}

// A pedestrian: wanders a sidewalk loop, flees from gunfire and sirens.
export class Ped {
  constructor(G, line, color) {
    this.G = G;
    this.line = line;
    this.wp = 0;
    this.x = line[0].x; this.z = line[0].z;
    this.heading = 0;
    this.speed = 1.4 + Math.random() * 0.8;
    this.health = 30;
    this.dead = false;
    this.fleeing = false;
    this.fleeTimer = 0;
    this.mesh = G.renderer.makePersonMesh('ped', color);
  }

  damage(amount, fromX, fromZ) {
    this.health -= amount;
    this.fleeing = true; this.fleeTimer = 3;
    if (this.health <= 0) this.die();
    else this.G.audio.yelp();
  }

  die() {
    this.dead = true;
    this.mesh.rotation.x = Math.PI / 2 - 0.15;
    this.mesh.position.y = 0.3;
    this.G.onNpcKilled(this, 'ped');
  }

  update(dt) {
    if (this.dead) return;
    const G = this.G;
    if (this.fleeTimer > 0) this.fleeTimer -= dt;
    else this.fleeing = false;
    // Flee from the player when the player is violent or the sirens are close.
    const pd = Math.hypot(G.player.x - this.x, G.player.z - this.z);
    if (G.wanted > 0 && pd < 14) { this.fleeing = true; this.fleeTimer = 1.5; }
    let tx, tz, speed = this.speed;
    if (this.fleeing) {
      const dx = this.x - G.player.x, dz = this.z - G.player.z;
      const d = Math.hypot(dx, dz) || 1;
      tx = this.x + (dx / d) * 10; tz = this.z + (dz / d) * 10;
      speed = 4.2;
    } else {
      const target = this.line[this.wp];
      tx = target.x; tz = target.z;
      if (Math.hypot(tx - this.x, tz - this.z) < 1.2) this.wp = (this.wp + 1) % this.line.length;
    }
    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      this.heading += angleDelta(this.heading, Math.atan2(dx, dz)) * Math.min(1, dt * 6);
      this.x += Math.sin(this.heading) * speed * dt;
      this.z += Math.cos(this.heading) * speed * dt;
      const p = { x: this.x, z: this.z };
      G.world.collideCircle(p, 0.5);
      this.x = p.x; this.z = p.z;
    }
    syncPersonMesh(this.mesh, this.x, this.z, this.heading, d > 0.05, dt);
  }
}

// A thug: stands at a spot until provoked, then closes in and punches.
export class Thug {
  constructor(G, x, z) {
    this.G = G;
    this.x = x; this.z = z;
    this.homeX = x; this.homeZ = z;
    this.heading = Math.random() * Math.PI * 2;
    this.health = 60;
    this.dead = false;
    this.attackCooldown = 0;
    this.aggro = false;
    this.mesh = G.renderer.makePersonMesh('thug', 0x3a1f1f);
  }

  damage(amount, fromX, fromZ) {
    this.health -= amount;
    this.aggro = true;
    if (this.health <= 0) this.die();
  }

  die() {
    this.dead = true;
    this.mesh.rotation.x = Math.PI / 2 - 0.15;
    this.mesh.position.y = 0.3;
    this.G.onNpcKilled(this, 'thug');
  }

  update(dt) {
    if (this.dead) return;
    const G = this.G;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    const pd = Math.hypot(G.player.x - this.x, G.player.z - this.z);
    if (pd < 22 || this.aggro) this.aggro = true;
    let moving = false;
    if (this.aggro && G.player.onFoot) {
      const dx = G.player.x - this.x, dz = G.player.z - this.z;
      const d = Math.hypot(dx, dz);
      this.heading += angleDelta(this.heading, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
      if (d > 1.6) {
        this.x += Math.sin(this.heading) * 4.6 * dt;
        this.z += Math.cos(this.heading) * 4.6 * dt;
        const p = { x: this.x, z: this.z };
        G.world.collideCircle(p, 0.5);
        this.x = p.x; this.z = p.z;
        moving = true;
      } else if (this.attackCooldown <= 0) {
        this.attackCooldown = 1.1;
        G.player.damage(9, this.x, this.z);
        G.audio.punch();
      }
    } else if (!this.aggro) {
      // Idle sway near home.
      const dx = this.homeX - this.x, dz = this.homeZ - this.z;
      if (Math.hypot(dx, dz) > 2) {
        this.heading += angleDelta(this.heading, Math.atan2(dx, dz)) * Math.min(1, dt * 4);
        this.x += Math.sin(this.heading) * 1.2 * dt;
        this.z += Math.cos(this.heading) * 1.2 * dt;
        moving = true;
      }
    }
    syncPersonMesh(this.mesh, this.x, this.z, this.heading, moving, dt);
  }
}

// A police officer on foot: chases the player and arrests them up close.
export class Cop {
  constructor(G, x, z) {
    this.G = G;
    this.x = x; this.z = z;
    this.heading = 0;
    this.health = 80;
    this.dead = false;
    this.arrestTimer = 0;
    this.attackCooldown = 0;
    this.mesh = G.renderer.makePersonMesh('cop', 0x1e3a5f);
  }

  damage(amount, fromX, fromZ) {
    this.health -= amount;
    if (this.health <= 0) this.die();
  }

  die() {
    this.dead = true;
    this.mesh.rotation.x = Math.PI / 2 - 0.15;
    this.mesh.position.y = 0.3;
    this.G.onNpcKilled(this, 'cop');
  }

  update(dt) {
    if (this.dead) return;
    const G = this.G;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    const player = G.player;
    const dx = player.x - this.x, dz = player.z - this.z;
    const d = Math.hypot(dx, dz);
    this.heading += angleDelta(this.heading, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
    let moving = false;
    if (player.onFoot && d > 1.8) {
      const speed = 6.4;
      this.x += Math.sin(this.heading) * speed * dt;
      this.z += Math.cos(this.heading) * speed * dt;
      const p = { x: this.x, z: this.z };
      G.world.collideCircle(p, 0.5);
      this.x = p.x; this.z = p.z;
      moving = true;
    } else if (player.onFoot && d <= 1.8) {
      // Close and the player is slow: the arrest timer runs.
      if (player.speed < 1.5) {
        this.arrestTimer += dt;
        if (this.arrestTimer > 1.6) G.endGame('busted');
      } else this.arrestTimer = 0;
      if (this.attackCooldown <= 0) {
        this.attackCooldown = 1.0;
        player.damage(7, this.x, this.z);
      }
    } else {
      // Player is driving: cops on foot hold their ground and radio it in.
      this.arrestTimer = 0;
    }
    syncPersonMesh(this.mesh, this.x, this.z, this.heading, moving, dt);
  }
}

export { clamp, dist2 };
