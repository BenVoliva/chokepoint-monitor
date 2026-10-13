// The 3D map: sea, raised land, shipping lanes, moving ships and chokepoint pins.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { KX, WORLD_WIDTH, project, loadLand } from './geo.js';
import { SHIP_KINDS, buildShipModels } from './ships.js';
import { MAP_LABELS } from './maplabels.js';

const PALETTE = {
  sky: 0xf1f4fd,
  sea: 0xbccbf5,
  grid: 0xcad7f8,
  landTop: 0xf3f6fd,
  landSide: 0xd3dcf5,
  network: 0xa3b6ee,
  lane: 0x4f79ec,
  laneDash: 0xffffff,
  accent: 0x2f62e6,
};
const TONE_COLORS = { good: 0x0ca30c, warning: 0xfab219, serious: 0xec835a, critical: 0xd03b3b, info: 0x2f62e6 };

const FOV = 30;
const COPIES = [-1, 0, 1];              // the world repeats east and west so the Pacific is continuous
const HOME = { polar: 0.6, azimuth: 0 };
/** The world view frames these [lon, lat] points: the Americas to East Asia, the Cape to northern Europe. */
const HOME_FRAME = [[-98, 28], [-82, -6], [141, 38], [124, -8], [19, -36], [2, 58]];
const DISTANCE = { min: 14, max: 340 };
const FINE_LAND_WITHIN = 150;           // camera distance below which the detailed coastline shows
const NEAR_LABELS_WITHIN = 120;         // ...and below which country and sea names replace continents
const CLOSE_UPS = {
  suez: { distance: 38, azimuth: 0.32 },
  hormuz: { distance: 34, azimuth: -0.3 },
  panama: { distance: 36, azimuth: -0.28 },
  malacca: { distance: 46, azimuth: 0.4 },
  bab: { distance: 38, azimuth: 0.22 },
  cape: { distance: 62, azimuth: -0.2 },
};
const CLOSE_UP_POLAR = 0.9;

// Ships are illustrative: PortWatch counts transits, it does not track vessels.
export const SHIPS_PER_ICON = 80;       // vessels at sea that one drawn ship stands for
const KM_PER_DAY = 620;                 // about 14 knots
const SLOTS_PER_ROUTE = 48;
/** Which chokepoint's vessel mix colours the ships on each route. */
const ROUTE_MIX = {
  gulf_asia: 'hormuz', gulf_europe_suez: 'hormuz', gulf_atlantic_cape: 'hormuz',
  asia_europe_suez: 'suez', asia_europe_cape: 'cape', brazil_asia_cape: 'cape',
  asia_india: 'malacca',
  asia_useast_panama: 'panama', usgulf_asia_panama: 'panama', andes_useast_panama: 'panama',
};
/** Where each pin's label sits, so the Suez / Bab el-Mandeb / Hormuz cluster does not overlap. */
const LABEL_SIDE = { suez: 'left', hormuz: 'right', bab: 'right', panama: 'top', malacca: 'top', cape: 'top' };

