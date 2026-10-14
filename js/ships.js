// Low-poly ship models, built in code. Each is one merged geometry with vertex
// colours, one unit long with the bow towards +x, sitting on the waterline.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WHITE = '#f7f9fd';
const DECK = '#e9edf7';
const KEEL = '#27335f';
const GLASS = '#2f3c6b';
const STEEL = '#9aa6c6';

/** Ship kinds drawn on the map. Hull colours match the chart legend; general
 *  cargo and vehicle carriers share one neutral "other" model. */
export const SHIP_KINDS = [
  { key: 'container', label: 'Container', name: 'Container ship', plural: 'container ships', color: '#2a78d6', types: ['container'] },
  { key: 'tanker', label: 'Tanker', name: 'Tanker', plural: 'tankers', color: '#eb6834', types: ['tanker'] },
  { key: 'dry_bulk', label: 'Dry bulk', name: 'Bulk carrier', plural: 'bulk carriers', color: '#1baf7a', types: ['dry_bulk'] },
  { key: 'other', label: 'Other cargo', name: 'Cargo ship', plural: 'general cargo ships and vehicle carriers', color: '#7d88a8', types: ['general_cargo', 'roro'] },
];

function tint(geometry, hex) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  const color = new THREE.Color(hex);
  const colors = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** A box resting on height y, centred at x/z. */
function box(length, height, beam, x, y, z, color) {
  const g = new THREE.BoxGeometry(length, height, beam);
  g.translate(x, y + height / 2, z);
  return tint(g, color);
}

/** A hull slab seen from above: squared-off stern, pointed bow. */
function hull(length, beam, height, y, color) {
  const l = length / 2, b = beam / 2;
  const outline = new THREE.Shape();
  outline.moveTo(-l, -b * 0.72);
  outline.lineTo(-l + length * 0.05, -b);
  outline.lineTo(l - length * 0.22, -b);
  outline.lineTo(l, 0);
  outline.lineTo(l - length * 0.22, b);
  outline.lineTo(-l + length * 0.05, b);
  outline.lineTo(-l, b * 0.72);
  outline.closePath();
  const g = new THREE.ExtrudeGeometry(outline, { depth: height, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);   // lie flat: the extrusion becomes height
  g.translate(0, y, 0);
  return tint(g, color);
}

/** Keel band, coloured hull and deck shared by every ship; returns the deck height. */
function base(parts, length, beam, color) {
  parts.push(hull(length, beam, 0.03, -0.012, KEEL));
  parts.push(hull(length, beam, 0.05, 0.018, color));
  parts.push(hull(length * 0.985, beam * 0.92, 0.006, 0.068, DECK));
  return 0.074;
}

/** Accommodation block and funnel at the stern. */
function bridge(parts, x, deck, beam, color, height = 0.1) {
  parts.push(box(0.085, height, beam * 0.8, x, deck, 0, WHITE));
  parts.push(box(0.087, 0.016, beam * 0.82, x, deck + height - 0.03, 0, GLASS));
  parts.push(box(0.11, 0.008, beam * 0.95, x, deck + height, 0, WHITE));
  parts.push(box(0.035, 0.045, 0.045, x - 0.065, deck, 0, color));
}

function containerShip(color) {
  const parts = [], beam = 0.165;
  const deck = base(parts, 1, beam, color);
  const boxColors = [WHITE, '#e3b56f', '#9db8ee', WHITE, '#6d90de', '#e3b56f'];
  for (let bay = 0; bay < 7; bay++) {
    const x = -0.21 + bay * 0.088;
    for (const side of [-1, 1]) {
      const levels = 1 + ((bay * 3 + (side > 0 ? 1 : 0)) % 3 ? 1 : 0);
      for (let level = 0; level < levels; level++) {
        parts.push(box(0.078, 0.03, 0.068, x, deck + level * 0.032, side * 0.037,
          boxColors[(bay * 2 + level + (side > 0 ? 1 : 0)) % boxColors.length]));
      }
    }
  }
  bridge(parts, -0.36, deck, beam, color, 0.12);
  return mergeGeometries(parts);
}

function tanker(color) {
  const parts = [], beam = 0.18;
  const deck = base(parts, 1.06, beam, color);
  parts.push(box(0.64, 0.012, 0.014, 0.05, deck, 0, STEEL));          // centreline pipe
  for (const x of [-0.12, 0.05, 0.22]) parts.push(box(0.014, 0.016, 0.13, x, deck, 0, STEEL));
  for (let i = 0; i < 5; i++) {                                       // tank hatches
    for (const side of [-1, 1]) parts.push(box(0.05, 0.006, 0.04, -0.2 + i * 0.125, deck, side * 0.05, '#f3c9b4'));
  }
  bridge(parts, -0.39, deck, beam, color, 0.11);
  return mergeGeometries(parts);
}

function bulkCarrier(color) {
  const parts = [], beam = 0.17;
  const deck = base(parts, 1, beam, color);
  for (let i = 0; i < 5; i++) {                                       // hatch covers
    parts.push(box(0.105, 0.018, 0.118, -0.2 + i * 0.128, deck, 0, i % 2 ? '#dfe5f2' : '#cfd8ec'));
  }
  bridge(parts, -0.37, deck, beam, color, 0.1);
  return mergeGeometries(parts);
}

function otherCargo(color) {
  const parts = [], beam = 0.17;
  const deck = base(parts, 0.8, beam, color);
  parts.push(box(0.56, 0.1, beam * 0.86, -0.06, deck, 0, WHITE));       // enclosed car decks
  parts.push(box(0.565, 0.014, beam * 0.88, -0.06, deck + 0.045, 0, '#b9c6ea'));
  parts.push(box(0.08, 0.028, beam * 0.8, 0.17, deck + 0.1, 0, WHITE));
  parts.push(box(0.082, 0.012, beam * 0.82, 0.17, deck + 0.108, 0, GLASS));
  parts.push(box(0.035, 0.04, 0.045, -0.28, deck + 0.1, 0, color));
  return mergeGeometries(parts);
}

const BUILDERS = { container: containerShip, tanker, dry_bulk: bulkCarrier, other: otherCargo };

/** { kindKey: BufferGeometry } for every kind in SHIP_KINDS. */
export function buildShipModels() {
  return Object.fromEntries(SHIP_KINDS.map((kind) => [kind.key, BUILDERS[kind.key](kind.color)]));
}
