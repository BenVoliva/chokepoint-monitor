// The timeline chart: one chokepoint's transits since 2019, the events that
// bear on it, Brent crude underneath on its own scale, and the date scrubber.

import { el, svg } from './dom.js';
import { fmtDate, fmtCount, fmtDollars } from './format.js';

const MARGIN = { left: 40, right: 14 };
const RAIL = 18;      // event markers
const PLOT = 78;      // transits
const GAP = 22;       // holds the Brent title
const BRENT = 30;
const AXIS = 18;      // year labels
const HEIGHT = RAIL + PLOT + GAP + BRENT + AXIS;
const STEP = 7;       // draw one point a week; the scrubber still moves by the day

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Smallest 1/2/5 step that needs at most three gridlines to clear `max`. */
function tickStep(max) {
  for (let power = -1; power < 7; power++) {
    for (const m of [1, 2, 5]) {
      const step = m * 10 ** power;
      if (Math.ceil(max / step) <= 3) return step;
    }
  }
  return max;
}

export class TimelineChart {
  /**
   * @param {object} o
   * @param {HTMLElement} o.host      element the chart fills; also the keyboard slider
   * @param {HTMLElement} o.tooltip   shared floating tooltip
   * @param {object} o.model
   * @param {(day: number) => void} o.onDay
   * @param {(event: object) => void} o.onEvent
   */
  constructor({ host, tooltip, model, onDay, onEvent }) {
    Object.assign(this, { host, tooltip, model, onDay, onEvent });
    this.day = model.latest;
    this.events = [];
    this.svg = svg('svg', { class: 'chart', 'aria-hidden': 'true' });
    host.append(this.svg);
    host.tabIndex = 0;
    host.setAttribute('role', 'slider');
    host.setAttribute('aria-label', 'Date shown on the map');
    host.setAttribute('aria-valuemin', 0);
    host.setAttribute('aria-valuemax', model.days - 1);
    this.bind();
    new ResizeObserver(() => this.render()).observe(host);
  }

  /** Chart this chokepoint, with the events that bear on it. */
  show(chokepoint, events) {
    this.chokepoint = chokepoint;
    this.events = events;
    this.render();
  }

  setDay(day, activeEvent) {
    this.day = day;
    this.active = activeEvent;
    this.host.setAttribute('aria-valuenow', day);
    this.host.setAttribute('aria-valuetext', fmtDate(this.model.dateAt(day)));
    this.placeScrubber();
  }

  render() {
    const width = this.host.clientWidth;
    const c = this.chokepoint, { model } = this;
    if (!width || !c) return;
    const x0 = MARGIN.left, x1 = width - MARGIN.right, last = model.days - 1;
    this.x = (i) => x0 + (i / last) * (x1 - x0);
    this.dayAt = (px) => Math.round(clamp((px - x0) / (x1 - x0), 0, 1) * last);

    const samples = [];
    for (let i = last; i >= 6; i -= STEP) samples.push(i);
    samples.reverse();

    // Transits plot.
    const top = RAIL, bottom = RAIL + PLOT;
    const peak = samples.reduce((m, i) => Math.max(m, c.avg7[i], c.baseline[i]), 0);
    const step = tickStep(peak), ceiling = Math.ceil(peak / step) * step;
    this.y = (v) => bottom - (v / ceiling) * PLOT;
    const path = (value) => samples.map((i, k) => `${k ? 'L' : 'M'}${this.x(i).toFixed(1)} ${value(i).toFixed(1)}`).join('');
    const line = path((i) => this.y(c.avg7[i]));

    // Brent plot, on its own scale (not zero-based, so its ticks say what the range is).
    const brentTop = bottom + GAP, brentBottom = brentTop + BRENT;
    const priced = samples.filter((i) => Number.isFinite(model.brentAt(i)));
    const prices = priced.map((i) => model.brentAt(i));
    const lo = Math.min(...prices), hi = Math.max(...prices);
    this.yBrent = (v) => brentBottom - ((v - lo) / (hi - lo || 1)) * BRENT;
    const brentLine = priced.map((i, k) => `${k ? 'L' : 'M'}${this.x(i).toFixed(1)} ${this.yBrent(model.brentAt(i)).toFixed(1)}`).join('');

    const grid = svg('g', { class: 'chart__grid' });
    for (let v = 0; v <= ceiling; v += step) {
      grid.append(
        svg('line', { x1: x0, x2: x1, y1: this.y(v), y2: this.y(v) }),
        svg('text', { x: x0 - 8, y: this.y(v) + 3.5, 'text-anchor': 'end', text: fmtCount(v) }));
    }
    for (const v of [lo, hi]) {
      grid.append(svg('text', { x: x0 - 8, y: this.yBrent(v) + 3.5, 'text-anchor': 'end', text: `$${Math.round(v)}` }));
    }
    grid.append(svg('line', { x1: x0, x2: x1, y1: brentBottom, y2: brentBottom }));
    const first = model.dateAt(0).getUTCFullYear(), final = model.dateAt(last).getUTCFullYear();
    for (let year = first; year <= final; year++) {
      const px = this.x(Math.max(0, model.indexOf(`${year}-01-01`)));
      if (year > first) grid.append(svg('line', { class: 'chart__year', x1: px, x2: px, y1: top, y2: brentBottom }));
      grid.append(svg('text', { x: px + 5, y: HEIGHT - 4, text: year }));
    }

    const markers = svg('g', { class: 'chart__events' });
    this.markers = this.events.map((event) => {
      const node = svg('circle', {
        class: `chart__event${event.kind === 'data' ? ' chart__event--note' : ''}`,
        cx: this.x(event.index), cy: RAIL / 2, r: 4.5,
      });
      markers.append(node);
      return { event, node, px: this.x(event.index) };
    });

    this.hover = svg('line', { class: 'chart__hover', y1: top, y2: brentBottom, visibility: 'hidden' });
    this.scrubLine = svg('line', { class: 'chart__scrub', y1: 2, y2: brentBottom });
    this.scrubDot = svg('circle', { class: 'chart__dot', r: 5 });
    this.scrubBrent = svg('circle', { class: 'chart__dot chart__dot--muted', r: 4 });

    this.svg.setAttribute('viewBox', `0 0 ${width} ${HEIGHT}`);
    this.svg.setAttribute('width', width);
    this.svg.setAttribute('height', HEIGHT);
    this.svg.replaceChildren(
      grid,
      svg('path', { class: 'chart__area', d: `${line}L${this.x(samples[samples.length - 1]).toFixed(1)} ${bottom}L${this.x(samples[0]).toFixed(1)} ${bottom}Z` }),
      svg('path', { class: 'chart__baseline', d: path((i) => this.y(c.baseline[i])) }),
      svg('path', { class: 'chart__line', d: line }),
      svg('text', { class: 'chart__caption', x: x0, y: brentTop - 9, text: 'Brent crude, US dollars a barrel' }),
      svg('path', { class: 'chart__brent', d: brentLine }),
      markers, this.hover, this.scrubLine, this.scrubDot, this.scrubBrent);
    this.placeScrubber();
  }

