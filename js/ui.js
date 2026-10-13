// The cards floating over the map: headline figures, the selected chokepoint,
// the list of chokepoints, the timeline and the map legend.

import { el, icon, TONE_ICON } from './dom.js';
import { NORMAL_NOTE, statusOf } from './data.js';
import { fmtDate, fmtMonth, monthName, fmtCount, fmtChange, fmtTonnage, fmtDollars } from './format.js';
import { TimelineChart } from './timeline.js';
import { SHIP_KINDS } from './ships.js';
import { SHIPS_PER_ICON } from './scene.js';

const PLACES = {
  suez: { kind: 'Canal · Egypt', why: 'The short cut between Asia and Europe.' },
  hormuz: { kind: 'Strait · Iran and Oman', why: 'The only sea route out of the Persian Gulf.' },
  panama: { kind: 'Canal · Panama', why: 'The link between the Atlantic and the Pacific.' },
  malacca: { kind: 'Strait · Malaysia, Indonesia, Singapore', why: 'The main lane between the Indian Ocean and East Asia.' },
  bab: { kind: 'Strait · Yemen, Djibouti, Eritrea', why: 'The southern gate of the Red Sea, on the way to Suez.' },
  cape: { kind: 'Open sea · South Africa', why: 'The long way round Africa when ships avoid Suez.' },
};

// PortWatch names cargo by customs section; these are the plain-language versions.
const CARGO = {
  'Mineral Products': 'Oil, ores and minerals',
  'Chemical & Allied Industries': 'Chemicals',
  'Vegetable Products': 'Grains and crops',
  'Prepared Foodstuffs & Beverages': 'Food and drink',
};

const EVENT_ICON = { conflict: 'alert', accident: 'anchor', climate: 'drop', policy: 'flag', market: 'chart', data: 'info' };

const sum = (values) => values.reduce((a, b) => a + b, 0);

export class Dashboard {
  /**
   * @param {object} o
   * @param {object} o.model
   * @param {object} o.on  handlers: select(key), day(index), play(), home(), zoom(factor), focus()
   */
  constructor({ model, on }) {
    this.model = model;
    this.on = on;
    this.tooltip = document.getElementById('tooltip');
    this.buildTopbar();
    this.buildKpis();
    this.buildDetail();
    this.buildTimeline();
    this.buildList();
    this.buildLegend();
    this.buildToolbar();
  }

  // ---------------------------------------------------------------- build --

  buildTopbar() {
    const latest = this.model.dateAt(this.model.latest);
    document.getElementById('asof').append(
      el('span', { class: 'asof__dot' }),
      el('span', {}, 'Data to ', el('strong', { text: fmtDate(latest) })));
  }

  buildKpis() {
    const host = document.getElementById('kpis');
    const tile = (iconName, label) => {
      const value = el('strong'), unit = el('span', { class: 'kpi__unit' });
      const delta = el('span', { class: 'delta' }), note = el('div', { class: 'kpi__note' });
      host.append(el('article', { class: 'kpi card' },
        el('span', { class: 'kpi__icon' }, icon(iconName, 20)),
        el('div', { class: 'kpi__body' },
          el('div', { class: 'kpi__label', text: label }),
          el('div', { class: 'kpi__value' }, value, unit, delta),
          note)));
      return { value, unit, delta, note };
    };
    this.kpis = {
      ships: tile('ship', 'Ships, four main chokepoints'),
      cargo: tile('box', 'Cargo they carried'),
      brent: tile('drop', 'Brent crude'),
      freight: tile('chart', 'Sea freight price index'),
    };
  }

