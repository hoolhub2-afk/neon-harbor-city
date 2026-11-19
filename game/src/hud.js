// Neon Harbor — the DOM HUD and the minimap. Cash, wanted stars, health, ammo and
// speed live in the page's DOM (cheap to update, readable in screenshots); the
// minimap is a small 2D canvas drawn north-up: roads, sea, the player arrow, cars,
// police and the mission waypoint.

import { CITY, STREETS } from './config.js';

export class Hud {
  constructor() {
    this.cashEl = document.getElementById('cash');
    this.starsEl = document.getElementById('stars');
    this.healthBar = document.getElementById('healthBar');
    this.healthLabel = document.getElementById('healthLabel');
    this.ammoLine = document.getElementById('ammoLine');
    this.speedLine = document.getElementById('speedLine');
    this.objTitle = document.getElementById('objTitle');
    this.objText = document.getElementById('objText');
    this.objDist = document.getElementById('objDist');
    this.toastEl = document.getElementById('toast');
    this.hintEl = document.getElementById('hint');
    this.clockEl = document.getElementById('clock');
    this.damageEl = document.getElementById('damage');
    this.crosshair = document.getElementById('crosshair');
    this.minimap = document.getElementById('minimap');
    this.mm = this.minimap.getContext('2d');
    this._toastTimer = 0;
    this._lastCash = -1;
    this._lastStars = -1;
    this._lastHealth = -1;
    this._lastAmmo = '';
    this._lastObjective = '';
  }

  toast(text, ms = 3200) {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = '1';
    window.clearTimeout(this._toastTimer);
    this._toastTimer = window.setTimeout(() => { this.toastEl.style.opacity = '0'; }, ms);
  }

  flashDamage() {
    this.damageEl.style.transition = 'none';
    this.damageEl.style.opacity = '1';
    requestAnimationFrame(() => {
      this.damageEl.style.transition = 'opacity .6s';
      this.damageEl.style.opacity = '0';
    });
  }

  flashAmmo() { this._lastAmmo = ''; }

  setHint(text) { this.hintEl.textContent = text || ''; }

  showScreen(name) {
    for (const id of ['titleScreen', 'pauseScreen', 'endScreen']) {
      document.getElementById(id).classList.toggle('hidden', id !== name);
    }
    const hudVisible = name === null;
    for (const id of ['topLeft', 'topRight', 'objective', 'bottomLeft', 'hint', 'toast']) {
      document.getElementById(id).style.display = hudVisible ? '' : 'none';
    }
  }

  update(G, dt) {
    const p = G.player;
    if (G.cash !== this._lastCash) {
      this._lastCash = G.cash;
      this.cashEl.textContent = `$${G.cash.toLocaleString('en-US')}`;
    }
    if (G.wanted !== this._lastStars) {
      this._lastStars = G.wanted;
      let html = '';
      for (let i = 0; i < 5; i += 1) {
        html += i < G.wanted ? '★' : '<span class="off">★</span>';
      }
      this.starsEl.innerHTML = html;
    }
    const health = Math.round(p.health);
    if (health !== this._lastHealth) {
      this._lastHealth = health;
      this.healthBar.style.width = `${health}%`;
      this.healthLabel.textContent = `HEALTH ${health}`;
    }
    const ammoText = p.reloading > 0
      ? 'RELOADING…'
      : `PISTOL — ${p.ammo} / 12`;
    if (ammoText !== this._lastAmmo) {
      this._lastAmmo = ammoText;
      this.ammoLine.textContent = ammoText;
    }
    const speed = p.car ? Math.abs(p.car.speed) * 3.6 : 0;
    this.speedLine.textContent = p.car ? `${Math.round(speed)} km/h` : '';
    this.crosshair.style.display = p.onFoot && G.mode === 'playing' ? 'block' : 'none';

    const mission = G.missions.current;
    const title = mission ? `MISSION ${mission.id} · ${mission.name}` : 'NEON HARBOR';
    const text = G.missions.objective;
    const key = title + '|' + text;
    if (key !== this._lastObjective) {
      this._lastObjective = key;
      this.objTitle.textContent = title;
      this.objText.textContent = text;
    }
    const t = G.missions.target;
    this.objDist.textContent = t
      ? `${Math.round(Math.hypot(p.x - t.x, p.z - t.z))} m — ${t.label}`
      : '';

    // In-game clock: day 1, 09:00, one game hour per 3 real minutes.
    const gameMinutes = 9 * 60 + Math.floor(G.elapsed / 180) * 60 + Math.floor((G.elapsed % 180) / 3);
    const day = 1 + Math.floor(gameMinutes / 1440);
    const hh = String(Math.floor((gameMinutes % 1440) / 60)).padStart(2, '0');
    const mm = String(gameMinutes % 60).padStart(2, '0');
    this.clockEl.textContent = `DAY ${day} · ${hh}:${mm}`;

    this._drawMinimap(G);
  }

  _drawMinimap(G) {
    const ctx = this.mm, S = 188;
    const toMap = (x, z) => [((x + CITY.half) / (CITY.half * 2)) * S, ((z + CITY.half) / (CITY.half * 2)) * S];
    ctx.clearRect(0, 0, S, S);
    // Land, sea and beach.
    ctx.fillStyle = '#1d2f45'; ctx.fillRect(0, 0, S, S);
    const [, seaY] = toMap(0, CITY.beachStart);
    ctx.fillStyle = '#1e7f8e'; ctx.fillRect(0, seaY, S, S - seaY);
    ctx.fillStyle = '#e8cf9a'; ctx.fillRect(0, toMap(0, CITY.beachStart)[1] - 3, S, 4);
    // Roads.
    ctx.strokeStyle = '#3a4152'; ctx.lineWidth = 5;
    for (const s of STREETS) {
      const [x] = toMap(s, 0); const [, z] = toMap(0, s);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, z); ctx.lineTo(S, z); ctx.stroke();
    }
    // Mission waypoint: pulsing yellow ring.
    const t = G.missions.target;
    if (t) {
      const [mx, mz] = toMap(t.x, t.z);
      const pulse = 5 + Math.sin(G.elapsed * 4) * 2;
      ctx.strokeStyle = '#ffd23e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(mx, mz, pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath(); ctx.arc(mx, mz, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    // Traffic (grey), player cars (yellow), police (red/blue flash).
    const dot = (x, z, color, r = 2.5) => {
      const [mx, mz] = toMap(x, z);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(mx, mz, r, 0, Math.PI * 2); ctx.fill();
    };
    for (const car of G.traffic) dot(car.x, car.z, '#9aa5b5', 2);
    for (const car of G.cars) dot(car.x, car.z, '#ffd23e', 3);
    const flashRed = Math.floor(G.elapsed * 4) % 2 === 0;
    for (const cop of G.policeCars) dot(cop.x, cop.z, flashRed ? '#ff3b3b' : '#3b82ff', 3.5);
    for (const cop of G.cops) dot(cop.x, cop.z, '#ff3b3b', 2.5);
    // Player arrow, rotated by heading (map is north-up, +z is down on the canvas).
    const [px, py] = toMap(G.player.x, G.player.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.atan2(Math.sin(G.player.heading), Math.cos(G.player.heading)) + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