  placeScrubber() {
    if (!this.x || !this.scrubLine) return;
    const px = this.x(this.day), c = this.chokepoint;
    this.scrubLine.setAttribute('x1', px);
    this.scrubLine.setAttribute('x2', px);
    this.scrubDot.setAttribute('cx', px);
    this.scrubDot.setAttribute('cy', this.y(c.avg7[this.day]));
    const brent = this.model.brentAt(this.day);
    this.scrubBrent.setAttribute('cx', px);
    this.scrubBrent.setAttribute('cy', this.yBrent(brent));
    for (const m of this.markers) m.node.classList.toggle('is-active', m.event === this.active);
  }

  /** The event marker under the pointer, if the pointer is on the rail. */
  markerAt(px, py) {
    if (py > RAIL + 6) return null;
    let best = null;
    for (const m of this.markers) {
      const d = Math.abs(m.px - px);
      if (d <= 14 && (!best || d < Math.abs(best.px - px))) best = m;
    }
    return best;
  }

  bind() {
    const { host } = this;
    let dragging = false;
    const local = (e) => {
      const rect = this.svg.getBoundingClientRect();
      return { px: e.clientX - rect.left, py: e.clientY - rect.top };
    };

    host.addEventListener('pointerdown', (e) => {
      if (!this.x) return;
      const { px, py } = local(e);
      const marker = this.markerAt(px, py);
      if (marker) { this.onEvent(marker.event); return; }
      dragging = true;
      host.setPointerCapture(e.pointerId);
      this.onDay(this.dayAt(px));
      this.hideHover();
    });
    host.addEventListener('pointermove', (e) => {
      if (!this.x) return;
      const { px, py } = local(e);
      if (dragging) { this.onDay(this.dayAt(px)); return; }
      const marker = this.markerAt(px, py);
      host.style.cursor = marker ? 'pointer' : 'ew-resize';
      if (marker) this.showEventTip(marker.event, e);
      else this.showValueTip(this.dayAt(px), e);
    });
    const end = () => { dragging = false; };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
    host.addEventListener('pointerleave', () => this.hideHover());

    host.addEventListener('keydown', (e) => {
      const jump = { ArrowLeft: -1, ArrowRight: 1, PageDown: -30, PageUp: 30 }[e.key];
      if (jump) this.onDay(this.day + jump * (e.shiftKey ? 7 : 1));
      else if (e.key === 'Home') this.onDay(0);
      else if (e.key === 'End') this.onDay(this.model.latest);
      else return;
      e.preventDefault();
    });
  }

  hideHover() {
    this.hover?.setAttribute('visibility', 'hidden');
    this.tooltip.hidden = true;
  }

  showValueTip(day, e) {
    const c = this.chokepoint, px = this.x(day);
    this.hover.setAttribute('x1', px);
    this.hover.setAttribute('x2', px);
    this.hover.setAttribute('visibility', 'visible');
    const row = (key, value, label) => el('div', { class: 'tooltip__row' },
      el('span', { class: `tooltip__key tooltip__key--${key}` }),
      el('strong', { text: value }),
      el('span', { text: label }));
    this.tooltip.replaceChildren(
      el('div', { class: 'tooltip__title', text: fmtDate(this.model.dateAt(day)) }),
      row('series', fmtCount(c.avg7[day]), 'ships a day, 7-day average'),
      row('baseline', fmtCount(c.baseline[day]), 'normal for the month'),
      row('brent', fmtDollars(this.model.brentAt(day)), 'Brent crude'));
    this.placeTip(e);
  }

  showEventTip(event, e) {
    this.hover.setAttribute('visibility', 'hidden');
    this.tooltip.replaceChildren(
      el('div', { class: 'tooltip__title', text: fmtDate(event.day) }),
      el('div', { class: 'tooltip__text', text: event.title }));
    this.placeTip(e);
  }

  placeTip(e) {
    const tip = this.tooltip;
    tip.hidden = false;
    const { width, height } = tip.getBoundingClientRect();
    tip.style.left = `${clamp(e.clientX + 14, 8, window.innerWidth - width - 8)}px`;
    tip.style.top = `${clamp(e.clientY - height - 14, 8, window.innerHeight - height - 8)}px`;
  }
}
