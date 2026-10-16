/** Relative dates are resolved by CODE (never by the model): the agent receives this table with every question. All dates are UTC. */
export interface DateRange {
  from: string;
  to: string;
}
export interface DateContext {
  today: string;
  yesterday: string;
  /** Monday of the current ISO week. */
  weekStart: string;
  thisWeek: DateRange;
  lastWeek: DateRange;
  thisMonth: DateRange;
  lastMonth: DateRange;
  last7: DateRange;
  last30: DateRange;
}

const DAY = 86_400_000;
const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const parse = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** Inclusive number of days of a range (from = to is one day). */
export const daysInRange = (r: DateRange): number => Math.round((parse(r.to) - parse(r.from)) / DAY) + 1;

export function dateContext(today: string): DateContext {
  const t = parse(today);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  const weekStart = t - dow * DAY;
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  return {
    today,
    yesterday: ymd(t - DAY),
    weekStart: ymd(weekStart),
    thisWeek: { from: ymd(weekStart), to: today },
    lastWeek: { from: ymd(weekStart - 7 * DAY), to: ymd(weekStart - DAY) },
    thisMonth: { from: ymd(Date.UTC(y, m - 1, 1)), to: today },
    lastMonth: { from: ymd(Date.UTC(y, m - 2, 1)), to: ymd(Date.UTC(y, m - 1, 0)) },
    last7: { from: ymd(t - 6 * DAY), to: today },
    last30: { from: ymd(t - 29 * DAY), to: today },
  };
}

/** Text block for the model (first user message; the system prompt stays cacheable). */
export function describeDateContext(locale: 'es' | 'en', ctx: DateContext): string {
  const r = (x: DateRange) => `${x.from}→${x.to}`;
  return locale === 'es'
    ? `Fechas resueltas (UTC, inclusive): hoy ${ctx.today}; ayer ${ctx.yesterday}; esta semana (lunes→hoy) ${r(ctx.thisWeek)}; semana pasada ${r(ctx.lastWeek)}; este mes ${r(ctx.thisMonth)}; mes pasado ${r(ctx.lastMonth)}; últimos 7 días ${r(ctx.last7)}; últimos 30 días ${r(ctx.last30)}; últimos N días: from = hoy−(N−1).`
    : `Resolved dates (UTC, inclusive): today ${ctx.today}; yesterday ${ctx.yesterday}; this week (Monday→today) ${r(ctx.thisWeek)}; last week ${r(ctx.lastWeek)}; this month ${r(ctx.thisMonth)}; last month ${r(ctx.lastMonth)}; last 7 days ${r(ctx.last7)}; last 30 days ${r(ctx.last30)}; last N days: from = today−(N−1).`;
}

/** Every number that the date table itself implies (years, month/day numbers, lengths of the named periods). */
export function dateContextNumbers(ctx: DateContext): number[] {
  const out: number[] = [];
  const dates = [ctx.today, ctx.yesterday, ctx.weekStart];
  for (const r of [ctx.thisWeek, ctx.lastWeek, ctx.thisMonth, ctx.lastMonth, ctx.last7, ctx.last30]) {
    dates.push(r.from, r.to);
    out.push(daysInRange(r), daysInRange(r) - 1);
  }
  for (const d of dates) out.push(...datePartNumbers(d));
  return out;
}

/** Year, month and day numbers of an ISO date (`2026-10-05` → 2026, 10, 5). */
export function datePartNumbers(iso: string): number[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [];
}
