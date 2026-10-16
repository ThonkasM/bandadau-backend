import type { Locale } from '../../../entities/locale';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type Intent = 'LAST_BUYER' | 'RECENT_BUYERS' | 'TOP_SPENDERS' | 'TOP_EVENT' | 'CREDITS_SPENT' | 'CREDITS_TOPPED_UP' | 'NEW_USERS' | 'REGISTRATIONS_COUNT' | 'POSTS_COUNT';

const DAY = 86_400_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const startOfDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** Date range the question names explicitly (es/en), or null when it names none. */
export function parseRange(question: string, today: string): { from: string; to: string } | null {
  const q = question.toLowerCase();
  const t = startOfDay(today);
  const [ty, tm] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const named = Object.entries(MONTHS).filter(([name]) => new RegExp(`\\b${name}\\b`).test(q)).map(([, n]) => n);
  if (named.length > 0) {
    const bounds = named.map((m) => {
      const y = m <= tm ? ty : ty - 1;
      return { start: Date.UTC(y, m - 1, 1), end: Date.UTC(y, m, 0) };
    });
    return { from: ymd(Math.min(...bounds.map((b) => b.start))), to: ymd(Math.min(Math.max(...bounds.map((b) => b.end)), t)) };
  }
  if (/\b(esta semana|this week)\b/.test(q)) {
    const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
    return { from: ymd(t - dow * DAY), to: today };
  }
  if (/\b(este mes|this month|mes actual)\b/.test(q)) return { from: `${today.slice(0, 8)}01`, to: today };
  if (/([uú]ltim[oa]s? semana\b|\bpast week\b|\blast 7 days\b|[uú]ltimos 7 d[ií]as\b)/.test(q)) return { from: ymd(t - 6 * DAY), to: today };
  if (/([uú]ltim[oa]s? mes\b|\bpast month\b|\blast 30 days\b|[uú]ltimos 30 d[ií]as\b)/.test(q)) return { from: ymd(t - 29 * DAY), to: today };
  if (/([uú]ltimas 24 horas\b|\b(last|past) 24 hours\b)/.test(q)) return { from: ymd(t - DAY), to: today };
  if (/\b(mes pasado|last month|previous month)\b/.test(q)) return { from: ymd(Date.UTC(ty, tm - 2, 1)), to: ymd(Date.UTC(ty, tm - 1, 0)) };
  if (/\b(semana pasada|last week|previous week)\b/.test(q)) return { from: ymd(t - 7 * DAY), to: ymd(t - DAY) };
  if (/\b(hoy|today)\b/.test(q)) return { from: today, to: today };
  if (/\b(ayer|yesterday)\b/.test(q)) return { from: ymd(t - DAY), to: ymd(t - DAY) };
  const n = /\b(\d{1,3})\s*(d[ií]as|days)\b/.exec(q);
  if (n) return { from: ymd(t - (Number(n[1]) - 1) * DAY), to: today };
  if (/\b(semana|week)\b/.test(q)) return { from: ymd(t - 6 * DAY), to: today };
  if (/\b(a[ñn]o|year)\b/.test(q)) return { from: ymd(t - 364 * DAY), to: today };
  return null;
}

const has = (q: string, re: RegExp) => re.test(q);

