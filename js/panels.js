// Two dialogs: how the page works, and the figures behind the chart as a table.

import { el, icon } from './dom.js';
import { SHIP_TYPES, STATUS, NORMAL_NOTE, BASELINE_YEAR, EARLY_BASELINE_YEAR } from './data.js';
import { fmtDate, fmtMonth, fmtCount, fmtChange } from './format.js';
import { MIN_SHIPS } from './brief.js';
import { SHIPS_PER_ICON } from './scene.js';

/** A modal with a title bar and a close button. Esc and a click outside also close it. */
function dialog(title, ...body) {
  const node = el('dialog', { class: 'panel', 'aria-label': title },
    el('header', { class: 'panel__head' },
      el('h2', { text: title }),
      el('button', { class: 'icon-button', type: 'button', 'aria-label': 'Close', onclick: () => node.close() }, icon('close', 18))),
    el('div', { class: 'panel__body' }, ...body));
  node.addEventListener('click', (e) => { if (e.target === node) node.close(); });   // the backdrop
  document.body.append(node);
  return node;
}

const link = (href, text) => el('a', { href, target: '_blank', rel: 'noopener', text });

// ---------------------------------------------------------------- method --

/** The "How this works" dialog. Returns the <dialog>; call showModal() on it. */
export function methodPanel(model) {
  const section = (title, ...children) => el('section', {}, el('h3', { text: title }), ...children);
  const p = (...children) => el('p', {}, ...children);
  const percent = (ratio) => `${Math.round(ratio * 100)}%`;
  const bands = STATUS.map((status, i) => {
    const above = i ? STATUS[i - 1].min : Infinity;
    const range = above === Infinity ? `more than ${percent(status.min)} of normal`
      : status.min === -Infinity ? `under ${percent(above)}`
        : `${percent(status.min)} to ${percent(above)}`;
    return el('li', {}, el('strong', { text: status.label }), `: ${range}`);
  });

  return dialog('How this works',
    section('What is counted',
      p(link('https://portwatch.imf.org/', 'IMF PortWatch'), ' estimates how many ships pass each of 28 chokepoints every day, from the position signals that ships broadcast (AIS). A ship counts once when it crosses a chokepoint’s boundary. The cargo figure is an estimate too, worked out from each ship’s size and how deep it sits in the water. This page shows six of the 28.'),
      p('PortWatch publishes once a week, a few days in arrears. The latest day here is ', el('strong', { text: fmtDate(model.dateAt(model.latest)) }), '.')),

    section('What “normal” means',
      p(NORMAL_NOTE, ` ${BASELINE_YEAR} was the last full year before the Panama drought, the Red Sea attacks and the Hormuz closure. Traffic grew between ${EARLY_BASELINE_YEAR} and ${BASELINE_YEAR}, so earlier dates are held against ${EARLY_BASELINE_YEAR}; otherwise every early year would read as reduced.`),
      p('Each chokepoint’s 7-day average is compared with that level:'),
      el('ul', {}, bands)),

    section('The weekly summary',
      p('The sentences in the summary card are written by the page from the counts; no one edits them. They set each chokepoint’s 7-day average against its normal level, the last 7 days against the 7 before, and the last 28 days against the 28 before.'),
      p(`A change is only called a move where the chokepoint passed at least ${MIN_SHIPS} ships a day in one of the two periods. Below that, one or two ships swing the percentage. The summary says what the numbers did, not why; the events on the timeline are where causes are given.`)),

    section('The ships and lanes are a picture, not a tracker',
      p('PortWatch counts ships at each chokepoint. It does not say where they came from or where they are now. To draw the traffic, the map spreads each chokepoint’s count over ten typical routes, traced along PortWatch’s own map of shipping lanes, in fixed shares: for example, 70% of Hormuz traffic is drawn heading to East Asia.'),
      p(`Each ship drawn stands for about ${SHIPS_PER_ICON} at sea, and a lane is as thick as the ships a day on it. The traffic drawn through Suez, Hormuz, Panama, Malacca and the Cape adds up to each one’s real count; the split between routes is an assumption. Bab el-Mandeb is drawn with Suez’s traffic, so its lane can differ from its own count.`),
      p('Clicking a ship shows the average cargo for ships of its type that week. It is a stand-in, not a tracked vessel.')),

    section('Quirks in the data',
      el('ul', {},
        el('li', { text: 'Ships that switch off their transponders, or whose signals are jammed, are not counted. That matters most at Hormuz during the closure.' }),
        el('li', { text: 'Malacca’s count steps up by more than a third in one week in November 2021, and at no other chokepoint. It looks like a change in how transits are counted, so earlier Malacca figures are on a different basis.' }),
        el('li', { text: 'From 26 January to 2 February 2020 the counts jump at five chokepoints at once, beyond what the Panama Canal can physically pass. It is a fault in the source data. The chart clips it.' }))),

    section('Borders and names',
      p('Country borders and names come from Natural Earth, which draws borders as they are controlled on the ground. They are there to help you find your way around, not to take a side in any dispute.')),

    section('Prices',
      p('Brent crude is the daily spot price from the U.S. Energy Information Administration. The sea freight index is the U.S. Bureau of Labor Statistics’ monthly producer price index for deep-sea freight (June 1988 = 100). It moves more slowly than spot container rates, which have no free data feed. Both series come through ', link('https://fred.stlouisfed.org/', 'FRED'), '.')),

    section('Events',
      p('The events on the timeline are hand-picked, each with a link to its source. Figures in an event’s text come from the data on this page unless it names another source.')),

    section('Credits',
      p('Ship counts and shipping lanes: IMF PortWatch. Prices: FRED. Land outlines and country borders: Natural Earth. 3D drawing: three.js. The code is on ', link('https://github.com/BenVoliva/chokepoint-monitor', 'GitHub'), '.')));
}

