/** Pure KPI maths — shared so the API, exports and tests all agree on the numbers. */
export interface DateRange { from: Date; to: Date; days: number }

const DAY = 86_400_000;
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Inclusive day range. Defaults to the last 30 days; max 366 days. `to` becomes end of that day. */
export function parseRange(from?: string, to?: string, now = new Date(), maxDays = 366): DateRange {
  const end = to ? startOfUtcDay(new Date(to)) : startOfUtcDay(now);
  const start = from ? startOfUtcDay(new Date(from)) : new Date(end.getTime() - 29 * DAY);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new RangeError("Dates must be YYYY-MM-DD.");
  if (start > end) throw new RangeError("The start date is after the end date.");
  const days = Math.round((end.getTime() - start.getTime()) / DAY) + 1;
  if (days > maxDays) throw new RangeError(`Choose a range of ${maxDays} days or less.`);
  return { from: start, to: new Date(end.getTime() + DAY - 1), days };
}

/** The same-length period immediately before (for "vs previous period"). */
export function previousRange(r: DateRange): DateRange {
  const to = new Date(r.from.getTime() - 1);
  return { from: new Date(r.from.getTime() - r.days * DAY), to, days: r.days };
}

export const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export function eachDay(r: DateRange): string[] {
  const out: string[] = [];
  for (let t = r.from.getTime(); t <= r.to.getTime(); t += DAY) out.push(dayKey(new Date(t)));
  return out;
}

/** Fills missing days with 0 so charts don't skip dates. */
export function fillDailySeries(r: DateRange, rows: { day: string; value: number }[]): { day: string; value: number }[] {
  const map = new Map(rows.map((x) => [x.day, x.value]));
  return eachDay(r).map((day) => ({ day, value: map.get(day) ?? 0 }));
}

/** % change vs previous; null when there's no baseline (avoids "+∞%"). */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Inquiries per 100 listing views, one decimal. */
export function conversionRate(inquiries: number, views: number): number | null {
  return views > 0 ? Math.round((inquiries / views) * 1000) / 10 : null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Hours between two dates, one decimal. */
export const hoursBetween = (a: Date, b: Date) => Math.round(((b.getTime() - a.getTime()) / 3_600_000) * 10) / 10;
