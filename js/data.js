// Loads the JSON files under data/ and derives everything the page shows from
// them: totals, 7-day averages, the "normal" baseline, status and route flows.

const DAY = 86400000;

/** The four chokepoints the headline figures add up. The rest are supporting. */
export const HEADLINE = ['suez', 'hormuz', 'panama', 'malacca'];

/**
 * "Normal" is the same calendar month in a calm reference year: 2022, the last
 * full year before the Panama drought, the Red Sea attacks and the Hormuz
 * closure. Traffic grew between 2019 and 2022, so dates before 2022 are held
 * against 2019 instead; otherwise the early years would all read as "reduced".
 */
export const BASELINE_YEAR = 2022;
export const EARLY_BASELINE_YEAR = 2019;
export const NORMAL_NOTE = `Normal is the average for the same month in ${BASELINE_YEAR}, or in ${EARLY_BASELINE_YEAR} for dates before ${BASELINE_YEAR}.`;

/** Ship types in stack order. Colours are the validated categorical palette;
 *  the order is what keeps neighbours distinguishable, so do not reshuffle. */
export const SHIP_TYPES = [
  { key: 'container', label: 'Container', color: '#2a78d6' },
  { key: 'tanker', label: 'Tanker', color: '#eb6834' },
  { key: 'dry_bulk', label: 'Dry bulk', color: '#1baf7a' },
  { key: 'general_cargo', label: 'General cargo', color: '#eda100' },
  { key: 'roro', label: 'Vehicle carrier', color: '#e87ba4' },
];

const SHORT_NAMES = {
  suez: 'Suez', hormuz: 'Hormuz', panama: 'Panama', malacca: 'Malacca',
  bab: 'Bab el-Mandeb', cape: 'Cape of Good Hope',
};

const STATUS = [
  { min: 1.25, key: 'surge', label: 'Above normal', tone: 'info' },
  { min: 0.85, key: 'normal', label: 'Normal', tone: 'good' },
  { min: 0.65, key: 'reduced', label: 'Reduced', tone: 'warning' },
  { min: 0.25, key: 'disrupted', label: 'Disrupted', tone: 'serious' },
  { min: -Infinity, key: 'standstill', label: 'Near standstill', tone: 'critical' },
];

/** Status for a share of normal traffic (1 = normal). */
export function statusOf(ratio) {
  return STATUS.find((s) => ratio >= s.min);
}

export async function loadData() {
  const get = async (name) => {
    const res = await fetch(`data/${name}.json`);
    if (!res.ok) throw new Error(`data/${name}.json: HTTP ${res.status}`);
    return res.json();
  };
  const [transits, prices, events, routes] = await Promise.all(
    ['transits', 'prices', 'events', 'routes'].map(get));
  return buildModel(transits, prices, events, routes);
}

function parseDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Trailing mean over `window` days, so a value never uses data from its future. */
function trailingMean(series, window) {
  const out = new Float32Array(series.length);
  let sum = 0;
  for (let i = 0; i < series.length; i++) {
    sum += series[i];
    if (i >= window) sum -= series[i - window];
    out[i] = sum / Math.min(i + 1, window);
  }
  return out;
}