  buildDetail() {
    const d = this.detail = {
      kind: el('div', { class: 'eyebrow' }),
      name: el('h2'),
      why: el('p', { class: 'detail__why' }),
      chip: el('span', { class: 'chip' }),
      share: el('span', { class: 'detail__share' }),
      meter: el('div', { class: 'meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Share of normal traffic' }, el('span')),
      figure: el('strong'),
      normalLabel: el('dt'),
      normal: el('dd'),
      change: el('dd'),
      cargo: el('dd'),
      goods: el('dd'),
      mixBar: el('div', { class: 'mix__bar' }),
      mixLegend: el('ul', { class: 'mix__legend' }),
    };
    const row = (label, value) => el('div', {}, typeof label === 'string' ? el('dt', { text: label }) : label, value);
    document.getElementById('detail').append(
      el('header', { class: 'detail__head' },
        el('div', {}, d.kind, d.name),
        el('button', { class: 'icon-button', type: 'button', 'aria-label': 'Fly to this chokepoint', title: 'Fly to this chokepoint', onclick: () => this.on.focus() }, icon('locate', 18))),
      d.why,
      el('div', { class: 'detail__status' }, d.chip, d.share),
      d.meter,
      el('div', { class: 'detail__figure' }, d.figure, el('span', { text: ' ships a day' }), el('span', { class: 'muted', text: '7-day average' })),
      el('dl', { class: 'rows' },
        row(d.normalLabel, d.normal),
        row('Change from normal', d.change),
        row('Cargo carried', d.cargo),
        row('Main cargoes', d.goods)),
      el('section', { class: 'mix' },
        el('h3', { text: 'Ships in the last 7 days' }),
        d.mixBar, d.mixLegend));
  }

  buildTimeline() {
    const t = this.timeline = {
      play: el('button', { class: 'play', type: 'button', onclick: () => this.on.play() }),
      date: el('div', { class: 'timeline__date' }),
      title: el('div', { class: 'timeline__title' }),
      strip: el('div', { class: 'event-strip' }),
      chart: el('div', { class: 'timeline__chart' }),
    };
    const key = (kind, label) => el('span', {}, el('i', { class: `key key--${kind}` }), label);
    document.getElementById('timeline').append(
      el('header', { class: 'timeline__head' },
        t.play,
        el('div', { class: 'timeline__when' }, t.date, t.title),
        el('div', { class: 'timeline__keys' },
          key('series', '7-day average'),
          key('baseline', 'Normal level'),
          key('event', 'Event'))),
      t.strip,
      t.chart);
    this.chart = new TimelineChart({
      host: t.chart,
      tooltip: this.tooltip,
      model: this.model,
      onDay: (day) => this.on.day(day),
      onEvent: (event) => this.on.day(event.index),
    });
  }

  buildList() {
    const host = document.getElementById('list');
    host.append(el('header', { class: 'list__head' },
      el('h2', { text: 'Chokepoints' }),
      el('span', { class: 'muted', title: NORMAL_NOTE, text: 'Ships a day · vs normal' })));
    this.rows = {};
    let supporting = false;
    for (const c of this.model.chokepoints) {
      if (!c.headline && !supporting) {
        supporting = true;
        host.append(el('div', { class: 'list__divider', text: 'Where Suez traffic went' }));
      }
      const r = this.rows[c.key] = {
        tone: el('span', { class: 'row__tone' }),
        value: el('span', { class: 'row__value' }),
        meter: el('span', { class: 'meter meter--small' }, el('span')),
        change: el('span', { class: 'row__change' }),
      };
      r.button = el('button', { class: 'row', type: 'button', onclick: () => this.on.select(c.key) },
        r.tone, el('span', { class: 'row__name', text: c.short }), r.value, r.meter, r.change);
      host.append(r.button);
    }
    host.append(el('p', { class: 'list__source' },
      'Source: ',
      el('a', { href: 'https://portwatch.imf.org/', target: '_blank', rel: 'noopener', text: 'IMF PortWatch' }),
      ', estimated from ship transponder signals. Prices: FRED. ', NORMAL_NOTE));
  }

  buildLegend() {
    document.getElementById('legend').append(
      el('ul', { class: 'legend__kinds' }, SHIP_KINDS.map((kind) =>
        el('li', {}, el('span', { class: 'swatch', style: `background:${kind.color}` }), kind.label))),
      el('p', { class: 'legend__note', text: `Ships are illustrative: each stands for about ${SHIPS_PER_ICON} vessels at sea, scaled to the daily counts.` }));
  }

