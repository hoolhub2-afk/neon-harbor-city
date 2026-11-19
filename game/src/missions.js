// Neon Harbor — the five-mission story chain. Marina the fixer gives Rook the jobs;
// the manager tracks the current objective, the waypoint, the timers and the payouts.
// Missions: 1 courier pickup, 2 timed getaway drive, 3 debt collection, 4 ambush
// fight, 5 harbor heist finale. Free roam continues after the last one.

import { MISSIONS } from './config.js';
import { PLACES } from './world.js';

const REACH = 4.5; // how close the player must get to a waypoint

export class MissionManager {
  constructor(G) {
    this.G = G;
    this.index = 0;          // 0..4, 5 means the chain is done
    this.step = 0;
    this.timer = 0;
    this.debtorsLeft = 3;
    this.thugsLeft = 0;
    this.done = false;
    this.target = null;      // {x, z, label}
    this.objective = '';
    this._describe();
  }

  get current() { return MISSIONS[this.index] || null; }
  get finished() { return this.index >= MISSIONS.length; }

  // Set the objective text and waypoint for the current step.
  _describe() {
    const G = this.G;
    if (this.finished) {
      this.objective = 'Free roam — Neon Harbor is yours.';
      this.target = null;
      return;
    }
    const m = this.index;
    if (m === 0) {
      if (this.step === 0) {
        this.objective = 'Pick up the package at Harbor Docks (E)';
        this.target = { x: PLACES.docksPickup.x, z: PLACES.docksPickup.z, label: 'Pickup' };
      } else {
        this.objective = 'Bring the package back to Marina\'s Cafe';
        this.target = { x: PLACES.cafe.x, z: PLACES.cafe.z, label: 'Cafe' };
      }
    } else if (m === 1) {
      if (this.step === 0) {
        this.objective = 'Get in a car — any car';
        this.target = null;
      } else {
        const pts = [PLACES.heights, PLACES.checkpointB, PLACES.checkpointC];
        const p = pts[this.step - 1];
        this.objective = `Getaway: hit checkpoint ${this.step} of 3 — ${Math.ceil(this.timer)}s left`;
        this.target = { x: p.x, z: p.z, label: `Checkpoint ${this.step}` };
      }
    } else if (m === 2) {
      const debtors = [PLACES.debtorA, PLACES.debtorB, PLACES.debtorC];
      const p = debtors[3 - this.debtorsLeft];
      this.objective = `Collect the debt — ${this.debtorsLeft} left (E near the debtor)`;
      this.target = { x: p.x, z: p.z, label: 'Debtor' };
    } else if (m === 3) {
      if (this.step === 0) {
        this.objective = 'Go to the Old Cannery — something feels wrong';
        this.target = { x: PLACES.cannery.x, z: PLACES.cannery.z, label: 'Cannery' };
      } else {
        this.objective = `Ambush! Take down the crew — ${this.thugsLeft} left`;
        this.target = { x: PLACES.cannery.x, z: PLACES.cannery.z, label: 'Cannery' };
      }
    } else if (m === 4) {
      if (this.step === 0) {
        this.objective = 'Steal the box truck in the Harbor Yard (E)';
        this.target = { x: PLACES.heistTruck.x, z: PLACES.heistTruck.z, label: 'Truck' };
      } else {
        this.objective = 'Lose the heat — deliver the truck to North Depot';
        this.target = { x: PLACES.dropoff.x, z: PLACES.dropoff.z, label: 'Drop-off' };
      }
    }
    G.renderer.setBeacon(this.target ? this.target.x : 0, this.target ? this.target.z : 0, !!this.target);
  }

  // The E key near a mission spot: pickup, debt, or the heist truck.
  // Returns true when it consumed the press.
  tryInteract() {
    const G = this.G, p = G.player;
    if (this.finished || !p.onFoot) return false;
    if (!this.target) return false;
    const d = Math.hypot(p.x - this.target.x, p.z - this.target.z);
    if (d > REACH + 1.5) return false;
    if (this.index === 0 && this.step === 0) {
      this.step = 1;
      G.hud.toast('Package secured — get it to Marina');
      G.audio.pickup();
      this._describe();
      return true;
    }
    if (this.index === 2) {
      this.debtorsLeft -= 1;
      G.cash += 150;
      G.hud.toast('Debt collected: +$150');
      G.audio.pickup();
      if (this.debtorsLeft === 0) this._complete(250, 'All debts settled');
      else this._describe();
      return true;
    }
    if (this.index === 4 && this.step === 0) {
      this.step = 1;
      G.addWanted(2);
      G.hud.toast('Truck stolen — the whole harbor is after you');
      G.audio.sirenBurst();
      this._describe();
      return true;
    }
    return false;
  }

  // Called when the player enters any car (mission 2 watches for it).
  onEnterCar() {
    if (this.index === 1 && this.step === 0) {
      this.step = 1;
      this.timer = 90;
      this.G.hud.toast('Getaway started — 90 seconds, 3 checkpoints');
      this._describe();
    }
  }

  // Called by the game when a thug dies during the ambush.
  onThugDown() {
    if (this.index !== 3 || this.step !== 1) return;
    this.thugsLeft -= 1;
    if (this.thugsLeft <= 0) this._complete(0, 'Crew dealt with');
    else this._describe();
  }

  update(dt) {
    const G = this.G, p = G.player;
    if (this.finished) return;
    // Timed getaway.
    if (this.index === 1 && this.step >= 1) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.step = 0; this.timer = 0;
        G.hud.toast('Too slow — the getaway is blown. Get in a car to retry');
        this._describe();
        return;
      }
      this._describe(); // refresh the countdown text
    }
    if (!this.target) return;
    const d = Math.hypot(p.x - this.target.x, p.z - this.target.z);
    if (d > REACH) return;
    // Arrived at a waypoint.
    if (this.index === 0 && this.step === 1) {
      this._complete(0, 'Package delivered');
    } else if (this.index === 1 && this.step >= 1) {
      if (this.step === 3) {
        this._complete(0, 'Clean getaway');
      } else {
        this.step += 1;
        G.hud.toast(`Checkpoint ${this.step - 1} cleared`);
        G.audio.pickup();
        this._describe();
      }
    } else if (this.index === 3 && this.step === 0) {
      this.step = 1;
      this.thugsLeft = 4;
      G.spawnThugsAt(PLACES.cannery.x, PLACES.cannery.z, 4);
      G.hud.toast('Ambush! The crew jumps you');
      G.audio.sirenBurst();
      this._describe();
    } else if (this.index === 4 && this.step === 1) {
      if (p.car && p.car.truck) this._complete(0, 'Heist complete');
      else G.hud.toast('Bring the truck — on foot it stays here');
    }
  }

  _complete(bonus, line) {
    const G = this.G;
    const reward = MISSIONS[this.index].reward + bonus;
    G.cash += reward;
    G.audio.jingle();
    G.hud.toast(`${line} — +$${reward}`);
    G.saveGame();
    this.index += 1;
    this.step = 0;
    this.timer = 0;
    if (this.index === 3) this.debtorsLeft = 3;
    if (this.index >= MISSIONS.length) {
      this.done = true;
      G.onStoryComplete();
    }
    this._describe();
  }
}
