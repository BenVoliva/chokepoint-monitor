// Number and date formatting shared by the cards and the chart.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MINUS = '−';

/** 4 Oct 2026 */
export function fmtDate(date) {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Oct 2026 */
export function fmtMonth(date) {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function monthName(date) {
  return date.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
}

/** Ship counts: one decimal below 10, whole numbers above, thousands separated. */
export function fmtCount(value) {
  if (!Number.isFinite(value)) return '–';
  if (Math.abs(value) < 10) return value.toFixed(1).replace(/\.0$/, '');
  return Math.round(value).toLocaleString('en-GB');
}

/** Signed percentage change from a ratio: 0.03 -> "−97%", 2.05 -> "+105%". */
export function fmtChange(ratio) {
  if (!Number.isFinite(ratio)) return '–';
  const pct = Math.round((ratio - 1) * 100);
  if (pct === 0) return '0%';
  return `${pct > 0 ? '+' : MINUS}${Math.abs(pct)}%`;
}

/** Thousand tonnes -> "1.34 Mt" or "120 kt". */
export function fmtTonnage(kt) {
  if (!Number.isFinite(kt)) return '–';
  if (kt >= 1000) return `${(kt / 1000).toFixed(kt >= 10000 ? 1 : 2)} Mt`;
  return `${Math.round(kt)} kt`;
}

/** Tonnes to two significant figures: 52,340 -> "52,000 tonnes". */
export function fmtTonnes(tonnes) {
  if (!Number.isFinite(tonnes) || tonnes <= 0) return '\u2013';
  const step = 10 ** Math.max(0, Math.floor(Math.log10(tonnes)) - 1);
  return `${(Math.round(tonnes / step) * step).toLocaleString('en-GB')} tonnes`;
}

/** ['a', 'b', 'c'] -> "a, b and c" */
export function fmtList(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function fmtDollars(value) {
  return Number.isFinite(value) ? `$${value.toFixed(value >= 100 ? 0 : 2)}` : '–';
}
