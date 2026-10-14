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
import { MAP_LABELS, COUNTRY_NAMES } from './maplabels.js';

const PALETTE = {
  sky: 0xf1f4fd,
  sea: 0xbccbf5,
  grid: 0xcad7f8,
  landTop: 0xf3f6fd,
  landSide: 0xd3dcf5,
  border: 0xb0bde4,
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
const DISTANCE = { min: 14, max: 340, fit: 900 };   // fit: how far back the world view may sit on a narrow screen
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
export const KM_PER_DAY = 620;          // about 14 knots
const SLOTS_PER_ROUTE = 48;

// Zoom response, as the log of the change in camera distance per pixel of wheel movement.
// For scale: 0.0069 doubles or halves the distance every 100 pixels.
const PINCH_RATE = 0.012;       // a trackpad pinch reports small movements
const WHEEL_RATE = 0.0026;      // a wheel or a two-finger scroll reports large ones
const WHEEL_NOTCH = 0.13;       // the least one deliberate click of a mouse wheel does (about 14%)
const PAGE_SCROLL_GRACE = 400;  // ms after the page last scrolled before a plain wheel may zoom
const NAME_NUDGES = [0, 18, -18, 36, -36];

/** Width on screen, in pixels at the world view, of a lane carrying this many ships a day. */
export function laneWidth(shipsPerDay) {
  return 1.5 + shipsPerDay * 0.04;
}
/** Where each pin's label sits, so the Suez / Bab el-Mandeb / Hormuz cluster does not overlap. */
const LABEL_SIDE = { suez: 'left', hormuz: 'right', bab: 'right', panama: 'top', malacca: 'right', cape: 'top' };

const clamp = THREE.MathUtils.clamp;
const frac = (v) => v - Math.floor(v);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class MapScene {
  /**
   * @param {object} o
   * @param {HTMLCanvasElement} o.canvas
   * @param {HTMLElement} o.labels   layer the pin labels and place names are placed in
   * @param {HTMLElement} o.overlay  layer for the picked ship's card, which may sit over other cards
   * @param {object} o.model         from data.js
   * @param {(key: string|null) => void} o.onSelect
   * @param {(ship: {route: string, kind: string, forward: boolean}|null) => void} o.onShip
   *   called when a ship is picked, changes type, or is let go; fill `shipCard` in response
   */
  constructor({ canvas, labels, overlay, model, onSelect, onShip }) {
    this.canvas = canvas;
    this.labelLayer = labels;
    this.overlay = overlay;
    this.model = model;
    this.onSelect = onSelect;
    this.onShip = onShip;
    this.selected = null;
    this.ship = null;          // the ship the user picked: { route, slot, kind, dir, anchor }
    this.drawn = [];           // every ship drawn this frame, for picking
    this.drawnCount = 0;
    this.zoomPending = 0;      // zoom still to apply, as a log of the distance change; eased in frame()
    this.zoomPoint = { x: 0, y: 0 };
    this.lastWheel = 0;
    this.lastPageWheel = 0;
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

    // Zoom is handled here (see onWheel), ahead of the controls: their own wheel zoom
    // is far too weak on a high-density screen and all but ignores a trackpad pinch.
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { capture: true, passive: false });
    canvas.addEventListener('dblclick', (e) => this.zoomBy(Math.log(0.5), e));
    // A pinch arrives as wheel events with Ctrl set; knowing whether the key is really down tells the two apart.
    window.addEventListener('keydown', (e) => { if (e.key === 'Control') this.ctrlHeld = true; });
    window.addEventListener('keyup', (e) => { if (e.key === 'Control') this.ctrlHeld = false; });
    window.addEventListener('blur', () => { this.ctrlHeld = false; });
    // Safari reports a trackpad pinch as gesture events instead.
    canvas.addEventListener('gesturestart', (e) => { e.preventDefault(); this.gestureScale = 1; });
    canvas.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      this.zoomBy(Math.log(this.gestureScale / e.scale) * 1.4, e);
      this.gestureScale = e.scale;
    });

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
    this.buildShipFocus();
    // Clean, coarse outlines first; the detailed coastline follows for close-ups.
    this.land = {};
    this.ready = loadLand('coarse').then(({ land }) => { this.land.coarse = this.buildLand(land); });
    this.ready.then(() => loadLand('fine')).then(({ land, borders, countries }) => {
      this.land.fine = this.buildLand(land);
      this.buildBorders(borders);
      this.buildCountryLabels(countries);
    }).catch(console.warn);

    this.obstacles = [];
    this.resize();
    this.goHome(false);
    this.controls.addEventListener('start', () => { this.atHome = false; });   // the user took over
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

  /** Country borders, drawn over the land once the camera is close enough to want them. */
  buildBorders(lines) {
    const pts = [];
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const a = project(...line[i - 1]), b = project(...line[i]);
        if (Math.abs(a.x - b.x) > WORLD_WIDTH / 2) continue;   // a line cut at the date line
        pts.push(a.x, 0, a.z, b.x, 0, b.z);
      }
    }
    const geometry = new LineSegmentsGeometry().setPositions(pts);
    this.borderMaterial = this.lineMaterial({ color: PALETTE.border, linewidth: 1.1, transparent: true, opacity: 0 });
    this.borders = COPIES.map((copy) => {
      const lines = new LineSegments2(geometry, this.borderMaterial);
      lines.position.x = copy * WORLD_WIDTH;
      lines.renderOrder = 2;
      lines.visible = false;
      this.scene.add(lines);
      return lines;
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
      return { routes: trunk.routes, geometry, base, dash, flow: 0, width: laneWidth(0) };
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
    material.resolution.set(this.size.w, this.size.h);
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
        mix: route.mix,
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
      return { node, near: kind === 'sea', onLand: kind === 'continent', shown: false, ...project(lon, lat) };
    });
  }

  /** A name for every country, largest first so the big ones claim their space before the small. */
  buildCountryLabels(countries) {
    const before = this.pins[0].label;   // names go under the pin labels
    this.countryLabels = [...countries].sort((a, b) => b.size - a.size).map((country) => {
      const node = document.createElement('span');
      node.className = 'map-label map-label--country';
      node.textContent = COUNTRY_NAMES[country.name] ?? country.name;
      this.labelLayer.insertBefore(node, before);
      return { node, size: country.size, shown: false, ...project(country.lon, country.lat) };
    });
    for (const label of this.countryLabels) label.width = label.node.offsetWidth;   // one layout pass, after all are in
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

  /** Corner marks boxing in the ship the user picked, and the card that follows it. */
  buildShipFocus() {
    const a = 0.7, h = 0.34, b = 0.3, arm = 0.3;   // half-length, height and half-beam, in ship lengths
    const pts = [];
    for (const sx of [-1, 1]) for (const top of [0, 1]) for (const sz of [-1, 1]) {
      const x = sx * a, y = top * h, z = sz * b;
      pts.push(x, y, z, x - sx * 2 * a * arm, y, z);
      pts.push(x, y, z, x, y + (top ? -1 : 1) * h * arm, z);
      pts.push(x, y, z, x, y, z - sz * 2 * b * arm);
    }
    this.shipFrame = new LineSegments2(
      new LineSegmentsGeometry().setPositions(pts),
      this.lineMaterial({ color: PALETTE.accent, linewidth: 2 }));
    this.shipFrame.renderOrder = 8;
    this.shipFrame.visible = false;
    this.scene.add(this.shipFrame);

    this.shipCard = document.createElement('div');
    this.shipCard.className = 'ship-card';
    this.shipCard.hidden = true;
    this.overlay.append(this.shipCard);
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
      const mix = this.model.byKey[route.mix].mix(index);
      const total = mix.reduce((s, m) => s + m.count, 0) || 1;
      let running = 0;
      route.shares = SHIP_KINDS.map((kind) => {
        running += mix.filter((m) => kind.types.includes(m.key)).reduce((s, m) => s + m.count, 0) / total;
        return running;
      });
    }
    for (const trunk of this.trunks) trunk.flow = trunk.routes.reduce((sum, key) => sum + flows[key], 0);
    if (!this.started) {
      // First day shown: start with the ships and lane widths already in place, not growing in from nothing.
      this.started = true;
      for (const route of this.routes) route.slots.forEach((slot, k) => { slot.scale = k < route.want ? 1 : 0; });
      for (const trunk of this.trunks) trunk.width = laneWidth(trunk.flow);
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

  /**
   * Tell the map where the cards are.
   * @param {{top: number, right: number, bottom: number, left: number}} insets  margins the cards
   *   cover, in CSS pixels, so the map centres in what is left
   * @param {DOMRect[]} obstacles  the cards themselves; place names are not drawn behind them
   */
  setLayout(insets, obstacles) {
    this.insets = insets;
    this.obstacles = obstacles;
    this.applyViewOffset();
  }

  applyViewOffset() {
    const { w, h } = this.size, i = this.insets;
    this.camera.setViewOffset(w, h, (i.right - i.left) / 2, (i.bottom - i.top) / 2, w, h);
    const home = this.homeView();
    this.reference = home.distance;   // sizes on screen are tuned relative to the world view
    this.controls.maxDistance = Math.max(DISTANCE.max, this.reference * 1.1);
    if (this.atHome && !this.tween) aim(this.camera, home, this.controls.target);   // keep the world view framed as the window changes
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
      view.distance = clamp(view.distance * overflow, DISTANCE.min, DISTANCE.fit);
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

  /** Put the camera somewhere specific. (goHome is the way back to the auto-fitted world view.) */
  placeCamera(view) {
    aim(this.camera, view, this.controls.target);
    this.atHome = false;
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

  /** Return to the world view. */
  goHome(fly = true) {
    const view = this.homeView();
    if (fly) this.flyTo(view); else aim(this.camera, view, this.controls.target);
    this.atHome = true;
  }

  /**
   * A wheel turn over the map. Pinching, or scrolling with Ctrl or Cmd held, zooms.
   * A plain turn scrolls the page while the page has somewhere to go, and zooms once it has not.
   */
  onWheel(e) {
    e.stopImmediatePropagation();
    const now = performance.now();
    if (!e.ctrlKey && !e.metaKey) {
      const end = document.documentElement.scrollHeight - window.innerHeight;
      const pageMoves = e.deltaY < 0 ? window.scrollY > 0 : window.scrollY < end - 1;
      // The tail of a flick that scrolled the page is ignored, so reaching the top does not run on into a zoom.
      if (pageMoves || now - this.lastPageWheel < PAGE_SCROLL_GRACE) { this.lastPageWheel = now; return; }
    }
    e.preventDefault();
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);   // lines or pages to pixels
    let step;
    if (e.ctrlKey && !this.ctrlHeld && !e.metaKey) {
      step = clamp(delta, -40, 40) * PINCH_RATE;
    } else {
      step = clamp(delta, -120, 120) * WHEEL_RATE;
      // The first click of a mouse wheel can report a very small movement; make it count.
      if (now - this.lastWheel > 150 && Math.abs(step) < WHEEL_NOTCH) step = Math.sign(delta) * WHEEL_NOTCH;
    }
    this.lastWheel = now;
    this.zoomBy(step, e);
  }

  /** Queue a zoom about the pointer. `step` is the log of the change in distance: negative is closer. */
  zoomBy(step, event) {
    const rect = this.canvas.getBoundingClientRect();
    this.zoomPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    this.zoomPending += step;
    this.tween = null;
    this.atHome = false;
  }

  /** Change the camera's distance by `factor`, keeping the spot under a point on screen where it is. */
  zoomAt(x, y, factor) {
    const camera = this.camera, target = this.controls.target;
    const offset = TMP.copy(camera.position).sub(target), distance = offset.length();
    const next = clamp(distance * factor, DISTANCE.min, this.controls.maxDistance);
    if (next === distance) { this.zoomPending = 0; return; }   // at a limit; drop the rest
    const before = this.seaAt(x, y, SPOT_A);
    camera.position.copy(target).addScaledVector(offset, next / distance);
    camera.updateMatrixWorld();
    const after = this.seaAt(x, y, SPOT_B);
    if (before && after) {
      const dx = before.x - after.x, dz = before.z - after.z;
      target.x += dx; target.z += dz;
      camera.position.x += dx; camera.position.z += dz;
    }
  }

  /** Where a point on screen meets the sea surface, or null if it looks above the horizon. */
  seaAt(x, y, out) {
    POINTER.set(x / this.size.w * 2 - 1, 1 - y / this.size.h * 2);
    RAY.setFromCamera(POINTER, this.camera);
    const reach = -RAY.ray.origin.y / RAY.ray.direction.y;
    return reach > 0 && Number.isFinite(reach) ? out.copy(RAY.ray.origin).addScaledVector(RAY.ray.direction, reach) : null;
  }

  /** Move the camera closer (factor below 1) or further away, keeping its aim. */
  zoom(factor) {
    const view = this.currentView();
    view.distance = clamp(view.distance * factor, DISTANCE.min, this.controls.maxDistance);
    this.flyTo(view, 350);
    this.atHome = false;
  }

  /**
   * Select a chokepoint and move the camera to it, or pass null to select none.
   * Deselecting leaves the camera where it is: the user may still be looking there.
   */
  select(key, { fly = true } = {}) {
    this.selected = key;
    for (const pin of this.pins) pin.label.classList.toggle('is-selected', pin.key === key);
    this.brackets.visible = Boolean(key);
    if (fly && key) {
      this.flyTo(this.closeUpView(key));
      this.atHome = false;
    }
  }

  bindPointer() {
    let down = null;
    const cancelTween = () => { this.tween = null; };
    this.canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; cancelTween(); });
    const local = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const pinAt = ({ x, y }) => this.pins.find((p) => p.screen.visible && Math.hypot(p.screen.x - x, p.screen.y - 18 - y) < 26);
    this.canvas.addEventListener('pointerup', (e) => {
      const click = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 5;
      down = null;
      if (!click) return;   // that was a drag
      const at = local(e), pin = pinAt(at);
      if (pin) { this.onSelect(pin.key); return; }
      const ship = this.shipAt(at.x, at.y);
      if (ship || this.ship) this.selectShip(ship);
      // A click on nothing clears whatever was picked: the ship above, and the chokepoint here.
      if (!ship && this.selected) this.onSelect(null);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.buttons) return;
      const at = local(e);
      this.canvas.style.cursor = pinAt(at) || this.shipAt(at.x, at.y) ? 'pointer' : '';
    });
  }

  /** The drawn ship nearest a point on screen, if one is close enough to count as clicked. */
  shipAt(x, y) {
    const { w, h } = this.size;
    let best = null, reach = Math.max(20, (this.shipPixels ?? 0) * 0.45);
    for (let i = 0; i < this.drawnCount; i++) {
      const ship = this.drawn[i];
      TMP.set(ship.x, ship.size * 0.1, ship.z).project(this.camera);
      if (TMP.z > 1) continue;
      const d = Math.hypot((TMP.x * 0.5 + 0.5) * w - x, (-TMP.y * 0.5 + 0.5) * h - y);
      if (d < reach) { best = ship; reach = d; }
    }
    return best;
  }

  /** Pick a ship (one of the records from shipAt) or pass null to let go. */
  selectShip(pick) {
    this.ship = pick ? { route: pick.route, slot: pick.slot, kind: pick.kind, dir: pick.route.slots[pick.slot].dir, anchor: null } : null;
    this.shipFrame.visible = false;   // shown once the next frame has placed it
    this.shipCard.hidden = !pick;
    this.onShip(this.shipInfo());
  }

  shipInfo() {
    return this.ship && { route: this.ship.route.key, kind: SHIP_KINDS[this.ship.kind].key, forward: this.ship.dir > 0 };
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
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;

    if (this.tween) {
      const { from, to, start, ms } = this.tween;
      const t = clamp((now - start) / ms, 0, 1), k = ease(t);
      const mix = (key) => from[key] + (to[key] - from[key]) * k;
      aim(this.camera, { x: mix('x'), z: mix('z'), distance: mix('distance'), polar: mix('polar'), azimuth: mix('azimuth') }, this.controls.target);
      if (t === 1) this.tween = null;
    }
    if (Math.abs(this.zoomPending) > 1e-4) {
      // Ease the queued zoom in over a few frames: quick enough to feel direct, smooth for a mouse wheel's jumps.
      const step = this.zoomPending * Math.min(1, dt * 18);
      this.zoomPending -= step;
      this.zoomAt(this.zoomPoint.x, this.zoomPoint.y, Math.exp(step));
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
    const landHeight = px * 7 * Math.pow(zoom, 0.35);
    for (const [detail, meshes] of Object.entries(this.land)) {
      for (const mesh of meshes) {
        mesh.visible = (detail === 'fine') === fine;
        mesh.scale.y = landHeight;
      }
    }
    if (this.borders) {
      // Borders arrive with the detailed coastline and fade up over the next stretch of zoom.
      const opacity = clamp((FINE_LAND_WITHIN - distance) / 30, 0, 1);
      this.borderMaterial.opacity = opacity;
      for (const lines of this.borders) {
        lines.visible = opacity > 0;
        lines.position.y = landHeight;
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

    // A lane is as wide as the traffic on it, easing as the date changes, and a
    // little wider close in. Dashes keep their size on screen and drift along.
    const closeIn = Math.pow(zoom, 0.3);
    for (const trunk of this.trunks) {
      trunk.width += (laneWidth(trunk.flow) - trunk.width) * Math.min(1, dt * 4);
      trunk.base.linewidth = trunk.width * closeIn;
      trunk.dash.linewidth = Math.max(0.9, trunk.width * closeIn * 0.4);
      trunk.dash.dashScale = 1 / (px * 5.5);
      trunk.dash.dashOffset -= dt * 1.6;
    }

    this.updateShips(dt, px, zoom, distance);
    this.updatePins(now / 1000, px);
    this.renderer.render(this.scene, this.camera);
    this.placeLabels(distance, landHeight, px);
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
    // Ship length in scene units: about 25 pixels in the world view on a desktop, fewer on a phone.
    const length = px * Math.min(72, clamp(this.size.w / 58, 13, 25) * Math.pow(zoom, 0.42));
    this.travel += dt * length * 0.34;
    this.shipPixels = length / px;
    this.drawnCount = 0;
    const counts = SHIP_KINDS.map(() => 0);
    const centre = this.controls.target.x, reach = distance * 2.4 + 30;
    const edge = length * 2.5;
    const picked = this.ship;
    let anchor = null;

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
        const yaw = Math.atan2(-hz, hx);
        QUAT.setFromAxisAngle(UP, yaw);
        SCALE.set(size, size * 1.5, size * 1.55);   // toy proportions: taller and beamier than life
        if (picked && picked.route === route && picked.slot === k) anchor = { x: this.nearestCopy(x), z, size, yaw, kind };

        for (const copy of COPIES) {
          const cx = x + copy * WORLD_WIDTH;
          if (Math.abs(cx - centre) > reach) continue;
          POSITION.set(cx, Math.sin(this.travel / length * 0.9 + slot.phase * 40) * size * 0.006, z);
          MATRIX.compose(POSITION, QUAT, SCALE);
          this.shipMeshes[kind].setMatrixAt(counts[kind]++, MATRIX);
          const record = this.drawn[this.drawnCount] ?? (this.drawn[this.drawnCount] = {});
          this.drawnCount++;
          record.route = route; record.slot = k; record.kind = kind;
          record.x = cx; record.z = z; record.size = size;
        }
      }
    }
    this.shipMeshes.forEach((mesh, i) => {
      mesh.count = counts[i];
      mesh.instanceMatrix.needsUpdate = true;
    });
    if (picked) this.followShip(anchor, length);
  }

  /** Keep the corner marks on the picked ship; let go of it once it has left the map. */
  followShip(anchor, length) {
    if (!anchor || anchor.size < length * 0.35) {   // traffic fell, or it reached the end of its route
      this.selectShip(null);
      return;
    }
    const ship = this.ship;
    ship.anchor = anchor;
    this.shipFrame.visible = true;
    this.shipFrame.position.set(anchor.x, 0, anchor.z);
    this.shipFrame.rotation.y = anchor.yaw;
    this.shipFrame.scale.set(anchor.size, anchor.size * 1.5, anchor.size * 1.55);
    if (anchor.kind !== ship.kind) {   // the mix of ship types changed with the date
      ship.kind = anchor.kind;
      this.onShip(this.shipInfo());
    }
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

  placeLabels(distance, landHeight, px) {
    const { w, h } = this.size;

    // Pin labels first; the place names then keep out of their way.
    const taken = [];
    for (const pin of this.pins) {
      const scale = pin.group.scale.x;
      TMP.set(pin.group.position.x, (pin.marker.position.y + 1.55) * scale, pin.group.position.z).project(this.camera);
      const visible = TMP.z < 1 && Math.abs(TMP.x) < 1.1 && Math.abs(TMP.y) < 1.1;
      const x = (TMP.x * 0.5 + 0.5) * w, y = (-TMP.y * 0.5 + 0.5) * h;
      pin.screen = { x, y, visible };
      pin.label.style.display = visible ? '' : 'none';
      if (!visible) continue;
      pin.label.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      // Roughly where the label and the pin itself sit, by which side the label is on.
      const side = pin.label.dataset.side, wide = pin.key === this.selected ? 250 : 150;
      taken.push({ left: x - 14, right: x + 14, top: y - 14, bottom: y + 26 });
      taken.push(side === 'left' ? { left: x - 14 - wide, right: x - 14, top: y - 14, bottom: y + 14 }
        : side === 'right' ? { left: x + 14, right: x + 14 + wide, top: y - 14, bottom: y + 14 }
          : { left: x - wide / 2, right: x + wide / 2, top: y - 40, bottom: y - 12 });
    }

    // A name shows if it is on the map, clear of the cards, and nothing else is already written there.
    const free = (box) => box.left > 4 && box.right < w - 4 && box.top > this.insets.top + 4 && box.bottom < h - this.insets.bottom
      && !this.obstacles.some((r) => box.left < r.right + 6 && box.right > r.left - 6 && box.top < r.bottom + 6 && box.bottom > r.top - 6)
      && !taken.some((r) => box.left < r.right && box.right > r.left && box.top < r.bottom && box.bottom > r.top);
    // `nudges` are the vertical shifts, in pixels, a name may try when its own spot is taken.
    const place = (label, wanted, height, halfWidth, nudges = [0]) => {
      let shown = false;
      if (wanted) {
        TMP.set(this.nearestCopy(label.x), height, label.z).project(this.camera);
        if (TMP.z < 1) {
          const x = (TMP.x * 0.5 + 0.5) * w, at = (-TMP.y * 0.5 + 0.5) * h;
          for (const nudge of nudges) {
            const y = at + nudge;
            const box = { left: x - halfWidth, right: x + halfWidth, top: y - 9, bottom: y + 9 };
            if (!free(box)) continue;
            shown = true;
            taken.push(box);
            label.node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
            break;
          }
        }
      }
      if (shown !== label.shown) {
        label.shown = shown;
        label.node.classList.toggle('is-shown', shown);
      }
    };
    const near = distance < NEAR_LABELS_WITHIN;
    for (const label of this.mapLabels) place(label, label.near === near, label.onLand ? landHeight : 0, 50);
    if (this.countryLabels) {
      // Biggest first. A country gets its name once it is about ten pixels across on screen.
      const smallest = px * 10;
      for (const label of this.countryLabels) {
        // A name may slide a little way up or down its country to get clear, less far in a small one.
        const room = label.size / px * 0.35;
        place(label, near && label.size >= smallest, landHeight, label.width / 2 + 5, NAME_NUDGES.filter((n) => Math.abs(n) <= room));
      }
    }

    const anchor = this.ship?.anchor;
    if (anchor) {
      // The card sits beside the ship: above it, below it, or to one side. It takes the first
      // spot that is clear of the other cards; failing that, the first that is on screen at all.
      TMP.set(anchor.x, anchor.size * 0.3, anchor.z).project(this.camera);
      const x = (TMP.x * 0.5 + 0.5) * w, y = (-TMP.y * 0.5 + 0.5) * h;
      const card = this.shipCard, cw = card.offsetWidth, ch = card.offsetHeight, gap = this.shipPixels * 0.5 + 14;
      const edge = 8, centred = clamp(x - cw / 2, edge, Math.max(edge, w - cw - edge));
      const beside = [y - ch / 2, y - ch * 0.8, y - ch * 0.2].map((top) => clamp(top, edge, Math.max(edge, h - ch - edge)));
      const spots = [
        [centred, y - gap - ch], [centred, y + gap],
        ...beside.flatMap((top) => [[x + gap, top], [x - gap - cw, top]]),
      ];
      const floor = h - this.insets.bottom - edge;   // the section below the map
      const onScreen = ([left, top]) => left >= edge && left + cw <= w - edge && top >= this.insets.top + edge && top + ch <= floor;
      const clear = ([left, top]) => !this.obstacles.some((r) => left < r.right + 6 && left + cw > r.left - 6 && top < r.bottom + 6 && top + ch > r.top - 6);
      // Last resort, on a small screen: keep the whole card readable even if it covers the ship.
      const squeezed = [centred, clamp(y + gap, this.insets.top + edge, Math.max(this.insets.top + edge, floor - ch))];
      const [left, top] = spots.find((s) => onScreen(s) && clear(s)) ?? spots.find(onScreen) ?? squeezed;
      card.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
    }
  }
}

// Scratch objects reused every frame.
const HERE = { x: 0, z: 0 }, AHEAD = { x: 0, z: 0 }, BEHIND = { x: 0, z: 0 };
const POSITION = new THREE.Vector3(), SCALE = new THREE.Vector3(), TMP = new THREE.Vector3(), TARGET = new THREE.Vector3();
const QUAT = new THREE.Quaternion(), MATRIX = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);
const RAY = new THREE.Raycaster(), POINTER = new THREE.Vector2(), SPOT_A = new THREE.Vector3(), SPOT_B = new THREE.Vector3();

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