const clamp = THREE.MathUtils.clamp;
const frac = (v) => v - Math.floor(v);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class MapScene {
  /**
   * @param {object} o
   * @param {HTMLCanvasElement} o.canvas
   * @param {HTMLElement} o.labels   layer the pin labels are placed in
   * @param {object} o.model         from data.js
   * @param {(key: string|null) => void} o.onSelect
   */
  constructor({ canvas, labels, model, onSelect }) {
    this.canvas = canvas;
    this.labelLayer = labels;
    this.model = model;
    this.onSelect = onSelect;
    this.selected = null;
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.size = { w: 1, h: 1 };
    this.travel = 0;
    this.lineMaterials = [];

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;   // the only type that blurs, for soft edges

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.sky);
    this.scene.fog = new THREE.Fog(PALETTE.sky, 200, 800);

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 1, 4000);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.08,
      screenSpacePanning: false,
      zoomToCursor: true,
      minDistance: DISTANCE.min,
      maxDistance: DISTANCE.max,
      minPolarAngle: 0.15,
      maxPolarAngle: 1.2,
      minAzimuthAngle: -1,
      maxAzimuthAngle: 1,
    });
    // A map is dragged to pan; tilting is the secondary gesture.
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };

    this.buildLights();
    this.buildSea();
    this.buildLanes();
    this.buildShips();
    this.buildMapLabels();
    this.buildPins();
    this.buildBrackets();
    // Clean, coarse outlines first; the detailed coastline follows for close-ups.
    this.land = {};
    this.ready = loadLand('coarse').then((polys) => { this.land.coarse = this.buildLand(polys); });
    this.ready.then(() => loadLand('fine')).then((polys) => { this.land.fine = this.buildLand(polys); }).catch(console.warn);

    this.resize();
    this.placeCamera(this.homeView());
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.bindPointer();

    this.last = performance.now();
    this.renderer.setAnimationLoop((now) => this.frame(now));
  }

  // ---------------------------------------------------------------- build --

  buildLights() {
    // Mostly soft sky light, with a gentle sun for shape and shadow. Together
    // they light a flat surface at about its own colour, so the palette holds.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xa9bbee, 2.25));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.15);
    this.sunDirection = new THREE.Vector3(-0.55, 1, -0.5).normalize();   // from the north-west
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 5;
    this.sun.shadow.blurSamples = 12;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
  }

  buildSea() {
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
      // pushed back in depth so lines drawn just above the water never flicker
      new THREE.MeshStandardMaterial({ color: PALETTE.sea, roughness: 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 }));
    sea.receiveShadow = true;
    this.scene.add(sea);

    // Faint lines of latitude and longitude every 30 degrees.
    const pts = [];
    for (let lon = -540; lon <= 540; lon += 30) pts.push(lon * KX, 0.01, 75, lon * KX, 0.01, -85);
    for (let lat = -60; lat <= 60; lat += 30) pts.push(-540 * KX, 0.01, -lat, 540 * KX, 0.01, -lat);
    const grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
      new THREE.LineBasicMaterial({ color: PALETTE.grid }));
    this.scene.add(grid);
  }

  buildLand(polys) {
    const shapes = polys.map(([outer, ...holes]) => {
      const toPoints = (ring) => ring.map(([lon, lat]) => new THREE.Vector2(lon * KX, lat));
      const shape = new THREE.Shape(toPoints(outer));
      shape.holes = holes.map((h) => new THREE.Path(toPoints(h)));
      return shape;
    });
    // One unit tall; the mesh is scaled so the slab keeps a steady thickness on screen.
    const geometry = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    const materials = [
      new THREE.MeshStandardMaterial({ color: PALETTE.landTop, roughness: 1 }),
      new THREE.MeshStandardMaterial({ color: PALETTE.landSide, roughness: 1 }),
    ];
    return COPIES.map((copy) => {
      const mesh = new THREE.Mesh(geometry, materials);
      mesh.position.x = copy * WORLD_WIDTH;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      mesh.visible = false;   // frame() shows whichever level of detail suits the zoom
      this.scene.add(mesh);
      return mesh;
    });
  }

  buildLanes() {
    // The whole PortWatch lane network, faint, for context.
    const pts = [];
    for (const lane of this.model.network) {
      for (let i = 1; i < lane.length; i++) {
        const a = project(...lane[i - 1]), b = project(...lane[i]);
        if (Math.abs(a.x - b.x) > WORLD_WIDTH / 2) continue;   // a lane cut at the date line
        pts.push(a.x, 0.02, a.z, b.x, 0.02, b.z);
      }
    }
    const networkGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const networkMaterial = new THREE.LineBasicMaterial({ color: PALETTE.network });

    // The routes the ships follow, one line per shared stretch, with dashes that drift along it.
    this.trunks = this.model.trunks.map((trunk) => {
      const flat = trunk.path.flatMap(([lon, lat]) => { const p = project(lon, lat); return [p.x, 0.04, p.z]; });
      const geometry = new LineGeometry().setPositions(flat);
      const base = this.lineMaterial({ color: PALETTE.lane, linewidth: 3 });
      const dash = this.lineMaterial({ color: PALETTE.laneDash, linewidth: 1.4, dashed: true, dashSize: 1.1, gapSize: 2.6 });
      return { routes: trunk.routes, geometry, base, dash };
    });

    for (const copy of COPIES) {
      const group = new THREE.Group();
      group.position.x = copy * WORLD_WIDTH;
      const network = new THREE.LineSegments(networkGeometry, networkMaterial);
      network.renderOrder = 2;
      group.add(network);
      for (const trunk of this.trunks) {
        const base = new Line2(trunk.geometry, trunk.base);
        base.renderOrder = 3;
        const dash = new Line2(trunk.geometry, trunk.dash);
        dash.computeLineDistances();
        dash.renderOrder = 4;
        group.add(base, dash);
      }
      this.scene.add(group);
    }
  }

  /** A screen-width line that draws over land, so canals stay visible. */
  lineMaterial(options) {
    const material = new LineMaterial({ depthTest: false, depthWrite: false, alphaToCoverage: true, ...options });
    this.lineMaterials.push(material);
    return material;
  }

  buildShips() {
    const models = buildShipModels();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75 });
    this.routes = this.model.routes.map((route, r) => {
      const pts = route.path.map(([lon, lat]) => project(lon, lat));
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
      return {
        key: route.key,
        days: route.km / KM_PER_DAY,
        pts, cum,
        length: cum[cum.length - 1],
        want: 0,
        shares: SHIP_KINDS.map((_, i) => (i + 1) / SHIP_KINDS.length),
        // Fixed, evenly spread positions, so ships neither bunch nor jump as counts change.
        slots: Array.from({ length: SLOTS_PER_ROUTE }, (_, k) => ({
          phase: frac(k * 0.6180339887 + r * 0.137),
          dir: k % 2 ? 1 : -1,
          pick: frac(k * 0.7548776662 + r * 0.21 + 0.31),
          scale: 0,
        })),
      };
    });
    const capacity = this.routes.length * SLOTS_PER_ROUTE * COPIES.length;
    this.shipMeshes = SHIP_KINDS.map((kind) => {
      const mesh = new THREE.InstancedMesh(models[kind.key], material, capacity);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;   // instances are spread across the whole map
      mesh.renderOrder = 5;
      this.scene.add(mesh);
      return mesh;
    });
  }

  buildPins() {
    const head = new THREE.SphereGeometry(0.62, 24, 16).translate(0, 1.55, 0);
    const tip = new THREE.ConeGeometry(0.5, 1.25, 24).rotateX(Math.PI).translate(0, 0.625, 0);
    const dot = new THREE.SphereGeometry(0.27, 16, 12);
    const ring = new THREE.RingGeometry(0.8, 1.02, 48).rotateX(-Math.PI / 2);
    const disc = new THREE.CircleGeometry(0.8, 48).rotateX(-Math.PI / 2);
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });

    this.pins = this.model.chokepoints.map((c) => {
      const body = new THREE.MeshStandardMaterial({ color: TONE_COLORS.info, roughness: 0.4 });
      const ringMaterial = new THREE.MeshBasicMaterial({ color: TONE_COLORS.info, transparent: true, opacity: 0.6, depthWrite: false });
      const discMaterial = new THREE.MeshBasicMaterial({ color: TONE_COLORS.info, transparent: true, opacity: 0.16, depthWrite: false });
      const marker = new THREE.Group();                  // the teardrop, hovering over the spot
      const headMesh = new THREE.Mesh(head, body), tipMesh = new THREE.Mesh(tip, body);
      headMesh.castShadow = tipMesh.castShadow = true;
      const dotMesh = new THREE.Mesh(dot, white);
      marker.add(headMesh, tipMesh, dotMesh);
      const ringMesh = new THREE.Mesh(ring, ringMaterial), discMesh = new THREE.Mesh(disc, discMaterial);
      ringMesh.position.y = discMesh.position.y = 0.06;
      const group = new THREE.Group();
      group.add(marker, ringMesh, discMesh);
      group.renderOrder = 6;
      this.scene.add(group);

      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'pin-label';
      label.dataset.side = LABEL_SIDE[c.key] ?? 'top';
      for (const part of ['dot', 'name', 'value', 'tag']) {
        const span = document.createElement('span');
        span.className = `pin-label__${part}`;
        label.append(span);
      }
      label.children[1].textContent = c.short;
      label.addEventListener('click', () => this.onSelect(c.key));
      this.labelLayer.append(label);

      const home = project(c.lon, c.lat);
      return { key: c.key, home, group, marker, dotMesh, ringMesh, body, ringMaterial, discMaterial, label, tone: 'info', screen: { x: 0, y: 0, visible: false } };
    });
    this.pinByKey = Object.fromEntries(this.pins.map((p) => [p.key, p]));
  }

  buildMapLabels() {
    this.mapLabels = MAP_LABELS.map(([text, lon, lat, kind]) => {
      const node = document.createElement('span');
      node.className = `map-label map-label--${kind}`;
      node.textContent = text;
      this.labelLayer.append(node);
      return { node, near: kind === 'country' || kind === 'sea', onLand: kind === 'country' || kind === 'continent', ...project(lon, lat) };
    });
  }

  /** A focus frame on the water around the selected chokepoint: four corner marks. */
  buildBrackets() {
    const a = 3.2, b = 2.2, arm = 0.56, y = 0.06;
    const pts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * a, z = sz * b;
      pts.push(x, y, z, x - sx * a * arm, y, z);
      pts.push(x, y, z, x, y, z - sz * b * arm);
    }
    this.brackets = new LineSegments2(
      new LineSegmentsGeometry().setPositions(pts),
      this.lineMaterial({ color: PALETTE.accent, linewidth: 2.5 }));
    this.brackets.renderOrder = 7;
    this.brackets.visible = false;
    this.scene.add(this.brackets);
  }

  // ----------------------------------------------------------------- data --

  /**
   * Show day `index`: ship numbers and mix per route, and each pin's status.
   * @param {Array<{key: string, tone: string, value: string, tag: string}>} pinStates
   */
  setDay(index, pinStates) {
    const flows = this.model.routeFlows(index);
    for (const route of this.routes) {
      route.want = Math.round(flows[route.key] * route.days / SHIPS_PER_ICON);
      const mix = this.model.byKey[ROUTE_MIX[route.key]].mix(index);
      const total = mix.reduce((s, m) => s + m.count, 0) || 1;
      let running = 0;
      route.shares = SHIP_KINDS.map((kind) => {
        running += mix.filter((m) => kind.types.includes(m.key)).reduce((s, m) => s + m.count, 0) / total;
        return running;
      });
    }
    for (const state of pinStates) {
      const pin = this.pinByKey[state.key];
      pin.tone = state.tone;
      const color = TONE_COLORS[state.tone];
      pin.body.color.setHex(color);
      pin.ringMaterial.color.setHex(color);
      pin.discMaterial.color.setHex(color);
      pin.label.dataset.tone = state.tone;
      pin.label.children[2].textContent = state.value;
      pin.label.children[3].textContent = state.tag;
      pin.label.setAttribute('aria-label', `${pin.label.children[1].textContent}: ${state.value}, ${state.tag}`);
    }
  }

  // --------------------------------------------------------------- camera --

  /** Space the cards cover, in CSS pixels, so the map centres in what is left. */
  setInsets(insets) {
    this.insets = insets;
    this.applyViewOffset();
  }

  applyViewOffset() {
    const { w, h } = this.size, i = this.insets;
    this.camera.setViewOffset(w, h, (i.right - i.left) / 2, (i.bottom - i.top) / 2, w, h);
    this.reference = this.homeView().distance;   // sizes on screen are tuned relative to the world view
  }

  /** Scene units per CSS pixel for something `distance` from the camera. */
  unitsPerPixel(distance) {
    return 2 * distance * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) / this.size.h;
  }

  /** The camera that frames `points` ([lon, lat]) inside the space the cards leave free. */
  fitView(points, polar, azimuth) {
    const { w, h } = this.size, inset = this.insets, pad = 30;
    const free = { left: inset.left + pad, right: w - inset.right - pad, top: inset.top + pad, bottom: h - inset.bottom - pad };
    const pts = points.map(([lon, lat]) => project(lon, lat));
    const view = {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      z: pts.reduce((s, p) => s + p.z, 0) / pts.length,
      distance: 200, polar, azimuth,
    };
    // Perspective makes this awkward to solve directly, so home in on it:
    // project the points, then rescale and recentre by how far off they land.
    const probe = this.camera.clone();
    for (let pass = 0; pass < 10; pass++) {
      aim(probe, view, TARGET);
      probe.updateMatrixWorld();
      let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
      for (const p of pts) {
        TMP.set(p.x, 0, p.z).project(probe);
        const sx = (TMP.x * 0.5 + 0.5) * w, sy = (-TMP.y * 0.5 + 0.5) * h;
        left = Math.min(left, sx); right = Math.max(right, sx);
        top = Math.min(top, sy); bottom = Math.max(bottom, sy);
      }
      const perPixel = this.unitsPerPixel(view.distance);
      view.x += ((left + right) / 2 - (free.left + free.right) / 2) * perPixel;
      view.z += ((top + bottom) / 2 - (free.top + free.bottom) / 2) * perPixel / Math.cos(polar);
      const overflow = Math.max((right - left) / (free.right - free.left), (bottom - top) / (free.bottom - free.top));
      view.distance = clamp(view.distance * overflow, DISTANCE.min, DISTANCE.max);
    }
    return view;
  }

  homeView() {
    return this.fitView(HOME_FRAME, HOME.polar, HOME.azimuth);
  }

  closeUpView(key) {
    const pin = this.pinByKey[key], shot = CLOSE_UPS[key];
    return { x: this.nearestCopy(pin.home.x), z: pin.home.z, distance: shot.distance, polar: CLOSE_UP_POLAR, azimuth: shot.azimuth };
  }

  /** x shifted by whole worlds to the copy nearest where the camera is looking. */
  nearestCopy(x) {
    return x + Math.round((this.controls.target.x - x) / WORLD_WIDTH) * WORLD_WIDTH;
  }

  placeCamera(view) {
    aim(this.camera, view, this.controls.target);
  }

  currentView() {
    const t = this.controls.target;
    return {
      x: t.x, z: t.z,
      distance: this.camera.position.distanceTo(t),
      polar: this.controls.getPolarAngle(),
      azimuth: this.controls.getAzimuthalAngle(),
    };
  }

  flyTo(view, ms = 1500) {
    this.tween = { from: this.currentView(), to: view, start: performance.now(), ms };
  }

  /** Move the camera closer (factor below 1) or further away, keeping its aim. */
  zoom(factor) {
    const view = this.currentView();
    view.distance = clamp(view.distance * factor, DISTANCE.min, DISTANCE.max);
    this.flyTo(view, 350);
  }

  /** Select a chokepoint (or null for the world view) and move the camera there. */
  select(key, { fly = true } = {}) {
    this.selected = key;
    for (const pin of this.pins) pin.label.classList.toggle('is-selected', pin.key === key);
    this.brackets.visible = Boolean(key);
    if (fly) this.flyTo(key ? this.closeUpView(key) : this.homeView());
  }

  bindPointer() {
    let down = null;
    const cancelTween = () => { this.tween = null; };
    this.canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; cancelTween(); });
    this.canvas.addEventListener('wheel', cancelTween, { passive: true });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const hit = this.pins.find((p) => p.screen.visible && Math.hypot(p.screen.x - x, p.screen.y - 18 - y) < 26);
      if (hit) this.onSelect(hit.key);
    });
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h || (w === this.size.w && h === this.size.h)) return;
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.applyViewOffset();
    this.camera.updateProjectionMatrix();
    for (const m of this.lineMaterials) m.resolution.set(w, h);
  }

  // ---------------------------------------------------------------- frame --

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    if (this.tween) {
      const { from, to, start, ms } = this.tween;
      const t = clamp((now - start) / ms, 0, 1), k = ease(t);
      const mix = (key) => from[key] + (to[key] - from[key]) * k;
      this.placeCamera({ x: mix('x'), z: mix('z'), distance: mix('distance'), polar: mix('polar'), azimuth: mix('azimuth') });
      if (t === 1) this.tween = null;
    }
    this.controls.update();
    this.keepInWorld();

    const target = this.controls.target;
    const distance = this.camera.position.distanceTo(target);
    const px = this.unitsPerPixel(distance);            // scene units per pixel at the target
    const zoom = this.reference / distance;             // 1 at the world view, larger close in

    // Land keeps a readable thickness and swaps to the detailed coastline close in;
    // haze and shadows follow the camera.
    const fine = Boolean(this.land.fine) && distance < FINE_LAND_WITHIN;
    for (const [detail, meshes] of Object.entries(this.land)) {
      for (const mesh of meshes) {
        mesh.visible = (detail === 'fine') === fine;
        mesh.scale.y = px * 7 * Math.pow(zoom, 0.35);
      }
    }
    this.scene.fog.near = distance * 1.15;
    this.scene.fog.far = distance * 3.8;
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDirection, distance * 1.6);
    const cam = this.sun.shadow.camera, reach = distance * 0.95;
    cam.left = -reach; cam.right = reach; cam.top = reach; cam.bottom = -reach;
    cam.near = distance * 0.2; cam.far = distance * 4;
    cam.updateProjectionMatrix();

    // Lanes thicken a little close in; dashes keep their size on screen and drift along.
    const laneWidth = 3 * Math.pow(zoom, 0.3);
    for (const trunk of this.trunks) {
      trunk.base.linewidth = laneWidth;
      trunk.dash.linewidth = laneWidth * 0.45;
      trunk.dash.dashScale = 1 / (px * 5.5);
      trunk.dash.dashOffset -= dt * 1.6;
    }

    this.updateShips(dt, px, zoom, distance);
    this.updatePins(now / 1000, px);
    this.renderer.render(this.scene, this.camera);
    this.placeLabels(distance, px * 7 * Math.pow(zoom, 0.35));
  }

  /** The world repeats, so slide back to the middle copy instead of running off the edge. */
  keepInWorld() {
    const t = this.controls.target;
    const shift = -Math.round(t.x / WORLD_WIDTH) * WORLD_WIDTH;
    if (shift) { t.x += shift; this.camera.position.x += shift; }
    const z = clamp(t.z, -78, 58);
    if (z !== t.z) { this.camera.position.z += z - t.z; t.z = z; }
  }

  updateShips(dt, px, zoom, distance) {
    const length = px * Math.min(72, 25 * Math.pow(zoom, 0.42));   // ship length in scene units
    this.travel += dt * length * 0.34;
    const counts = SHIP_KINDS.map(() => 0);
    const centre = this.controls.target.x, reach = distance * 2.4 + 30;
    const edge = length * 2.5;

    for (const route of this.routes) {
      for (let k = 0; k < SLOTS_PER_ROUTE; k++) {
        const slot = route.slots[k];
        slot.scale += ((k < route.want ? 1 : 0) - slot.scale) * Math.min(1, dt * 3);
        if (slot.scale < 0.02) continue;

        const along = frac(slot.phase + slot.dir * this.travel / route.length) * route.length;
        sampleRoute(route, along, HERE);
        sampleRoute(route, along + slot.dir * length * 0.6, AHEAD);
        sampleRoute(route, along - slot.dir * length * 0.6, BEHIND);
        let hx = AHEAD.x - BEHIND.x, hz = AHEAD.z - BEHIND.z;
        const h = Math.hypot(hx, hz) || 1;
        hx /= h; hz /= h;

        // Ships fade in and out at each end of a route, and keep to the right like real traffic lanes.
        const ends = clamp(along / edge, 0, 1) * clamp((route.length - along) / edge, 0, 1);
        const size = length * slot.scale * ends;
        let kind = route.shares.findIndex((share) => slot.pick < share);
        if (kind < 0) kind = SHIP_KINDS.length - 1;
        const x = HERE.x - hz * length * 0.2, z = HERE.z + hx * length * 0.2;
        QUAT.setFromAxisAngle(UP, Math.atan2(-hz, hx));
        SCALE.set(size, size * 1.5, size * 1.55);   // toy proportions: taller and beamier than life

        for (const copy of COPIES) {
          const cx = x + copy * WORLD_WIDTH;
          if (Math.abs(cx - centre) > reach) continue;
          POSITION.set(cx, Math.sin(this.travel / length * 0.9 + slot.phase * 40) * size * 0.006, z);
          MATRIX.compose(POSITION, QUAT, SCALE);
          this.shipMeshes[kind].setMatrixAt(counts[kind]++, MATRIX);
        }
      }
    }
    this.shipMeshes.forEach((mesh, i) => {
      mesh.count = counts[i];
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  updatePins(seconds, px) {
    for (const pin of this.pins) {
      const selected = pin.key === this.selected;
      // show the pin in whichever copy of the world is nearest the camera
      pin.group.position.set(this.nearestCopy(pin.home.x), 0, pin.home.z);
      const scale = px * (selected ? 15.5 : 12.5);
      pin.group.scale.setScalar(scale);
      pin.marker.position.y = 0.35 + Math.sin(seconds * 1.8 + pin.home.x) * 0.07;
      // the white dot sits on the side of the head facing the camera
      TMP.copy(this.camera.position).sub(pin.group.position).normalize().multiplyScalar(0.42);
      pin.dotMesh.position.set(TMP.x, 1.55 + TMP.y, TMP.z);
      // disrupted chokepoints pulse
      const alarm = pin.tone === 'critical' || pin.tone === 'serious';
      const beat = alarm ? frac(seconds * (pin.tone === 'critical' ? 0.75 : 0.45) + pin.home.x * 0.01) : 0;
      pin.ringMesh.scale.setScalar(1 + beat * 1.5);
      pin.ringMaterial.opacity = alarm ? 0.7 * (1 - beat) : 0.6;
    }
    if (this.selected) {
      const pin = this.pinByKey[this.selected];
      this.brackets.position.copy(pin.group.position);
      this.brackets.scale.setScalar(Math.max(0.5, px * 11));   // the strait itself close in, never tiny from afar
    }
  }

  placeLabels(distance, landHeight) {
    const { w, h } = this.size;
    const near = distance < NEAR_LABELS_WITHIN;
    for (const label of this.mapLabels) {
      TMP.set(this.nearestCopy(label.x), label.onLand ? landHeight : 0, label.z).project(this.camera);
      const shown = label.near === near && TMP.z < 1 && Math.abs(TMP.x) < 1.05 && Math.abs(TMP.y) < 1.05;
      label.node.classList.toggle('is-shown', shown);
      if (shown) label.node.style.transform = `translate3d(${((TMP.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-TMP.y * 0.5 + 0.5) * h).toFixed(1)}px, 0)`;
    }
    for (const pin of this.pins) {
      const scale = pin.group.scale.x;
      TMP.set(pin.group.position.x, (pin.marker.position.y + 1.55) * scale, pin.group.position.z).project(this.camera);
      const visible = TMP.z < 1 && Math.abs(TMP.x) < 1.1 && Math.abs(TMP.y) < 1.1;
      const x = (TMP.x * 0.5 + 0.5) * w, y = (-TMP.y * 0.5 + 0.5) * h;
      pin.screen = { x, y, visible };
      pin.label.style.display = visible ? '' : 'none';
      if (visible) pin.label.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }
}

// Scratch objects reused every frame.
const HERE = { x: 0, z: 0 }, AHEAD = { x: 0, z: 0 }, BEHIND = { x: 0, z: 0 };
const POSITION = new THREE.Vector3(), SCALE = new THREE.Vector3(), TMP = new THREE.Vector3(), TARGET = new THREE.Vector3();
const QUAT = new THREE.Quaternion(), MATRIX = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);

/**
 * Point `camera` at a spot on the sea. polar is the tilt away from straight
 * down; azimuth swings the camera round the spot (0 = looking due north).
 * `target` receives the spot.
 */
function aim(camera, { x, z, distance, polar, azimuth }, target) {
  target.set(x, 0, z);
  camera.position.set(
    x + distance * Math.sin(polar) * Math.sin(azimuth),
    distance * Math.cos(polar),
    z + distance * Math.sin(polar) * Math.cos(azimuth));
  camera.lookAt(target);
}

/** Point `along` scene units from the start of a route (clamped to its ends). */
function sampleRoute(route, along, out) {
  const { pts, cum } = route;
  const d = clamp(along, 0, route.length);
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const span = cum[hi] - cum[lo] || 1, t = (d - cum[lo]) / span;
  out.x = pts[lo].x + (pts[hi].x - pts[lo].x) * t;
  out.z = pts[lo].z + (pts[hi].z - pts[lo].z) * t;
}
