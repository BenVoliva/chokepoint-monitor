// The timeline chart, with event markers above it, Brent crude underneath on
// its own scale, and the date scrubber. With a chokepoint selected it charts
// that one's transits against its normal level. With none it compares all six,
// each as a share of its own normal, which puts them on one scale.

import { el, svg } from './dom.js';
import { fmtDate, fmtCount, fmtDollars } from './format.js';

const MARGIN = { left: 40, right: 14 };
const RAIL = 18;      // event markers
const MIN_PLOT = 78;  // the main plot; grows to use whatever height the card has spare
const GAP = 22;       // holds the Brent title
const BRENT = 30;
const AXIS = 18;      // year labels
/** Height the chart needs at least; styles.css gives its host the same minimum. */
export const MIN_HEIGHT = RAIL + MIN_PLOT + GAP + BRENT + AXIS;
const STEP = 7;       // draw one point a week; the scrubber still moves by the day
const YEAR_LABEL = 34;   // room a year's label needs along the bottom

// The compare view names each line at its right-hand end. On a chart narrower
// than `narrowBelow` the names get less room and the long one is cut short.
const NAMES = { wide: 122, narrow: 100, narrowBelow: 520 };
const BRIEF_NAMES = { cape: 'Cape' };
const NAME_GAP = 12;   // least space between two names, top to top

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
   * @param {(key: string) => void} o.onPick  a line's name was clicked in the compare view
   */
  constructor({ host, tooltip, model, onDay, onEvent, onPick }) {
    Object.assign(this, { host, tooltip, model, onDay, onEvent, onPick });
    this.day = model.latest;
    this.events = null;
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

  /** Chart one chokepoint, or pass null to compare all six. `events` are the markers to show. */
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
    const { model } = this;
    if (!width || !this.events) return;
    const compare = !this.chokepoint;
    const names = !compare ? 0 : width < NAMES.narrowBelow ? NAMES.narrow : NAMES.wide;
    const x0 = MARGIN.left, x1 = width - (names || MARGIN.right), last = model.days - 1;
    this.x = (i) => x0 + (i / last) * (x1 - x0);
    this.dayAt = (px) => Math.round(clamp((px - x0) / (x1 - x0), 0, 1) * last);

    const samples = [];
    for (let i = last; i >= 6; i -= STEP) samples.push(i);
    samples.reverse();
    const path = (value) => samples.map((i, k) => `${k ? 'L' : 'M'}${this.x(i).toFixed(1)} ${value(i).toFixed(1)}`).join('');

    const height = Math.max(MIN_HEIGHT, this.host.clientHeight);
    const frame = { x0, x1, top: RAIL, bottom: height - (GAP + BRENT + AXIS), samples, path, names };
    const grid = svg('g', { class: 'chart__grid' });
    this.hot = null;
    const plot = compare ? this.drawAll(frame, grid) : this.drawOne(frame, grid);

    // Brent, on its own scale (not zero-based, so its ticks say what the range is).
    const brentTop = frame.bottom + GAP, brentBottom = brentTop + BRENT;
    const priced = samples.filter((i) => Number.isFinite(model.brentAt(i)));
    const prices = priced.map((i) => model.brentAt(i));
    const lo = Math.min(...prices), hi = Math.max(...prices);
    this.yBrent = (v) => brentBottom - ((v - lo) / (hi - lo || 1)) * BRENT;
    const brentLine = priced.map((i, k) => `${k ? 'L' : 'M'}${this.x(i).toFixed(1)} ${this.yBrent(model.brentAt(i)).toFixed(1)}`).join('');
    for (const v of [lo, hi]) {
      grid.append(svg('text', { x: x0 - 8, y: this.yBrent(v) + 3.5, 'text-anchor': 'end', text: `$${Math.round(v)}` }));
    }
    grid.append(svg('line', { x1: x0, x2: x1, y1: brentBottom, y2: brentBottom }));
    const first = model.dateAt(0).getUTCFullYear(), final = model.dateAt(last).getUTCFullYear();
    const every = this.x(365) - x0 < YEAR_LABEL ? 2 : 1;   // on a narrow chart, name every other year
    for (let year = first; year <= final; year++) {
      const px = this.x(Math.max(0, model.indexOf(`${year}-01-01`)));
      if (year > first) grid.append(svg('line', { class: 'chart__year', x1: px, x2: px, y1: frame.top, y2: brentBottom }));
      if ((year - first) % every === 0) grid.append(svg('text', { x: px + 5, y: height - 4, text: year }));
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

    this.hover = svg('line', { class: 'chart__hover', y1: frame.top, y2: brentBottom, visibility: 'hidden' });
    this.scrubLine = svg('line', { class: 'chart__scrub', y1: 2, y2: brentBottom });
    this.scrubBrent = svg('circle', { class: 'chart__dot chart__dot--muted', r: 4 });

    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.svg.setAttribute('width', width);
    this.svg.setAttribute('height', height);
    this.svg.replaceChildren(
      grid,
      ...plot,
      svg('text', { class: 'chart__caption', x: x0, y: brentTop - 9, text: 'Brent crude, US dollars a barrel' }),
      svg('path', { class: 'chart__brent', d: brentLine }),
      markers, this.hover, this.scrubLine, ...this.scrubDots, this.scrubBrent);
    this.placeScrubber();
  }

  /** One chokepoint: ships a day (7-day average) as an area, with its normal level as a line. */
  drawOne({ x0, x1, bottom, top, samples, path }, grid) {
    const c = this.chokepoint, plot = bottom - top;
    // Scale to the data, but not to a freak spike: PortWatch has a few days of
    // plainly wrong counts (late January 2020), which would flatten everything
    // else. Such a spike is clipped at the top of the plot instead.
    const sorted = samples.map((i) => c.avg7[i]).sort((a, b) => a - b);
    const typicalTop = sorted[Math.floor(sorted.length * 0.99)], top1 = sorted[sorted.length - 1];
    const peak = samples.reduce((m, i) => Math.max(m, c.baseline[i]), top1 > typicalTop * 1.5 ? typicalTop : top1);
    const step = tickStep(peak), ceiling = Math.ceil(peak / step) * step;
    const y = (v) => bottom - (Math.min(v, ceiling * 1.04) / ceiling) * plot;
    for (let v = 0; v <= ceiling; v += step) {
      grid.append(
        svg('line', { x1: x0, x2: x1, y1: y(v), y2: y(v) }),
        svg('text', { x: x0 - 8, y: y(v) + 3.5, 'text-anchor': 'end', text: fmtCount(v) }));
    }
    const line = path((i) => y(c.avg7[i]));
    this.lines = [];
    this.scrubDots = [svg('circle', { class: 'chart__dot', r: 5 })];
    this.dotY = [(day) => y(c.avg7[day])];
    return [
      svg('path', { class: 'chart__area', d: `${line}L${this.x(samples[samples.length - 1]).toFixed(1)} ${bottom}L${this.x(samples[0]).toFixed(1)} ${bottom}Z` }),
      svg('path', { class: 'chart__baseline', d: path((i) => y(c.baseline[i])) }),
      svg('path', { class: 'chart__line', d: line }),
    ];
  }

  /**
   * All six chokepoints, each as a percentage of its own normal. The lines are
   * drawn alike and named at the right-hand end; pointing at one picks it out.
   */
  drawAll({ x0, x1, bottom, top, samples, path, names }, grid) {
    const plot = bottom - top;
    const share = (c, day) => c.ratio(day) * 100;
    // As in the single view, the scale ignores the few freak readings and clips them.
    const shares = this.model.chokepoints.flatMap((c) => samples.map((i) => share(c, i))).sort((a, b) => a - b);
    const ceiling = Math.max(150, Math.ceil(shares[Math.floor(shares.length * 0.995)] / 50) * 50);
    const y = (v) => bottom - (Math.min(v, ceiling * 1.04) / ceiling) * plot;
    for (let v = 0; v <= ceiling; v += 100) {
      grid.append(
        svg('line', { class: v === 100 ? 'chart__normal' : null, x1: x0, x2: x1, y1: y(v), y2: y(v) }),
        svg('text', { x: x0 - 8, y: y(v) + 3.5, 'text-anchor': 'end', text: `${v}%` }));
    }
    const end = samples[samples.length - 1];
    this.lines = this.model.chokepoints.map((c) => ({
      c,
      node: svg('path', { class: 'chart__compare', d: path((i) => y(share(c, i))) }),
      endY: y(share(c, end)),
    }));

    // Spread the names so none overlap: push down from the top, then back up from the bottom.
    const stack = [...this.lines].sort((a, b) => a.endY - b.endY);
    let limit = top + 4;
    for (const line of stack) { line.nameY = Math.max(line.endY, limit); limit = line.nameY + NAME_GAP; }
    limit = bottom;
    for (const line of stack.reverse()) { line.nameY = Math.min(line.nameY, limit); limit = line.nameY - NAME_GAP; }
    const brief = names === NAMES.narrow;
    const labels = this.lines.flatMap((line) => {
      const { key, short } = line.c;
      line.name = svg('text', { class: 'chart__name', x: x1 + 18, y: line.nameY + 3.5, text: (brief && BRIEF_NAMES[key]) || short });
      return [
        svg('line', { class: 'chart__leader', x1: x1 + 3, y1: line.endY, x2: x1 + 14, y2: line.nameY }),
        line.name,
        // a wider target than the letters themselves; bind() reads the key from it
        svg('rect', { class: 'chart__pick', 'data-key': key, x: x1 + 12, y: line.nameY - NAME_GAP / 2, width: names - 12, height: NAME_GAP }),
      ];
    });

    this.scrubDots = this.lines.map(() => svg('circle', { class: 'chart__dot chart__dot--muted', r: 3.5 }));
    this.dotY = this.lines.map((line) => (day) => y(share(line.c, day)));
    // The lines share a group so that the one picked out can be moved to the front of the others only.
    return [svg('g', {}, this.lines.map((line) => line.node)), ...labels];
  }

  placeScrubber() {
    if (!this.x || !this.scrubLine) return;
    const px = this.x(this.day);
    this.scrubLine.setAttribute('x1', px);
    this.scrubLine.setAttribute('x2', px);
    this.scrubDots.forEach((dot, i) => {
      dot.setAttribute('cx', px);
      dot.setAttribute('cy', this.dotY[i](this.day));
    });
    this.scrubBrent.setAttribute('cx', px);
    this.scrubBrent.setAttribute('cy', this.yBrent(this.model.brentAt(this.day)));
    for (const m of this.markers) m.node.classList.toggle('is-active', m.event === this.active);
  }

  /** In the compare view, pick out one chokepoint's line and name (or none). */
  highlight(key) {
    if (key === this.hot) return;
    this.hot = key;
    for (const line of this.lines ?? []) {
      const hot = line.c.key === key;
      line.node.classList.toggle('is-hot', hot);
      line.name.classList.toggle('is-hot', hot);
      if (hot) line.node.parentNode.append(line.node);   // drawn last, so over the rest
    }
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
      const named = e.target.dataset?.key;
      if (named) { this.onPick(named); return; }
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
      const marker = this.markerAt(px, py), named = e.target.dataset?.key;
      host.style.cursor = marker || named ? 'pointer' : 'ew-resize';
      if (named) { this.hideHover(); this.highlight(named); }
      else if (marker) this.showEventTip(marker.event, e);
      else this.showValueTip(this.dayAt(px), py, e);
    });
    const end = () => { dragging = false; };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
    host.addEventListener('pointerleave', () => { this.hideHover(); this.highlight(null); });

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

  /** The readout for a day: every series at that date, values first. */
  showValueTip(day, py, e) {
    const { model } = this, px = this.x(day);
    this.hover.setAttribute('x1', px);
    this.hover.setAttribute('x2', px);
    this.hover.setAttribute('visibility', 'visible');
    const row = (key, value, label, hot) => el('div', { class: `tooltip__row${hot ? ' is-hot' : ''}` },
      el('span', { class: `tooltip__key tooltip__key--${key}` }),
      el('strong', { text: value }),
      el('span', { text: label }));
    const rows = [];
    if (this.chokepoint) {
      const c = this.chokepoint;
      rows.push(
        row('series', fmtCount(c.avg7[day]), 'ships a day, 7-day average'),
        row('baseline', fmtCount(c.baseline[day]), 'normal for the month'));
    } else {
      // The line nearest the pointer is picked out, on the chart and in the list.
      let nearest = null, gap = 16;
      this.lines.forEach((line, i) => {
        const d = Math.abs(this.dotY[i](day) - py);
        if (d < gap) { nearest = line.c.key; gap = d; }
      });
      this.highlight(nearest);
      for (const line of [...this.lines].sort((a, b) => b.c.ratio(day) - a.c.ratio(day))) {
        rows.push(row(line.c.key === nearest ? 'series' : 'context', `${Math.round(line.c.ratio(day) * 100)}%`, line.c.short, line.c.key === nearest));
      }
    }
    this.tooltip.replaceChildren(
      el('div', { class: 'tooltip__title', text: this.chokepoint ? fmtDate(model.dateAt(day)) : `${fmtDate(model.dateAt(day))} · share of normal` }),
      ...rows,
      row('brent', fmtDollars(model.brentAt(day)), 'Brent crude'));
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