// ----------------------------------------------------------------- table --

const ALL = 'all';   // the picker's value for all six chokepoints together

/**
 * The figures as a table: monthly averages or the events, with a CSV of the
 * daily data. For one chokepoint, or for all six side by side as a share of normal.
 */
export class TablePanel {
  constructor(model) {
    this.model = model;
    this.view = 'months';
    this.picker = el('select', { class: 'panel__select', 'aria-label': 'Chokepoint', onchange: () => this.render() },
      el('option', { value: ALL, text: 'All six, as a share of normal' }),
      model.chokepoints.map((c) => el('option', { value: c.key, text: c.name })));
    const tab = (view, label) => el('button', { type: 'button', onclick: () => { this.view = view; this.render(); } }, label);
    this.tabs = { months: tab('months', 'Monthly figures'), events: tab('events', 'Events') };
    this.save = el('button', { class: 'text-button', type: 'button', onclick: () => this.download() }, icon('download', 15), 'Daily figures (CSV)');
    this.body = el('div', { class: 'panel__table', tabindex: 0 });
    this.node = dialog('The figures',
      el('div', { class: 'panel__tools' }, this.picker, el('div', { class: 'segmented' }, this.tabs.months, this.tabs.events), this.save),
      this.body);
  }

  /** Open on a chokepoint, or on all six if `key` is null, with the month containing `day` marked. */
  open(key, day) {
    this.picker.value = key ?? ALL;
    this.day = day;
    this.render();
    this.node.showModal();
    this.body.querySelector('.is-current')?.scrollIntoView({ block: 'center' });
  }

  /** The chokepoint picked, or null for all six. */
  get chokepoint() {
    return this.model.byKey[this.picker.value] ?? null;
  }

  render() {
    for (const [view, button] of Object.entries(this.tabs)) button.setAttribute('aria-pressed', view === this.view);
    const c = this.chokepoint;
    this.body.replaceChildren(this.view === 'events' ? this.events(c) : c ? this.months(c) : this.compare());
  }

  /** `row` is one month from model.monthly(); the label says so if the month is only part-way through. */
  monthLabel(row) {
    const start = this.model.dateAt(row.first), end = this.model.dateAt(row.last);
    const monthEnd = new Date(Date.UTC(row.year, row.month + 1, 0)).getUTCDate();
    return end.getUTCDate() < monthEnd ? `${fmtMonth(start)} (1 to ${end.getUTCDate()})` : fmtMonth(start);
  }

