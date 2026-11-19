// Neon Harbor — the three.js renderer. Builds the whole city from the world's data
// (buildings, roads, palms, docks, sea), makes the meshes for people and cars, runs
// the third-person camera, and paints one frame. No rules in here, only pictures.

import * as THREE from 'three';
import { CITY, PALETTE, STREETS } from './config.js';

const tmpV = new THREE.Vector3();

function lambert(color) { return new THREE.MeshLambertMaterial({ color }); }
function basic(color) { return new THREE.MeshBasicMaterial({ color }); }

export class Renderer {
  constructor(canvas, world) {
    this.world = world;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.sky);
    this.scene.fog = new THREE.Fog(PALETTE.fog, 130, 460);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
    this.camPos = new THREE.Vector3(0, 40, 80);
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.shake = 0;

    // Sun + sky fill.
    const sun = new THREE.DirectionalLight(PALETTE.sun, 2.4);
    sun.position.set(120, 180, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -230; sun.shadow.camera.right = 230;
    sun.shadow.camera.top = 230; sun.shadow.camera.bottom = -230;
    sun.shadow.camera.far = 520;
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.8;
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x8a7a5a, 1.1));

    this._buildGround();
    this._buildCity();
    this._buildSea();
    this._buildClouds();

    // Waypoint beacon: a glowing pillar + ground ring, pulsed by update().
    this.beacon = new THREE.Group();
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 60, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
    );
    pillar.position.y = 30;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.4, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15;
    this.beacon.add(pillar, ring);
    this.beacon.visible = false;
    this.scene.add(this.beacon);

    // Particle pool: one THREE.Points, positions rewritten each frame.
    this.particleCount = 240;
    this.particles = [];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.particleCount * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.particleCount * 3), 3));
    this.particleGeo = geo;
    this.particlePoints = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.55, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
    }));
    this.particlePoints.frustumCulled = false;
    this.scene.add(this.particlePoints);
    for (let i = 0; i < this.particleCount; i += 1) {
      this.particles.push({ life: 0, x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1 });
    }

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _buildGround() {
    // Sidewalk-coloured base for the whole city block area.
    const base = new THREE.Mesh(new THREE.PlaneGeometry(CITY.half * 2, CITY.half * 2), lambert(PALETTE.sidewalk));
    base.rotation.x = -Math.PI / 2; base.position.set(0, 0, 0);
    base.receiveShadow = true;
    this.scene.add(base);
    // Asphalt strips for every street, plus the beach sand to the south.
    const roadMat = lambert(PALETTE.asphalt);
    for (const s of STREETS) {
      const h = new THREE.Mesh(new THREE.PlaneGeometry(CITY.half * 2, CITY.roadWidth), roadMat);
      h.rotation.x = -Math.PI / 2; h.position.set(0, 0.02, s); h.receiveShadow = true;
      this.scene.add(h);
      const v = new THREE.Mesh(new THREE.PlaneGeometry(CITY.roadWidth, CITY.half * 2), roadMat);
      v.rotation.x = -Math.PI / 2; v.position.set(s, 0.02, 0); v.receiveShadow = true;
      this.scene.add(v);
    }
    // Centre dashes on the two main avenues.
    const dashMat = basic(0xf2e3c6);
    for (let d = -190; d < 190; d += 12) {
      for (const s of [0]) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.5), dashMat);
        dash.rotation.x = -Math.PI / 2; dash.position.set(d, 0.04, s);
        this.scene.add(dash);
      }
    }
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(CITY.half * 2, CITY.seaStart - CITY.beachStart + 8), lambert(PALETTE.sand));
    sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0.01, (CITY.beachStart + CITY.seaStart) / 2);
    sand.receiveShadow = true;
    this.scene.add(sand);
  }

  _buildCity() {
    const { buildings, palms, lamps, containers, cranes } = this.world;
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    for (const b of buildings) {
      const mat = lambert(b.color);
      const mesh = new THREE.Mesh(boxGeo, mat);
      mesh.scale.set(b.w, b.h, b.d);
      mesh.position.set(b.x, b.h / 2, b.z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
      // Flat roof slab in a contrasting colour.
      const roof = new THREE.Mesh(boxGeo, lambert(b.roof));
      roof.scale.set(b.w + 0.6, 0.5, b.d + 0.6);
      roof.position.set(b.x, b.h + 0.25, b.z);
      this.scene.add(roof);
      // Neon sign strip on some buildings: a bright unlit band.
      if (b.neon !== null) {
        const sign = new THREE.Mesh(boxGeo, basic(b.neon));
        sign.scale.set(b.w * 0.7, 0.9, 0.3);
        sign.position.set(b.x, Math.min(b.h - 1.2, 8), b.z + b.d / 2 + 0.18);
        this.scene.add(sign);
      }
      // Windows: a few dark inset boxes on the street-facing side.
      const winMat = lambert(0x2a3550);
      const rows = Math.max(1, Math.floor(b.h / 4));
      for (let r = 0; r < rows; r += 1) {
        for (let c = -1; c <= 1; c += 1) {
          if ((r * 3 + c + 5) % 4 === 0) continue;
          const win = new THREE.Mesh(boxGeo, winMat);
          win.scale.set(1.6, 1.8, 0.15);
          win.position.set(b.x + c * (b.w / 3.2), 2.5 + r * 3.4, b.z + b.d / 2 + 0.06);
          this.scene.add(win);
        }
      }
    }
    // Palms: trunk + a flattened icosahedron crown.
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 4.4, 6);
    const crownGeo = new THREE.IcosahedronGeometry(1.5, 0);
    const trunkMat = lambert(PALETTE.palmTrunk);
    const leafMat = lambert(PALETTE.palmLeaf);
    for (const p of palms) {
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(p.x, 2.2 * p.s, p.z); trunk.scale.setScalar(p.s);
      trunk.castShadow = true;
      this.scene.add(trunk);
      const crown = new THREE.Mesh(crownGeo, leafMat);
      crown.position.set(p.x, 4.8 * p.s, p.z); crown.scale.set(p.s * 1.4, p.s * 0.7, p.s * 1.4);
      crown.castShadow = true;
      this.scene.add(crown);
    }
    // Street lamps.
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 5, 5);
    const bulbGeo = new THREE.SphereGeometry(0.28, 8, 6);
    const poleMat = lambert(0x3a3f46);
    const bulbMat = basic(0xffe9a8);
    for (const l of lamps) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(l.x, 2.5, l.z);
      this.scene.add(pole);
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(l.x, 5.1, l.z);
      this.scene.add(bulb);
    }
    // Dock containers + cranes.
    for (const c of containers) {
      const mesh = new THREE.Mesh(boxGeo, lambert(c.color));
      mesh.scale.set(c.rot === 0 ? 6 : 2.6, 2.6, c.rot === 0 ? 2.6 : 6);
      mesh.position.set(c.x, 1.3, c.z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
    const craneMat = lambert(0xd95f43);
    for (const cr of cranes) {
      const leg = new THREE.Mesh(boxGeo, craneMat);
      leg.scale.set(1.2, 22, 1.2); leg.position.set(cr.x, 11, cr.z);
      this.scene.add(leg);
      const arm = new THREE.Mesh(boxGeo, craneMat);
      arm.scale.set(16, 1, 1); arm.position.set(cr.x - 4, 21, cr.z);
      this.scene.add(arm);
    }
  }

  _buildSea() {
    this.sea = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY.half * 2 + 400, 260),
      new THREE.MeshLambertMaterial({ color: PALETTE.sea }),
    );
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.set(0, 0.05, CITY.seaStart + 130);
    this.scene.add(this.sea);
  }

  _buildClouds() {
    this.clouds = [];
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    const geo = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < 9; i += 1) {
      const cloud = new THREE.Mesh(geo, mat);
      const s = 8 + Math.random() * 9;
      cloud.scale.set(s, s * 0.32, s * 0.6);
      cloud.position.set(-220 + Math.random() * 440, 95 + Math.random() * 35, -220 + Math.random() * 380);
      this.clouds.push(cloud);
      this.scene.add(cloud);
    }
  }

  // --- dynamic mesh factories ---

  makeCarMesh(color, police = false) {
    const group = new THREE.Group();
    const paint = lambert(police ? 0xf2f2f2 : color);
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.85, 2.0), paint);
    body.position.y = 0.75; body.castShadow = true;
    group.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 1.8), lambert(0x1c2733));
    cabin.position.set(-0.2, 1.45, 0); cabin.castShadow = true;
    group.add(cabin);
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 10);
    const wheelMat = lambert(0x14161a);
    const wheels = [];
    for (const [wx, wz] of [[1.45, 0.95], [1.45, -0.95], [-1.45, 0.95], [-1.45, -0.95]]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.42, wz);
      group.add(wheel); wheels.push(wheel);
    }
    const headMat = basic(0xfff2b0);
    for (const wz of [0.7, -0.7]) {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.25, 0.4), headMat);
      head.position.set(2.18, 0.8, wz);
      group.add(head);
    }
    let lightL = null, lightR = null;
    if (police) {
      lightL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.5), basic(0xff2222));
      lightL.position.set(-0.2, 1.95, 0.45);
      lightR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.5), basic(0x2266ff));
      lightR.position.set(-0.2, 1.95, -0.45);
      group.add(lightL, lightR);
    }
    group.userData = { wheels, lightL, lightR, police };
    this.scene.add(group);
    return group;
  }

  makeTruckMesh(color) {
    const group = new THREE.Group();
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 2.2), lambert(0x2c2f36));
    cab.position.set(3.4, 1.5, 0); cab.castShadow = true;
    const box = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3.0, 2.6), lambert(color));
    box.position.set(-1.2, 1.9, 0); box.castShadow = true;
    group.add(cab, box);
    const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 10);
    const wheelMat = lambert(0x14161a);
    for (const [wx, wz] of [[4.0, 1.05], [4.0, -1.05], [-3.4, 1.05], [-3.4, -1.05], [-0.6, 1.05], [-0.6, -1.05]]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.5, wz);
      group.add(wheel);
    }
    this.scene.add(group);
    return group;
  }

  makePersonMesh(kind, color) {
    // kind: 'ped' | 'thug' | 'cop' | 'player'
    const group = new THREE.Group();
    const shirt = kind === 'cop' ? 0x1e3a5f : kind === 'thug' ? 0x3a1f1f : color;
    const skin = 0xd9a066;
    const legs = new THREE.Group();
    const legGeo = new THREE.BoxGeometry(0.22, 0.8, 0.22);
    const legMat = lambert(kind === 'cop' ? 0x1e3a5f : 0x2c2f36);
    const legL = new THREE.Mesh(legGeo, legMat); legL.position.set(0, 0.4, 0.14);
    const legR = new THREE.Mesh(legGeo, legMat); legR.position.set(0, 0.4, -0.14);
    legs.add(legL, legR);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.75, 0.5), lambert(shirt));
    torso.position.y = 1.18; torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), lambert(skin));
    head.position.y = 1.78; head.castShadow = true;
    const arms = new THREE.Group();
    const armGeo = new THREE.BoxGeometry(0.16, 0.7, 0.16);
    const armMat = lambert(shirt);
    const armL = new THREE.Mesh(armGeo, armMat); armL.position.set(0, 1.2, 0.32);
    const armR = new THREE.Mesh(armGeo, armMat); armR.position.set(0, 1.2, -0.32);
    arms.add(armL, armR);
    group.add(legs, torso, head, arms);
    if (kind === 'player') {
      // Rook: teal jacket, dark cap.
      torso.material = lambert(0x2e8b8b);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.46), lambert(0x222222));
      cap.position.y = 2.02;
      group.add(cap);
    }
    if (kind === 'cop') {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.46), lambert(0x10233a));
      cap.position.y = 2.02;
      group.add(cap);
    }
    group.userData = { legs, legL, legR, armL, armR, torso, kind, walkPhase: Math.random() * 6 };
    this.scene.add(group);
    return group;
  }

  removeMesh(mesh) { this.scene.remove(mesh); }

  burst(x, y, z, hex, count, speed = 4) {
    const color = new THREE.Color(hex);
    let placed = 0;
    for (const p of this.particles) {
      if (p.life > 0) continue;
      p.life = 0.5 + Math.random() * 0.4;
      p.x = x; p.y = y; p.z = z;
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * Math.PI;
      p.vx = Math.cos(a) * Math.cos(e) * speed * Math.random();
      p.vy = Math.abs(Math.sin(e)) * speed + 1.5;
      p.vz = Math.sin(a) * Math.cos(e) * speed * Math.random();
      p.r = color.r; p.g = color.g; p.b = color.b;
      placed += 1;
      if (placed >= count) break;
    }
  }

  setBeacon(x, z, visible) {
    this.beacon.visible = visible;
    this.beacon.position.set(x, 0, z);
  }

  addShake(amount) { this.shake = Math.min(1, this.shake + amount); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Camera: third-person follow. camYaw is the angle from the player to the camera
  // (heading + PI when directly behind); the camera looks back past the player.
  updateCamera(dt, target, camYaw, pitch, dist, height) {
    const cx = target.x + Math.sin(camYaw) * dist;
    const cz = target.z + Math.cos(camYaw) * dist;
    const cy = height + pitch;
    const k = 1 - Math.pow(0.0001, dt); // smooth follow
    this.camPos.x += (cx - this.camPos.x) * k;
    this.camPos.y += (cy - this.camPos.y) * k;
    this.camPos.z += (cz - this.camPos.z) * k;
    const lx = target.x - Math.sin(camYaw) * 4;
    const lz = target.z - Math.cos(camYaw) * 4;
    this.camLook.x += (lx - this.camLook.x) * k;
    this.camLook.y += (1.6 - this.camLook.y) * k;
    this.camLook.z += (lz - this.camLook.z) * k;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const s = this.shake * 0.35;
      this.camera.position.set(
        this.camPos.x + (Math.random() - 0.5) * s,
        this.camPos.y + (Math.random() - 0.5) * s,
        this.camPos.z + (Math.random() - 0.5) * s,
      );
    } else {
      this.camera.position.copy(this.camPos);
    }
    tmpV.copy(this.camLook);
    this.camera.lookAt(tmpV);
  }

  // Fixed camera for title / screenshots: pos + look target, no follow.
  setFixedCamera(px, py, pz, lx, ly, lz) {
    this.camPos.set(px, py, pz);
    this.camLook.set(lx, ly, lz);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  update(dt, time) {
    // Beacon pulse + slow spin.
    if (this.beacon.visible) {
      const s = 1 + Math.sin(time * 3) * 0.15;
      this.beacon.children[1].scale.set(s, s, 1);
      this.beacon.children[0].material.opacity = 0.22 + Math.sin(time * 3) * 0.08;
    }
    // Sea shimmer and cloud drift.
    this.sea.material.color.setHSL(0.52, 0.62, 0.42 + Math.sin(time * 0.4) * 0.02);
    for (const c of this.clouds) {
      c.position.x += dt * 0.6;
      if (c.position.x > 260) c.position.x = -260;
    }
    // Particles.
    const pos = this.particleGeo.attributes.position.array;
    const col = this.particleGeo.attributes.color.array;
    for (let i = 0; i < this.particleCount; i += 1) {
      const p = this.particles[i];
      if (p.life > 0) {
        p.life -= dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.vy -= 6 * dt;
        if (p.y < 0.05) { p.y = 0.05; p.vy = 0; }
      } else { p.y = -100; }
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      col[i * 3] = p.r; col[i * 3 + 1] = p.g; col[i * 3 + 2] = p.b;
    }
    this.particleGeo.attributes.position.needsUpdate = true;
    this.particleGeo.attributes.color.needsUpdate = true;
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