/** The concrete question the admin asks (es/en keywords). `null` = a general question (summary report). */
export function detectIntent(question: string): Intent | null {
  const q = question.toLowerCase();
  const credits = has(q, /cr[eé]dit|credits?/);
  const eventWord = has(q, /evento|event|taller|workshop/);

  if (
    has(q, /qui[eé]n(es)?\s+(ha\s+|fue\s+(el|la)\s+)?gast[oó]\s+m[aá]s/) ||
    has(q, /usuarios?\s+que\s+m[aá]s\s+(gast|compr)/) ||
    has(q, /m[aá]s\s+cr[eé]ditos?\s+(gast|consum|us)/) ||
    has(q, /qui[eé]n(es)?\s+(ha\s+)?compr[oó]\s+m[aá]s/) ||
    has(q, /who\s+(has\s+)?spent\s+(the\s+)?most|(biggest|top|highest)\s+spenders?|spent\s+the\s+most/) ||
    has(q, /mayor(es)?\s+gastador|top\s+\d*\s*(gastadores|compradores|users?|usuarios)/) ||
    (has(q, /\b(top|ranking)\b/) && !eventWord && has(q, /usuari|gast|spen|comprad|buyer|cr[eé]dit/))
  )
    return 'TOP_SPENDERS';

  if (
    (eventWord && has(q, /m[aá]s\s+(inscrit|popular|concurrid|asistent|vendid|demand|exitos)|mayor\s+(demanda|asistencia|n[uú]mero de inscri)/)) ||
    has(q, /qu[eé]\s+evento\s+(tiene|ha\s+tenido|tuvo|tiene\s+m[aá]s)/) ||
    has(q, /(most|highest)\s+(popular|registered|attended|signed)|event\s+(with|having)\s+(the\s+)?most|which\s+event\s+(has|had)\s+(the\s+)?(most|highest)/) ||
    has(q, /ranking\s+de\s+eventos|event\s+ranking|top\s+\d*\s*events?|evento\s+m[aá]s\s+(popular|concurrido)/) ||
    (has(q, /\b(top|ranking)\b/) && eventWord)
  )
    return 'TOP_EVENT';

  const buyerSingular =
    has(q, /qui[eé]n\s+(fue\s+(el|la)\s+)?(compr[oó]|adquiri[oó]|se\s+inscribi[oó]|reserv[oó])/) ||
    has(q, /[uú]ltim[oa]\s+(ticket|entrada|boleto|inscripci[oó]n|compra|comprador)/) ||
    has(q, /(comprador|compr[oó]).*[uú]ltim|[uú]ltim.*(comprador|compr[oó])/) ||
    has(q, /who\s+(bought|purchased|registered|signed\s+up|got)/) ||
    has(q, /(last|latest|most\s+recent)\s+(ticket|registration|purchase|buyer|sale)/) ||
    has(q, /\bbuyer\b|comprador/);
  const buyerPlural = has(q, /qui[eé]nes|compradores|[uú]ltim(os|as)\s+\d*\s*(tickets|entradas|inscripciones|compras)|buyers|recent(ly)?|(last|latest)\s+\d+/);
  if (buyerSingular && !has(q, /cu[aá]nt[oa]s?|how\s+many/)) return buyerPlural ? 'RECENT_BUYERS' : 'LAST_BUYER';

  // count questions: a compound question ("inscripciones y créditos") is answered by the full summary instead of a single figure
  const counts: Intent[] = [];
  if (has(q, /(usuarios?|estudiantes?|alumnos?)\s+nuev|nuevos\s+(usuarios|estudiantes|alumnos)|new\s+(users?|students?|sign.?ups?)|sign.?ups?/)) counts.push('NEW_USERS');
  if (credits && has(q, /recarg|top.?up|cargaron|topped/)) counts.push('CREDITS_TOPPED_UP');
  else if (credits && has(q, /gast|spen|consum|debit|us[oó]|usaron/)) counts.push('CREDITS_SPENT');
  if (has(q, /cu[aá]nt[oa]s?\s+(inscripci|tickets?|entradas?|boletos?|compras|inscrit)/) || has(q, /how\s+many\s+(event\s+)?(registrations|tickets|sign.?ups\s+to)/)) counts.push('REGISTRATIONS_COUNT');
  if (has(q, /cu[aá]nt[oa]s?\s+(publicaciones|posts?|comentarios|reacciones)/) || has(q, /how\s+many\s+(posts|comments|reactions)/)) counts.push('POSTS_COUNT');
  if (counts.length === 1) return counts[0] ?? null;
  return null;
}

// ---------- direct answers ----------