function buildModel(transits, prices, events, routes) {
  const start = parseDay(transits.start);
  const days = Math.round((parseDay(transits.end) - start) / DAY) + 1;
  const dateAt = (i) => new Date(start + i * DAY);
  const indexOf = (iso) => Math.round((parseDay(iso) - start) / DAY);
  const clampIndex = (i) => Math.max(0, Math.min(days - 1, i));

  // One pass over the calendar so every baseline shares the same month lookups.
  const calendar = Array.from({ length: days }, (_, i) => {
    const d = dateAt(i);
    const year = d.getUTCFullYear(), month = d.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    // -0.5 at the start of the month, 0 mid-month, +0.5 at the end
    return { year, month, phase: (d.getUTCDate() - 0.5) / daysInMonth - 0.5 };
  });

  /** Day-by-day baseline: monthly means of the reference year, eased between
   *  mid-months so the line has no steps at month ends. */
  function baselineOf(series) {
    const monthlyMeans = (year) => {
      const sum = new Array(12).fill(0), count = new Array(12).fill(0);
      calendar.forEach((c, i) => {
        if (c.year === year) { sum[c.month] += series[i]; count[c.month]++; }
      });
      return sum.map((s, m) => s / count[m]);
    };
    const late = monthlyMeans(BASELINE_YEAR), early = monthlyMeans(EARLY_BASELINE_YEAR);
    return Float32Array.from(calendar, ({ year, month, phase }) => {
      const monthly = year < BASELINE_YEAR ? early : late;
      const neighbour = monthly[(month + (phase < 0 ? 11 : 1)) % 12];
      return monthly[month] * (1 - Math.abs(phase)) + neighbour * Math.abs(phase);
    });
  }

  const chokepoints = transits.chokepoints.map((c) => {
    const total = new Float32Array(days), tons = new Float32Array(days);
    for (const { key } of SHIP_TYPES) {
      for (let i = 0; i < days; i++) {
        total[i] += c.n[key][i] ?? 0;
        tons[i] += c.kt[key][i] ?? 0;
      }
    }
    const avg7 = trailingMean(total, 7), tons7 = trailingMean(tons, 7);
    const baseline = baselineOf(total), tonsBaseline = baselineOf(tons);
    return {
      key: c.key,
      name: c.name,
      short: SHORT_NAMES[c.key] ?? c.name,
      headline: HEADLINE.includes(c.key),
      lat: c.lat,
      lon: c.lon,
      topCargo: c.top_cargo,
      byType: c.n,
      total, tons, avg7, tons7, baseline, tonsBaseline,
      /** Share of normal traffic on day i (7-day average over the baseline). */
      ratio: (i) => avg7[i] / baseline[i],
      /** Ships of each type over the 7 days ending on day i. */
      mix: (i) => SHIP_TYPES.map((t) => {
        let n = 0;
        for (let j = Math.max(0, i - 6); j <= i; j++) n += c.n[t.key][j] ?? 0;
        return { ...t, count: n };
      }),
    };
  });
  const byKey = Object.fromEntries(chokepoints.map((c) => [c.key, c]));

  // Brent has no quote at weekends; carry the last one forward.
  const brentStart = indexOf(prices.brent.start);
  const brent = new Float32Array(prices.brent.daily.length);
  let last = prices.brent.daily.find((v) => v != null);   // so the first days, before any quote, are not blank
  prices.brent.daily.forEach((v, i) => { if (v != null) last = v; brent[i] = last; });
  const brentAt = (i) => brent[Math.max(0, Math.min(brent.length - 1, i - brentStart))];
  const freight = new Map(prices.freight.monthly);
  const freightAt = (i) => {
    // latest published month at or before day i
    const d = dateAt(i);
    for (let back = 0; back < 6; back++) {
      const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1));
      const key = `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`;
      if (freight.has(key)) return { value: freight.get(key), month: m };
    }
    return null;
  };

  const timeline = events.events
    .map((e) => ({ ...e, index: clampIndex(indexOf(e.date)), day: new Date(parseDay(e.date)) }))
    .sort((a, b) => a.index - b.index);

  /**
   * Ships a day on each illustrative route, on day i.  PortWatch counts ships
   * at each chokepoint, not where they came from, so the split between routes
   * is a fixed assumption; it is chosen so the ships drawn through Suez,
   * Hormuz, Panama, Malacca and the Cape add up to each one's real count.
   */
  function routeFlows(i) {
    const at = (key) => byKey[key].avg7[i];
    const hormuz = at('hormuz'), cape = at('cape'), panama = at('panama');
    const gulfAsia = 0.70 * hormuz, gulfSuez = 0.12 * hormuz, gulfCape = 0.18 * hormuz;
    const suezAsia = Math.max(0, at('suez') - gulfSuez);
    const capeRest = Math.max(0, cape - gulfCape);
    const capeAsiaEurope = 0.55 * capeRest, capeBrazil = 0.45 * capeRest;
    return {
      gulf_asia: gulfAsia,
      gulf_europe_suez: gulfSuez,
      gulf_atlantic_cape: gulfCape,
      asia_europe_suez: suezAsia,
      asia_europe_cape: capeAsiaEurope,
      brazil_asia_cape: capeBrazil,
      asia_india: Math.max(0, at('malacca') - gulfAsia - suezAsia - capeAsiaEurope - capeBrazil),
      asia_useast_panama: 0.45 * panama,
      usgulf_asia_panama: 0.30 * panama,
      andes_useast_panama: 0.25 * panama,
    };
  }

  return {
    days, dateAt, indexOf, clampIndex,
    latest: days - 1,
    fetched: transits.fetched,
    chokepoints, byKey,
    brentAt, brentStart, brentDays: brent.length, brentEnd: prices.brent.end,
    freightAt,
    events: timeline,
    routes: routes.routes,
    trunks: routes.trunks,
    network: routes.network,
    routeFlows,
  };
}
