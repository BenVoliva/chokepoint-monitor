// The cards floating over the map: headline figures, the week's summary or the
// selected chokepoint, the list of chokepoints, the timeline, the news and the map legend.

import { el, icon, TONE_ICON } from './dom.js';
import { NORMAL_NOTE, statusOf } from './data.js';
import { weeklyBrief, NOTABLE } from './brief.js';
import { fmtDate, fmtMonth, monthName, fmtCount, fmtChange, fmtTonnage, fmtTonnes, fmtList, fmtDollars } from './format.js';
import { TimelineChart } from './timeline.js';
import { SHIP_KINDS } from './ships.js';
import { SHIPS_PER_ICON, KM_PER_DAY, laneWidth } from './scene.js';
import { methodPanel, TablePanel } from './panels.js';

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
const STALE_AFTER_DAYS = 21;   // the badge stops showing green once the newest day is older than this
const NEWS_SHOWN = 8;          // headlines shown before "Show all"

const sum = (values) => values.reduce((a, b) => a + b, 0);

export class Dashboard {
  /**
   * @param {object} o
   * @param {object} o.model
   * @param {object} o.on  handlers: select(key or null), day(index), play(), home(), zoom(factor), focus(), shipClose(), more()
   */
  constructor({ model, on }) {
    this.model = model;
    this.on = on;
    this.tooltip = document.getElementById('tooltip');
    this.method = methodPanel(model);
    this.table = new TablePanel(model);
    this.buildTopbar();
    this.buildKpis();
    this.buildSummary();
    this.buildDetail();
    this.buildTimeline();
    this.buildList();
    this.buildNews();
    this.buildLegend();
    this.buildToolbar();
  }

  // ---------------------------------------------------------------- build --