const pad = (n: number) => String(n).padStart(2, '0');
function dateParts(iso: string): { d: string; t: string } {
  const dt = new Date(iso);
  return { d: `${pad(dt.getUTCDate())}/${pad(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()}`, t: `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}` };
}
const fmtDay = (locale: Locale, iso: string) => (locale === 'es' ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);
const credits = (locale: Locale, n: number) => (locale === 'es' ? `${n} ${n === 1 ? 'crédito' : 'créditos'}` : `${n} ${n === 1 ? 'credit' : 'credits'}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const safeText = (s: unknown) => String(s ?? '').replace(/[*_`#<>[\]]/g, '').slice(0, 60);

/** "hoy" / "ayer" / "esta semana" / "entre el A y el B" for the range the data covers. */
export function periodPhrase(locale: Locale, question: string, from: string, to: string, today: string): string {
  const q = question.toLowerCase();
  const yesterday = ymd(startOfDay(today) - DAY);
  const es = locale === 'es';
  if (from === to && from === today) return es ? 'hoy' : 'today';
  if (from === to && from === yesterday) return es ? 'ayer' : 'yesterday';
  if (/esta semana|this week/.test(q)) return es ? 'esta semana' : 'this week';
  if (/este mes|this month/.test(q)) return es ? 'este mes' : 'this month';
  return es ? `entre el ${fmtDay(locale, from)} y el ${fmtDay(locale, to)}` : `between ${from} and ${to}`;
}

const noData = (locale: Locale) => (locale === 'es' ? 'No hay datos suficientes para responder esa pregunta en el periodo consultado.' : 'There is not enough data to answer that question for the requested period.');

export interface DirectAnswer {
  answer: string;
  bullets: string[];
  dataset?: Obj;
  chart?: Obj;
  usesNames: boolean;
}

/** Builds the one-sentence answer (first line of the report) from the REAL tool data, plus detail and dataset. `null` = nothing to answer directly. */
export function buildDirectAnswer(locale: Locale, intent: Intent, question: string, today: string, data: Record<string, Obj>): DirectAnswer | null {
  const es = locale === 'es';
  const range = (d?: Obj) => ({ from: String(d?.from ?? today), to: String(d?.to ?? today) });
  switch (intent) {
    case 'LAST_BUYER':
    case 'RECENT_BUYERS': {
      const reg = data.list_recent_registrations;
      if (!reg) return null;
      const items: Obj[] = reg.items ?? [];
      const cols = es
        ? { buyer: 'Comprador', event: 'Evento', credits: 'Créditos', at: 'Confirmada' }
        : { buyer: 'Buyer', event: 'Event', credits: 'Credits', at: 'Confirmed' };
      const dataset = {
        columns: [
          { name: 'buyer', label: cols.buyer, type: 'string' },
          { name: 'event', label: cols.event, type: 'string' },
          { name: 'credits', label: cols.credits, type: 'integer' },
          { name: 'confirmedAt', label: cols.at, type: 'datetime' },
        ],
        rows: items.map((i) => [safeText(i.buyer?.displayName) || (es ? 'Sin nombre' : 'Unnamed'), safeText(i.event?.title), i.creditsPaid, i.confirmedAt]),
      };
      if (items.length === 0) return { answer: es ? 'No encontré inscripciones confirmadas en el periodo consultado.' : 'I found no confirmed registrations in the requested period.', bullets: [], dataset, chart: { type: 'table' }, usesNames: false };
      const who = (i: Obj) => safeText(i.buyer?.displayName) || (es ? 'un usuario sin nombre registrado' : 'a user with no display name');
      const first = items[0] as Obj;
      const when = first.confirmedAt ? dateParts(String(first.confirmedAt)) : null;
      const answer = es
        ? `El último ticket lo compró ${who(first)} (${safeText(first.event?.title)}, ${credits(locale, first.creditsPaid)})${when ? ` el ${when.d} a las ${when.t} (UTC)` : ''}.`
        : `The last ticket was bought by ${who(first)} (${safeText(first.event?.title)}, ${credits(locale, first.creditsPaid)})${when ? ` on ${when.d} at ${when.t} (UTC)` : ''}.`;
      const answerMany =
        (es ? 'Los últimos compradores fueron: ' : 'The latest buyers were: ') +
        items.slice(0, 5).map((i) => `${who(i)} (${safeText(i.event?.title)}, ${credits(locale, i.creditsPaid)})`).join(es ? '; ' : '; ') +
        '.';
      return {
        answer: intent === 'RECENT_BUYERS' && items.length > 1 ? answerMany : answer,
        bullets: items.slice(0, 5).map((i) => {
          const w = i.confirmedAt ? dateParts(String(i.confirmedAt)) : null;
          return `**${who(i)}**: ${safeText(i.event?.title)}, ${credits(locale, i.creditsPaid)}${w ? ` (${w.d} ${w.t} UTC)` : ''}`;
        }),
        dataset,
        chart: { type: 'table' },
        usesNames: true,
      };
    }
    case 'TOP_SPENDERS': {
      const top = data.get_top_credit_spenders;
      if (!top) return null;
      const items: Obj[] = top.items ?? [];
      const { from, to } = range(top);
      const period = periodPhrase(locale, question, from, to, today);
      const cols = es ? { user: 'Usuario', spent: 'Créditos gastados', regs: 'Inscripciones' } : { user: 'User', spent: 'Credits spent', regs: 'Registrations' };
      const dataset = {
        columns: [{ name: 'user', label: cols.user, type: 'string' }, { name: 'creditsSpent', label: cols.spent, type: 'integer' }, { name: 'registrations', label: cols.regs, type: 'integer' }],
        rows: items.map((i) => [safeText(i.displayName) || (es ? 'Sin nombre' : 'Unnamed'), i.creditsSpent, i.registrations]),
      };
      if (items.length === 0) return { answer: es ? `No hubo gasto de créditos ${period}.` : `No credits were spent ${period}.`, bullets: [], dataset, chart: { type: 'table' }, usesNames: false };
      const who = (i: Obj) => safeText(i.displayName) || (es ? 'un usuario sin nombre registrado' : 'a user with no display name');
      const first = items[0] as Obj;
      const regs = (n: number) => (es ? `${n} ${n === 1 ? 'inscripción' : 'inscripciones'}` : `${n} ${n === 1 ? 'registration' : 'registrations'}`);
      return {
        answer: es
          ? `Quien más créditos gastó ${period} fue ${who(first)}, con ${credits(locale, first.creditsSpent)} en ${regs(first.registrations)}.`
          : `The top credit spender ${period} was ${who(first)}, with ${credits(locale, first.creditsSpent)} across ${regs(first.registrations)}.`,
        bullets: items.slice(0, 5).map((i) => `**${who(i)}**: ${credits(locale, i.creditsSpent)} (${regs(i.registrations)})`),
        dataset,
        chart: { type: 'bar', x: 'user', y: 'creditsSpent', title: cols.spent },
        usesNames: true,
      };
    }
    case 'TOP_EVENT': {
      const ev = data.list_events;
      if (!ev) return null;
      const items = ([...(ev.items ?? [])] as Obj[]).sort((a, b) => b.seatsTaken - a.seatsTaken);
      const cols = es ? { event: 'Evento', taken: 'Inscritos', cap: 'Cupo' } : { event: 'Event', taken: 'Registered', cap: 'Capacity' };
      const dataset = {
        columns: [{ name: 'event', label: cols.event, type: 'string' }, { name: 'seatsTaken', label: cols.taken, type: 'integer' }, { name: 'capacity', label: cols.cap, type: 'integer' }],
        rows: items.slice(0, 20).map((e) => [safeText(e.title), e.seatsTaken, e.capacity]),
      };
      if (items.length === 0) return { answer: es ? 'No hay eventos registrados para comparar.' : 'There are no events to compare.', bullets: [], dataset, chart: { type: 'table' }, usesNames: false };
      const top = items[0] as Obj;
      const tied = items.filter((e) => e.seatsTaken === top.seatsTaken);
      const n = top.seatsTaken as number;
      const seats = es ? `${n} ${n === 1 ? 'inscrito' : 'inscritos'}` : `${n} registered`;
      const names = tied.slice(0, 3).map((e) => safeText(e.title)).join(', ');
      const answer =
        tied.length > 1
          ? es
            ? `Hay un empate: ${tied.length} eventos tienen el máximo de inscritos (${seats}), por ejemplo ${names}.`
            : `There is a tie: ${tied.length} events have the most registrations (${seats}), for example ${names}.`
          : es
            ? `El evento con más inscritos es ${safeText(top.title)}, con ${seats} de ${top.capacity} cupos.`
            : `The event with the most registrations is ${safeText(top.title)}, with ${seats} out of ${top.capacity} seats.`;
      return {
        answer,
        bullets: items.slice(0, 5).map((e) => `**${safeText(e.title)}**: ${e.seatsTaken}/${e.capacity}`),
        dataset,
        chart: { type: 'bar', x: 'event', y: 'seatsTaken', title: cols.taken },
        usesNames: false,
      };
    }
    case 'CREDITS_SPENT':
    case 'CREDITS_TOPPED_UP': {
      const c = data.get_credit_stats;
      if (!c) return null;
      const { from, to } = range(c);
      const period = periodPhrase(locale, question, from, to, today);
      const spent = intent === 'CREDITS_SPENT';
      const n = spent ? c.totals.debitCredits : c.totals.topUpCredits;
      const answer = es
        ? `${cap(period)} se ${spent ? 'gastaron' : 'recargaron'} ${credits(locale, n)}${spent ? ' en inscripciones' : ''}.`
        : `${cap(period)}, ${credits(locale, n)} ${n === 1 ? 'was' : 'were'} ${spent ? 'spent on registrations' : 'topped up'}.`;
      const col = spent ? 'debitCredits' : 'topUpCredits';
      const label = es ? (spent ? 'Créditos gastados' : 'Créditos recargados') : spent ? 'Credits spent' : 'Credits topped up';
      const series: Obj[] = c.series ?? [];
      return {
        answer,
        bullets: [
          es
            ? `**Créditos**: ${c.totals.topUpCredits} recargados, ${c.totals.debitCredits} gastados en inscripciones y ${c.totals.refundCredits} reembolsados.`
            : `**Credits**: ${c.totals.topUpCredits} topped up, ${c.totals.debitCredits} spent on registrations and ${c.totals.refundCredits} refunded.`,
        ],
        dataset: { columns: [{ name: 'date', label: es ? 'Fecha' : 'Date', type: 'date' }, { name: col, label, type: 'integer' }], rows: series.slice(0, 200).map((s) => [s.date, s[col]]) },
        chart: { type: series.length >= 3 ? 'line' : 'bar', x: 'date', y: col, title: label },
        usesNames: false,
      };
    }
    case 'NEW_USERS': {
      const k = data.get_platform_kpis;
      if (!k) return null;
      const { from, to } = range(k);
      const period = periodPhrase(locale, question, from, to, today);
      const n = k.newUsers as number;
      return {
        answer: es ? `${cap(period)} se registraron ${n} ${n === 1 ? 'usuario nuevo' : 'usuarios nuevos'}.` : `${cap(period)}, ${n} new ${n === 1 ? 'user' : 'users'} signed up.`,
        bullets: [es ? `**Usuarios**: ${k.newUsers} nuevos; pico diario de usuarios activos: ${k.activeUsers}.` : `**Users**: ${k.newUsers} new; daily peak of active users: ${k.activeUsers}.`],
        usesNames: false,
      };
    }
    case 'REGISTRATIONS_COUNT': {
      const r = data.get_registration_stats;
      if (!r) return null;
      const { from, to } = range(r);
      const period = periodPhrase(locale, question, from, to, today);
      const t = r.totals;
      return {
        answer: es
          ? `${cap(period)} se confirmaron ${t.confirmed} ${t.confirmed === 1 ? 'inscripción' : 'inscripciones'} (${t.failed} fallidas, ${t.cancelled} canceladas y ${t.pending} pendientes).`
          : `${cap(period)}, ${t.confirmed} ${t.confirmed === 1 ? 'registration was' : 'registrations were'} confirmed (${t.failed} failed, ${t.cancelled} cancelled and ${t.pending} pending).`,
        bullets: [],
        usesNames: false,
      };
    }
    case 'POSTS_COUNT': {
      const c = data.get_content_stats;
      if (!c) return null;
      const { from, to } = range(c);
      const period = periodPhrase(locale, question, from, to, today);
      const t = c.totals;
      return {
        answer: es ? `${cap(period)} se publicaron ${t.posts} posts, ${t.comments} comentarios y ${t.reactions} reacciones.` : `${cap(period)}, ${t.posts} posts, ${t.comments} comments and ${t.reactions} reactions were published.`,
        bullets: [],
        usesNames: false,
      };
    }
  }
}

export { noData };
