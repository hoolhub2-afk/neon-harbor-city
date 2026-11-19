// Neon Harbor — cars. Arcade driving for the player, loop traffic for the city,
// and police interceptors that chase the player when the wanted level is up.
// A car is a mesh from the renderer plus a heading, a speed and a little physics.

import { CAR, angleDelta, clamp, dist2 } from './config.js';

export class Car {
  constructor(G, x, z, heading, color, opts = {}) {
    this.G = G;
    this.x = x; this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.color = color;
    this.police = !!opts.police;
    this.truck = !!opts.truck;
    this.stolen = false;      // true once the player has taken it
    this.owned = !!opts.owned;
    this.mesh = opts.truck
      ? G.renderer.makeTruckMesh(color)
      : G.renderer.makeCarMesh(color, this.police);
    this.syncMesh();
  }

  syncMesh() {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = -this.heading - Math.PI / 2;
    const wheels = this.mesh.userData.wheels;
    if (wheels) {
      for (const w of wheels) w.rotation.y = this.speed * 0.12;
    }
  }

  // Arcade step: throttle -1..1, steer -1..1. Returns true on a hard hit.
  drive(dt, throttle, steer) {
    const maxF = this.truck ? CAR.maxSpeed * 0.72 : CAR.maxSpeed;
    if (throttle > 0) this.speed += CAR.accel * throttle * dt;
    else if (throttle < 0) {
      if (this.speed > 0.5) this.speed -= CAR.brake * dt;
      else this.speed += CAR.reverseAccel * throttle * dt;
    } else {
      // Rolling drag.
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 6 * dt);
    }
    this.speed = clamp(this.speed, -CAR.maxReverse, maxF);
    const steerAmount = steer * CAR.turnRate * clamp(Math.abs(this.speed) / 8, 0, 1) * (this.speed >= 0 ? 1 : -1);
    this.heading += steerAmount * dt;
    const nx = this.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.z + Math.cos(this.heading) * this.speed * dt;
    const p = { x: nx, z: nz };
    const hit = this.G.world.collideCircle(p, CAR.radius);
    if (hit) {
      if (Math.abs(this.speed) > 10) {
        this.G.audio.crash();
        this.G.renderer.burst(this.x, 1, this.z, 0xffd23e, 10, 4);
        this.G.renderer.addShake(0.4);
      }
      this.speed *= 0.45;
    }
    this.x = p.x; this.z = p.z;
    this.syncMesh();
    return hit;
  }

  // Push this car away from another circle (traffic bumps, police rams).
  shove(fromX, fromZ, force) {
    const dx = this.x - fromX, dz = this.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    this.x += (dx / d) * force;
    this.z += (dz / d) * force;
    const p = { x: this.x, z: this.z };
    this.G.world.collideCircle(p, CAR.radius);
    this.x = p.x; this.z = p.z;
    this.syncMesh();
  }
}

// A traffic car: follows one of the world's rectangular loops forever.
export class TrafficCar extends Car {
  constructor(G, loop, color) {
    const start = loop[0];
    super(G, start.x, start.z, 0, color);
    this.loop = loop;
    this.wp = 1;
    this.cruise = 8 + Math.random() * 4;
    this.wait = 0;
  }

  update(dt) {
    const G = this.G;
    const target = this.loop[this.wp];
    const dx = target.x - this.x, dz = target.z - this.z;
    const d = Math.hypot(dx, dz);
    const wantHeading = Math.atan2(dx, dz);
    this.heading += angleDelta(this.heading, wantHeading) * Math.min(1, dt * 3.2);
    // Slow for the car ahead (player or traffic) so the streets don't pile up.
    let blocked = false;
    for (const other of [...G.cars, ...G.traffic]) {
      if (other === this) continue;
      const od = dist2(this.x, this.z, other.x, other.z);
      if (od < 49) {
        const ox = other.x - this.x, oz = other.z - this.z;
        const ahead = ox * Math.sin(this.heading) + oz * Math.cos(this.heading);
        if (ahead > 0 && od < 64) { blocked = true; break; }
      }
    }
    const targetSpeed = blocked ? 0 : this.cruise;
    this.speed += clamp(targetSpeed - this.speed, -10 * dt, 6 * dt);
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;
    const p = { x: this.x, z: this.z };
    G.world.collideCircle(p, CAR.radius);
    this.x = p.x; this.z = p.z;
    if (d < 2.5) this.wp = (this.wp + 1) % this.loop.length;
    // Soft collisions with other cars.
    for (const other of [...G.cars, ...G.traffic]) {
      if (other === this) continue;
      const od2 = dist2(this.x, this.z, other.x, other.z);
      if (od2 < 12.5) this.shove(other.x, other.z, 0.12);
    }
    this.syncMesh();
  }
}

// A police interceptor: steers at the player and rams. Siren lights flash.
export class PoliceCar extends Car {
  constructor(G, x, z) {
    super(G, x, z, 0, 0xf2f2f2, { police: true });
    this.flash = 0;
  }

  update(dt) {
    const G = this.G;
    const player = G.player;
    const dx = player.x - this.x, dz = player.z - this.z;
    const d = Math.hypot(dx, dz);
    const wantHeading = Math.atan2(dx, dz);
    this.heading += angleDelta(this.heading, wantHeading) * Math.min(1, dt * 2.6);
    const targetSpeed = Math.min(15 + G.wanted * 1.6, 24);
    this.speed += clamp(targetSpeed - this.speed, -12 * dt, 9 * dt);
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;
    const p = { x: this.x, z: this.z };
    const hitWall = G.world.collideCircle(p, CAR.radius);
    if (hitWall) this.speed *= 0.6;
    this.x = p.x; this.z = p.z;
    // Ram the player's car, or knock the player down on foot.
    if (player.car) {
      const cd = Math.hypot(player.car.x - this.x, player.car.z - this.z);
      if (cd < 4.2) {
        player.car.shove(this.x, this.z, 0.5);
        player.car.speed *= 0.85;
        this.speed *= 0.7;
        if (Math.abs(this.speed) > 6) {
          G.audio.crash();
          G.renderer.burst(player.car.x, 1, player.car.z, 0xffd23e, 8, 4);
          G.renderer.addShake(0.3);
        }
      }
    } else if (d < 2.6) {
      player.damage(18, this.x, this.z);
      player.x += Math.sin(this.heading) * 1.5;
      player.z += Math.cos(this.heading) * 1.5;
      this.speed *= 0.5;
    }
    // Siren light bar: red / blue alternate.
    this.flash += dt * 7;
    const on = Math.floor(this.flash) % 2 === 0;
    if (this.mesh.userData.lightL) this.mesh.userData.lightL.visible = on;
    if (this.mesh.userData.lightR) this.mesh.userData.lightR.visible = !on;
    this.syncMesh();
  }
}

// Find the nearest drivable car (player's own, parked, or traffic) to a point.
export function nearestCar(G, x, z, maxDist) {
  let best = null, bestD = maxDist * maxDist;
  for (const car of [...G.cars, ...G.traffic]) {
    const d2 = dist2(x, z, car.x, car.z);
    if (d2 < bestD) { bestD = d2; best = car; }
  }
  return best;
}
