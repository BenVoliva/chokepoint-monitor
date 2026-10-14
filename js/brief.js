// The weekly summary: a few sentences and a row of figures for each chokepoint,
// written from the transit counts alone. It says what the numbers did, never why.

import { statusOf } from './data.js';
import { fmtCount, fmtChange, fmtList } from './format.js';

const WEEK = 7, MONTH = 28;
/** A move at least this large, as a share, gets a sentence (and bold type in the table). */
export const NOTABLE = { week: 0.10, month: 0.15 };
/** Under this many ships a day a percentage swings on one or two ships, so a change is not called a move. */
export const MIN_SHIPS = 8;

const BELOW = {
  standstill: 'is at a near standstill',
  disrupted: 'is disrupted',
  reduced: 'is quieter than usual',
};

function mean(series, end, span) {
  let sum = 0;
  for (let i = end - span + 1; i <= end; i++) sum += series[i];
  return sum / span;
}

/**
 * The `span` days ending on `day` against the `span` days before them.
 * `ratio` is NaN where the record does not reach back that far; `counts` is
 * false where there are too few ships for the percentage to mean much.
 */
function move(series, day, span) {
  if (day < span * 2 - 1) return { ratio: NaN, counts: false };
  const now = mean(series, day, span), before = mean(series, day - span, span);
  return { ratio: before ? now / before : NaN, counts: Math.max(now, before) >= MIN_SHIPS };
}

const size = (ratio) => Math.abs(ratio - 1);
const percent = (ratio) => Math.round(size(ratio) * 100);
const direction = (ratio) => `${ratio >= 1 ? 'up' : 'down'} ${percent(ratio)}%`;
const againstNormal = (ratio) => `${percent(ratio)}% ${ratio >= 1 ? 'above' : 'below'} normal`;

/**
 * @returns {{ lines: string[], rows: { c: object, now: number, status: object,
 *   week: {ratio: number, counts: boolean}, month: {ratio: number, counts: boolean} }[] }}
 *   `lines` are sentences, most important first; `rows` follow the model's order.
 */
export function weeklyBrief(model, day) {
  const rows = model.chokepoints.map((c) => {
    const ratio = c.ratio(day);
    return { c, now: c.avg7[day], ratio, status: statusOf(ratio), week: move(c.total, day, WEEK), month: move(c.total, day, MONTH) };
  });
  const lines = [];

  const low = rows.filter((r) => BELOW[r.status.key]).sort((a, b) => a.ratio - b.ratio);
  const high = rows.filter((r) => r.status.key === 'surge').sort((a, b) => b.ratio - a.ratio);
  const tally = (list) => fmtList(list.map((r) => `${r.c.short} (${fmtChange(r.ratio)})`));
  if (low.length) {
    const [worst, ...rest] = low;
    lines.push(`The ${worst.c.name} ${BELOW[worst.status.key]}: ${fmtCount(worst.now)} ships a day, ${againstNormal(worst.ratio)}.`);
    if (rest.length) lines.push(`Also below normal: ${tally(rest)}.`);
  }
  if (high.length) {
    const [top, ...rest] = high;
    lines.push(`The ${top.c.name} is unusually busy: ${fmtCount(top.now)} ships a day, ${againstNormal(top.ratio)}.`);
    if (rest.length) lines.push(`Also above normal: ${tally(rest)}.`);
  }
  if (!low.length && !high.length) lines.push('Traffic is at normal levels at all six chokepoints.');

  const movers = (span) => rows.filter((r) => r[span].counts && Number.isFinite(r[span].ratio))
    .sort((a, b) => size(b[span].ratio) - size(a[span].ratio));
  const named = (list, span) => fmtList(list.map((r) => `${r.c.short} (${direction(r[span].ratio)})`));
  const week = movers('week');
  if (week.length) {
    const big = week.filter((r) => size(r.week.ratio) >= NOTABLE.week).slice(0, 2);
    if (big.length) lines.push(`Biggest ${big.length > 1 ? 'moves' : 'move'} on the week: ${named(big, 'week')}.`);
    else if (percent(week[0].week.ratio)) lines.push(`Little change on the week: the largest move was ${week[0].c.short}, ${direction(week[0].week.ratio)}.`);
    else lines.push('No change on the week at any chokepoint.');
  }
  const month = movers('month').filter((r) => size(r.month.ratio) >= NOTABLE.month).slice(0, 2);
  if (month.length) lines.push(`Over four weeks: ${named(month, 'month')}.`);

  return { lines, rows };
}