  /** All six chokepoints month by month, each as a percentage of its own normal: the compare chart as a table. */
  compare() {
    const { model } = this;
    const columns = model.chokepoints.map((c) => model.monthly(c));
    const rows = columns[0].map((row, m) => el('tr', { class: this.day >= row.first && this.day <= row.last ? 'is-current' : null },
      el('th', { scope: 'row', text: this.monthLabel(row) }),
      columns.map((months) => el('td', { text: `${Math.round(months[m].ships / months[m].normal * 100)}%` })),
      el('td', { text: Math.round(row.brent) }))).reverse();
    return el('table', {},
      el('caption', { text: 'Monthly average traffic at each chokepoint, as a percentage of its normal level. 100% is normal.' }),
      el('thead', {}, el('tr', {}, ['Month', ...model.chokepoints.map((c) => c.short), 'Brent, $'].map((text) => el('th', { scope: 'col', text })))),
      el('tbody', {}, rows));
  }

  months(c) {
    const { model } = this;
    const head = ['Month', 'Ships a day', 'Normal', 'Against normal', ...SHIP_TYPES.map((t) => t.label), 'Cargo, m tonnes a day', 'Brent, $'];
    const rows = model.monthly(c).reverse().map((row) => el('tr', { class: this.day >= row.first && this.day <= row.last ? 'is-current' : null },
      el('th', { scope: 'row', text: this.monthLabel(row) }),
      el('td', { text: fmtCount(row.ships) }),
      el('td', { text: fmtCount(row.normal) }),
      el('td', { text: fmtChange(row.ships / row.normal) }),
      row.byType.map((v) => el('td', { text: fmtCount(v) })),
      el('td', { text: (row.kt / 1000).toFixed(2) }),
      el('td', { text: Math.round(row.brent) })));
    return el('table', {},
      el('caption', { text: `Monthly averages for the ${c.name}. Ship columns are ships a day.` }),
      el('thead', {}, el('tr', {}, head.map((text) => el('th', { scope: 'col', text })))),
      el('tbody', {}, rows));
  }

  events(c) {
    const { model } = this;
    const rows = model.events
      .filter((e) => !c || !e.chokepoints.length || e.chokepoints.includes(c.key))
      .reverse()
      .map((e) => el('tr', {},
        el('th', { scope: 'row', text: fmtDate(e.day) }),
        el('td', {}, el('strong', { text: e.title }), el('p', { text: e.summary })),
        el('td', { text: e.chokepoints.length ? e.chokepoints.map((key) => model.byKey[key].short).join(', ') : 'All' }),
        el('td', {}, link(e.source.url, e.source.name))));
    return el('table', { class: 'events-table' },
      el('caption', { text: `Events marked on the timeline${c ? ` for the ${c.name}` : ''}, newest first.` }),
      el('thead', {}, el('tr', {}, ['Date', 'What happened', 'Where', 'Source'].map((text) => el('th', { scope: 'col', text })))),
      el('tbody', {}, rows));
  }

  /** Save the daily figures as a CSV file: the chokepoint picked in full, or every chokepoint's ships and normal level. */
  download() {
    const { model } = this, c = this.chokepoint;
    const head = c
      ? ['date', 'ships', ...SHIP_TYPES.map((t) => t.key), 'cargo_thousand_tonnes', 'normal_ships', 'brent_usd']
      : ['date', ...model.chokepoints.flatMap((each) => [`${each.key}_ships`, `${each.key}_normal_ships`]), 'brent_usd'];
    const lines = [head.join(',')];
    for (let i = 0; i < model.days; i++) {
      const figures = c
        ? [c.total[i], ...SHIP_TYPES.map((t) => c.byType[t.key][i] ?? ''), c.tons[i], c.baseline[i].toFixed(1)]
        : model.chokepoints.flatMap((each) => [each.total[i], each.baseline[i].toFixed(1)]);
      lines.push([model.dateAt(i).toISOString().slice(0, 10), ...figures, model.brentAt(i).toFixed(2)].join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
    el('a', { href: url, download: `chokepoint-monitor-${c?.key ?? 'all'}-daily.csv` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