  buildToolbar() {
    const button = (iconName, label, handler) =>
      el('button', { class: 'icon-button', type: 'button', 'aria-label': label, title: label, onclick: handler }, icon(iconName, 18));
    document.getElementById('toolbar').append(
      button('plus', 'Zoom in', () => this.on.zoom(0.6)),
      button('minus', 'Zoom out', () => this.on.zoom(1 / 0.6)),
      button('globe', 'World view', () => this.on.home()));
  }

  // --------------------------------------------------------------- update --

  /** @param {{day: number, selected: string, playing: boolean}} state */
  update(state) {
    const { model } = this;
    const { day } = state;
    const c = model.byKey[state.selected];
    if (this.shown !== c.key) {
      this.shown = c.key;
      this.relevant = model.events.filter((e) => !e.chokepoints.length || e.chokepoints.includes(c.key));
      this.chart.show(c, this.relevant);
      for (const [key, row] of Object.entries(this.rows)) row.button.classList.toggle('is-selected', key === c.key);
    }
    this.updateKpis(day);
    this.updateDetail(c, day);
    this.updateList(day);
    this.updateTimeline(c, state);
  }

  updateKpis(day) {
    const { model, kpis } = this;
    const head = model.chokepoints.filter((c) => c.headline);
    const yearAgo = day - 365;

    const ships = sum(head.map((c) => c.avg7[day]));
    kpis.ships.value.textContent = fmtCount(ships);
    kpis.ships.unit.textContent = 'a day';
    setDelta(kpis.ships.delta, ships / sum(head.map((c) => c.baseline[day])), true);
    kpis.ships.note.textContent = '7-day average · vs normal';

    const tons = sum(head.map((c) => c.tons7[day]));
    kpis.cargo.value.textContent = fmtTonnage(tons).replace(/ .*/, '');
    kpis.cargo.unit.textContent = `${tons >= 1000 ? 'm' : 'k'} tonnes a day`;
    setDelta(kpis.cargo.delta, tons / sum(head.map((c) => c.tonsBaseline[day])), true);
    kpis.cargo.note.textContent = 'Estimated · vs normal';

    const brent = model.brentAt(day);
    kpis.brent.value.textContent = fmtDollars(brent);
    kpis.brent.unit.textContent = 'a barrel';
    setDelta(kpis.brent.delta, yearAgo >= 0 ? brent / model.brentAt(yearAgo) : NaN, null);
    kpis.brent.note.textContent = 'vs a year earlier';

    const freight = model.freightAt(day), before = yearAgo >= 0 ? model.freightAt(yearAgo) : null;
    kpis.freight.value.textContent = freight ? Math.round(freight.value) : '–';
    kpis.freight.unit.textContent = freight ? fmtMonth(freight.month) : '';
    setDelta(kpis.freight.delta, freight && before ? freight.value / before.value : NaN, null);
    kpis.freight.note.textContent = 'US deep-sea freight · vs a year earlier';
  }

