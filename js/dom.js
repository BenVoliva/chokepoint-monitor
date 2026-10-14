// Tiny DOM helpers and the icon set.

const SVG_NS = 'http://www.w3.org/2000/svg';

function build(node, attrs, children) {
  for (const [name, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (name === 'text') node.textContent = value;
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) node.append(child);   // strings become text nodes
  }
  return node;
}

/** el('div', { class: 'x', text: 'Hello', onclick: fn }, ...children) */
export function el(tag, attrs = {}, ...children) {
  return build(document.createElement(tag), attrs, children);
}

export function svg(tag, attrs = {}, ...children) {
  return build(document.createElementNS(SVG_NS, tag), attrs, children);
}

// 24x24 line icons, drawn here so the page loads no icon font.
const ICONS = {
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
  locate: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  external: '<path d="M14 5h5v5M19 5l-8.5 8.5M11 6.5H6V18h11.5v-5"/>',
  code: '<path d="M9 8l-4.5 4L9 16M15 8l4.5 4L15 16"/>',
  up: '<path d="M12 19V6M6.5 11.5L12 6l5.5 5.5"/>',
  down: '<path d="M12 5v13M6.5 12.5L12 18l5.5-5.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  trendDown: '<path d="M3.5 7l6.5 6.5 4-4 6.5 6.5M20.5 11v5h-5"/>',
  trendUp: '<path d="M3.5 17l6.5-6.5 4 4L20.5 8M20.5 13V8h-5"/>',
  alert: '<path d="M12 4l9 15.5H3zM12 10v4.2M12 16.8v.4"/>',
  stop: '<path d="M8.6 3h6.8L21 8.6v6.8L15.4 21H8.6L3 15.4V8.6zM9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>',
  ship: '<path d="M3 14.5l2 5h14l2-5zM6 14.5V10h7.5l3 4.5M10 10V6"/>',
  box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8"/>',
  drop: '<path d="M12 3.2c3.6 4.5 6 7.4 6 10.6a6 6 0 01-12 0c0-3.2 2.4-6.1 6-10.6z"/>',
  chart: '<path d="M4 5v14h16M8 15l3.2-4 3 2.2L19 7.5"/>',
  flag: '<path d="M6 21V4M6 5h11.5l-2.2 3.5 2.2 3.5H6"/>',
  anchor: '<circle cx="12" cy="5.5" r="2"/><path d="M12 7.5V20M5 13.5c0 4 3 6.5 7 6.5s7-2.5 7-6.5M9 11h6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.4v.4"/>',
  table: '<path d="M4 5h16v14H4zM4 10h16M4 14.5h16M10 5v14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M6 9.5l6 6 6-6"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  panelHide: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M15 4.5v15M8.5 9.5L11 12l-2.5 2.5"/>',
  panelShow: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M15 4.5v15M10.5 9.5L8 12l2.5 2.5"/>',
};

/** An icon as an inline SVG element. `name` is always one of the constants above. */
export function icon(name, size = 16) {
  const node = svg('svg', {
    class: 'icon', width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });
  node.innerHTML = ICONS[name];
  return node;
}

/** Icon that goes with each status tone, so status never rests on colour alone. */
export const TONE_ICON = { good: 'check', warning: 'trendDown', serious: 'alert', critical: 'stop', info: 'trendUp' };