  buildTopbar() {
    const latest = this.model.dateAt(this.model.latest);
    const asof = document.getElementById('asof');
    asof.append(
      el('span', { class: 'asof__dot' }),
      el('span', {}, el('span', { class: 'asof__label', text: 'Data to ' }), el('strong', { text: fmtDate(latest) })));
    // New counts come weekly, a few days in arrears. Much older than that and the refresh has stalled: say so.
    const age = Math.floor((Date.now() - latest) / 86400000);
    if (age > STALE_AFTER_DAYS) {
      asof.classList.add('is-stale');
      asof.title = `The latest data is ${age} days old. IMF PortWatch normally publishes new counts once a week.`;
    }
    document.getElementById('topbar-actions').append(
      el('button', { class: 'text-button', type: 'button', onclick: () => this.method.showModal() }, icon('info', 15), el('span', { text: 'How this works' })));
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

  /** The card shown while no chokepoint is picked: the week in a few sentences, then each one's figures. */
  buildSummary() {
    const s = this.summary = {
      node: document.getElementById('summary'),
      when: el('div', { class: 'eyebrow' }),
      title: el('h2'),
      lines: el('ul', { class: 'summary__lines' }),
      rows: {},
    };
    const rows = this.model.chokepoints.map((c) => {
      const r = s.rows[c.key] = {
        tone: el('span', { class: 'row__tone' }),
        value: el('span', { class: 'row__value' }),
        week: el('span', { class: 'row__change' }),
        month: el('span', { class: 'row__change' }),
      };
      r.button = el('button', { class: 'row row--moves', type: 'button', onclick: () => this.on.select(c.key) },
        r.tone, el('span', { class: 'row__name', text: c.short }), r.value, r.week, r.month);
      return r.button;
    });
    s.node.append(
      el('header', {}, s.when, s.title),
      s.lines,
      el('div', { class: 'moves' },
        el('div', { class: 'moves__head', 'aria-hidden': 'true' },
          el('span', { text: 'Ships a day' }), el('span', { text: 'Week' }), el('span', { text: 'Month' })),
        rows),
      el('p', { class: 'summary__note', text: 'Week: the last 7 days against the 7 before. Month: the last 28 days against the 28 before. Pick a chokepoint for its detail.' }));
  }

  buildDetail() {
    const d = this.detail = {
      node: document.getElementById('detail'),
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
    d.node.append(
      el('header', { class: 'detail__head' },
        el('div', {}, d.kind, d.name),
        el('div', { class: 'detail__actions' },
          el('button', { class: 'icon-button', type: 'button', 'aria-label': 'Fly to this chokepoint', title: 'Fly to this chokepoint', onclick: () => this.on.focus() }, icon('locate', 18)),
          el('button', { class: 'icon-button', type: 'button', 'aria-label': 'Close and show all six chokepoints', title: 'Close', onclick: () => this.on.select(null) }, icon('close', 18)))),
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
    // The chart has two views, each with its own key: one chokepoint, or all six compared.
    t.keys = {
      one: [key('series', '7-day average'), key('baseline', 'Normal level')],
      all: [key('compare', 'Each chokepoint, % of its normal')],
    };
    document.getElementById('timeline').append(
      el('header', { class: 'timeline__head' },
        t.play,
        el('div', { class: 'timeline__when' }, t.date, t.title),
        el('div', { class: 'timeline__keys' },
          t.keys.one, t.keys.all,
          key('event', 'Event'),
          el('button', { class: 'text-button', type: 'button', title: 'See these figures as a table', onclick: () => this.table.open(this.shown, this.day) },
            icon('table', 15), el('span', { text: 'Table' })),
          el('button', { class: 'icon-button timeline__more', type: 'button', 'aria-label': 'Show or hide the chart and the list of chokepoints', title: 'Show or hide the chart and the list', onclick: () => this.on.more() },
            icon('chevron', 18)))),
      t.strip,
      t.chart);
    this.chart = new TimelineChart({
      host: t.chart,
      tooltip: this.tooltip,
      model: this.model,
      onDay: (day) => this.on.day(day),
      onEvent: (event) => this.on.day(event.index),
      onPick: (key) => this.on.select(key),
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

  buildNews() {
    const { news } = this.model;
    const v = this.news = {
      title: el('h2'),
      list: el('ul', { class: 'news__list' }),
      more: el('button', { class: 'text-button', type: 'button', onclick: () => { this.newsOpen = !this.newsOpen; this.updateNews(); } }),
    };
    const updated = news.fetched ? ` Updated daily, last on ${fmtDate(news.fetched)}.` : '';
    document.getElementById('news').append(
      el('header', { class: 'news__head' },
        el('div', {}, v.title,
          el('p', { class: 'muted', text: `Headlines from shipping trade press that name a chokepoint. Picked out automatically, not checked by hand.${updated}` })),
        v.more),
      v.list);
  }

  /** The headlines for the chokepoint picked, or for all six. */
  updateNews() {
    const { model } = this, v = this.news, c = model.byKey[this.shown];
    const stories = model.news.stories.filter((story) => !c || story.chokepoints.includes(c.key));
    v.title.textContent = c ? `In the news: ${c.short}` : 'In the news';
    v.more.hidden = stories.length <= NEWS_SHOWN;
    v.more.textContent = this.newsOpen ? 'Show fewer' : `Show all ${stories.length}`;
    if (!stories.length) {
      const days = model.news.keepDays;
      v.list.replaceChildren(el('li', { class: 'news__none muted', text: c ? `No headlines about the ${c.name} in the past ${days} days.` : 'No headlines at the moment.' }));
      return;
    }
    v.list.replaceChildren(...(this.newsOpen ? stories : stories.slice(0, NEWS_SHOWN)).map((story) => el('li', {},
      el('a', { class: 'story', href: story.url, target: '_blank', rel: 'noopener' },
        el('div', { class: 'story__tags' },
          story.chokepoints.map((key) => el('span', { class: 'story__tag', text: model.byKey[key].short })),
          icon('external', 12)),
        el('div', { class: 'story__title', text: story.title }),
        el('div', { class: 'story__source', text: `${story.source} · ${fmtDate(story.time)}` })))));
  }

  buildLegend() {
    const lane = (ships) => el('li', {}, el('span', { class: 'legend__lane', style: `height:${laneWidth(ships).toFixed(1)}px` }), String(ships));
    document.getElementById('legend').append(
      el('ul', { class: 'legend__kinds' }, SHIP_KINDS.map((kind) =>
        el('li', {}, el('span', { class: 'swatch', style: `background:${kind.color}` }), kind.label))),
      el('ul', { class: 'legend__lanes' }, el('li', { text: 'Lane thickness, ships a day:' }), lane(10), lane(50), lane(200)),
      el('p', { class: 'legend__note', text: `Ships and lanes are illustrative. Each ship stands for about ${SHIPS_PER_ICON} at sea; click one for details.` }));
  }

  buildToolbar() {
    const button = (iconName, label, handler) =>
      el('button', { class: 'icon-button', type: 'button', 'aria-label': label, title: label, onclick: handler }, icon(iconName, 18));
    document.getElementById('toolbar').append(
      button('plus', 'Zoom in', () => this.on.zoom(0.6)),
      button('minus', 'Zoom out', () => this.on.zoom(1 / 0.6)),
      button('globe', 'World view', () => this.on.home()));
  }

  /**
   * Fill the card that follows a picked ship; null clears it. A drawn ship is a
   * stand-in for many, so the figures are averages for its type, not one vessel's.
   * @param {HTMLElement} card
   * @param {{route: string, kind: string, forward: boolean}|null} ship
   */
  showShip(card, ship, day) {
    const stamp = ship ? `${ship.route}|${ship.kind}|${ship.forward}|${day}` : null;
    if (stamp === this.shipStamp) return;
    this.shipStamp = stamp;
    if (!ship) { card.replaceChildren(); return; }

    const { model } = this;
    const route = model.routes.find((r) => r.key === ship.route);
    const kind = SHIP_KINDS.find((k) => k.key === ship.kind);
    const place = model.byKey[route.mix];
    const [from, to] = ship.forward ? [route.from, route.to] : [route.to, route.from];
    const via = (ship.forward ? route.chokepoints : [...route.chokepoints].reverse()).map((key) => model.byKey[key].short);
    // Cargo per ship: the week's estimated tonnage for this type over the ships counted, or a month's if the week had none.
    let span = 7, seen = place.sum(kind.types, day, span);
    if (!seen.ships) { span = 28; seen = place.sum(kind.types, day, span); }
    const row = (label, value) => el('div', {}, el('dt', { text: label }), el('dd', { text: value }));
    card.replaceChildren(
      el('header', {},
        el('span', { class: 'swatch', style: `background:${kind.color}` }),
        el('strong', { text: kind.name }),
        el('button', { class: 'icon-button', type: 'button', 'aria-label': 'Close', onclick: () => this.on.shipClose() }, icon('close', 15))),
      el('p', { class: 'ship-card__route', text: `${from[0].toUpperCase()}${from.slice(1)} to ${to}, via ${fmtList(via)}` }),
      el('dl', { class: 'rows' },
        row('Typical cargo', seen.ships ? `about ${fmtTonnes(seen.kt * 1000 / seen.ships)}` : 'none recorded'),
        row(`Ships like this at ${place.short}`, `${fmtCount(seen.ships / span)} a day`),
        row('Voyage', `about ${fmtCount(Math.round(route.km / 100) * 100)} km, ${Math.round(route.km / KM_PER_DAY)} days at sea`)),
      el('p', { class: 'ship-card__note' },
        `A stand-in for about ${SHIPS_PER_ICON} ships at sea. `,
        el('span', { class: 'ship-card__more', text: `PortWatch counts ships but does not track them, so these are averages for ${kind.plural} passing ${place.short} in the ${span === 7 ? 'week' : 'four weeks'} to ${fmtDate(model.dateAt(day))}.` })));
  }

  // --------------------------------------------------------------- update --

  /** @param {{day: number, selected: string|null, playing: boolean}} state  `selected` is null for the overview */
  update(state) {
    const { model } = this;
    const { day } = state;
    this.day = day;
    const c = model.byKey[state.selected] ?? null, shown = c?.key ?? null;
    if (this.shown !== shown) {
      this.shown = shown;
      this.relevant = c ? model.events.filter((e) => !e.chokepoints.length || e.chokepoints.includes(c.key)) : model.events;
      this.chart.show(c, this.relevant);
      for (const [key, row] of Object.entries(this.rows)) row.button.classList.toggle('is-selected', key === shown);
      this.detail.node.hidden = !c;
      this.summary.node.hidden = Boolean(c);
      for (const node of this.timeline.keys.one) node.hidden = !c;
      for (const node of this.timeline.keys.all) node.hidden = Boolean(c);
      this.newsOpen = false;
      this.updateNews();
    }
    this.updateKpis(day);
    if (c) this.updateDetail(c, day); else this.updateSummary(day);
    this.updateList(day);
    this.updateTimeline(c, state);
  }

  updateSummary(day) {
    const { model } = this, s = this.summary;
    const { lines, rows } = weeklyBrief(model, day);
    s.when.textContent = day === model.latest ? 'This week · latest data' : 'Looking back';
    s.title.textContent = `Week to ${fmtDate(model.dateAt(day))}`;
    s.lines.replaceChildren(...lines.map((text) => el('li', { text })));
    for (const { c, now, status, week, month } of rows) {
      const row = s.rows[c.key];
      row.tone.dataset.tone = status.tone;
      row.tone.replaceChildren(icon(TONE_ICON[status.tone], 13));
      row.tone.title = status.label;
      row.value.textContent = fmtCount(now);
      for (const [span, move] of [['week', week], ['month', month]]) {
        row[span].textContent = fmtChange(move.ratio);
        row[span].classList.toggle('is-notable', move.counts && Math.abs(move.ratio - 1) >= NOTABLE[span]);
      }
      row.button.setAttribute('aria-label',
        `${c.name}: ${fmtCount(now)} ships a day, ${status.label}; ${fmtChange(week.ratio)} on the week, ${fmtChange(month.ratio)} over four weeks`);
    }
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
    if (playing !== this.playShown) {   // only on a change: this runs every frame while playing
      this.playShown = playing;
      t.play.replaceChildren(icon(playing ? 'pause' : 'play', 18));
      t.play.setAttribute('aria-label', playing ? 'Pause' : 'Play the timeline');
    }
    t.date.textContent = fmtDate(this.model.dateAt(day));
    t.title.textContent = c ? `${c.name} · ships a day` : 'All six chokepoints · share of normal';

    // The strip narrates: it always shows the latest marked event up to this date.
    let active = null;
    for (const event of this.relevant) if (event.index <= day) active = event;
    this.chart.setDay(day, active);
    // After a year without a new one, say so rather than leave it looking current.
    const old = active && day - active.index > 365;
    const stamp = `${this.shown}|${active?.id}|${old}`;
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