  updateDetail(c, day) {
    const d = this.detail, place = PLACES[c.key];
    const ratio = c.ratio(day), status = statusOf(ratio);
    d.kind.textContent = place.kind;
    d.name.textContent = c.name;
    d.why.textContent = place.why;

    d.chip.dataset.tone = status.tone;
    d.chip.replaceChildren(icon(TONE_ICON[status.tone], 14), status.label);
    d.share.replaceChildren(el('strong', { text: `${Math.round(ratio * 100)}%` }), ' of normal traffic');
    d.meter.dataset.tone = status.tone;
    d.meter.setAttribute('aria-valuenow', Math.min(100, Math.round(ratio * 100)));
    d.meter.firstChild.style.width = `${Math.min(100, ratio * 100)}%`;

    d.figure.textContent = fmtCount(c.avg7[day]);
    d.normalLabel.textContent = `Normal for ${monthName(this.model.dateAt(day))}`;
    d.normal.textContent = `${fmtCount(c.baseline[day])} a day`;
    d.change.textContent = fmtChange(ratio);
    d.cargo.textContent = `${fmtTonnage(c.tons7[day])} a day`;
    d.goods.textContent = c.topCargo.slice(0, 2).map((name) => CARGO[name] ?? name).join(', ');

    const mix = c.mix(day), total = sum(mix.map((m) => m.count));
    d.mixBar.replaceChildren(...mix.filter((m) => m.count).map((m) =>
      el('span', { style: `flex:${m.count} 1 0;background:${m.color}`, title: `${m.label}: ${m.count}` })));
    d.mixBar.classList.toggle('is-empty', !total);
    d.mixLegend.replaceChildren(...mix.map((m) =>
      el('li', {}, el('span', { class: 'swatch', style: `background:${m.color}` }), m.label, el('strong', { text: m.count }))));
  }

  updateList(day) {
    for (const c of this.model.chokepoints) {
      const row = this.rows[c.key], ratio = c.ratio(day), status = statusOf(ratio);
      row.tone.dataset.tone = status.tone;
      row.tone.replaceChildren(icon(TONE_ICON[status.tone], 13));
      row.tone.title = status.label;
      row.value.textContent = fmtCount(c.avg7[day]);
      row.meter.dataset.tone = status.tone;
      row.meter.firstChild.style.width = `${Math.min(100, ratio * 100)}%`;
      row.change.textContent = fmtChange(ratio);
      row.button.setAttribute('aria-label', `${c.name}: ${fmtCount(c.avg7[day])} ships a day, ${fmtChange(ratio)} against normal, ${status.label}`);
    }
  }

  updateTimeline(c, { day, playing }) {
    const t = this.timeline;
    t.play.replaceChildren(icon(playing ? 'pause' : 'play', 18));
    t.play.setAttribute('aria-label', playing ? 'Pause' : 'Play the timeline');
    t.date.textContent = fmtDate(this.model.dateAt(day));
    t.title.textContent = `${c.name} · ships a day`;

    // The strip narrates: it always shows the latest marked event up to this date.
    let active = null;
    for (const event of this.relevant) if (event.index <= day) active = event;
    this.chart.setDay(day, active);
    // After a year without a new one, say so rather than leave it looking current.
    const old = active && day - active.index > 365;
    const stamp = `${c.key}|${active?.id}|${old}`;
    if (stamp === this.stripStamp) return;
    this.stripStamp = stamp;
    if (!active) {
      t.strip.replaceChildren(el('span', { class: 'muted', text: 'No marked events before this date. Drag the chart or press play.' }));
      return;
    }
    t.strip.replaceChildren(
      el('span', { class: 'event-strip__icon' }, icon(EVENT_ICON[active.kind] ?? 'flag', 16)),
      el('div', { class: 'event-strip__body' },
        el('div', {}, el('strong', { text: active.title }),
          el('span', { class: 'muted', text: old ? `${fmtDate(active.day)} · the last marked event` : fmtDate(active.day) })),
        el('p', { text: active.summary })),
      el('a', { class: 'event-strip__source', href: active.source.url, target: '_blank', rel: 'noopener', title: active.source.name },
        'Source', icon('external', 13)));
  }
}

/**
 * Fill a change badge. `upIsGood` is true/false for measures with a good
 * direction and null for prices, which just get an arrow.
 */
function setDelta(node, ratio, upIsGood) {
  if (!Number.isFinite(ratio)) { node.replaceChildren(); node.className = 'delta'; return; }
  const up = ratio >= 1;
  node.className = `delta delta--${upIsGood == null ? 'plain' : up === upIsGood ? 'good' : 'bad'}`;
  node.replaceChildren(icon(up ? 'up' : 'down', 12), fmtChange(ratio));
}
