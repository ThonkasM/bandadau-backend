import type { Locale } from '../../../entities/locale';
import { dateContext } from '../../../entities/policies/relative-dates';
import { buildDirectAnswer, cap, credits, DAY, type DirectAnswer, eventRankingBy, fmtDay, type Intent, type MetricKey, metricOf, parseRange, periodPhrase, safeText, startOfDay, ymd } from './stub-intents';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Call = { name: string; input: Obj };

const WIDE_DAYS = 365;
const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
const topN = (q: string, dflt: number): number => {
  const m = /\b(?:top|los|las|the)\s+(\d{1,2})\b/i.exec(q);
  return m ? Math.min(10, Math.max(1, Number(m[1]))) : dflt;
};

/** Range the question names, else the last 30 days; `wide` = the last 365 days (questions about "all time"). */
function rangeOf(question: string, today: string, wide = false): { from: string; to: string } {
  return parseRange(question, today) ?? { from: ymd(startOfDay(today) - (wide ? WIDE_DAYS - 1 : 29) * DAY), to: today };
}

/** Tool calls of the intents that use the newer tools (null: not one of them). */
export function planExtra(intent: Intent, question: string, offered: Set<string>, today: string): Call[] | null {
  const q = question.toLowerCase();
  const only = (name: string, input: Obj): Call[] => (offered.has(name) ? [{ name, input }] : []);
  switch (intent) {
    case 'TOP_BALANCE':
    case 'CREDITS_CIRCULATION':
    case 'AVG_BALANCE':
      return only('get_wallet_overview', { limit: 5 });
    case 'USERS_TOTAL':
    case 'USERS_SUSPENDED':
    case 'USERS_BY_UNIVERSITY':
    case 'USERS_BY_CAREER':
      return only('get_user_stats', {});
    case 'ACTIVE_USERS':
      return only('get_platform_kpis', rangeOf(question, today));
    case 'TICKETS_ISSUED':
    case 'TICKETS_USED':
    case 'TICKET_USAGE':
      return only('get_ticket_stats', rangeOf(question, today, true));
    case 'HASHTAGS':
      return only('get_content_rankings', { ...rangeOf(question, today), by: 'HASHTAGS', limit: topN(q, 5) });
    case 'TOP_AUTHORS':
      return only('get_content_rankings', { ...rangeOf(question, today), by: 'AUTHORS', limit: topN(q, 5) });
    case 'TOP_POST':
      return only('get_content_rankings', { ...rangeOf(question, today), by: 'POSTS', limit: topN(q, 3) });
    case 'EVENT_RANKING':
      return only('get_event_ranking', { ...rangeOf(question, today, true), by: eventRankingBy(q) ?? 'REVENUE', limit: topN(q, 5) });
    case 'EVENTS_COUNT':
    case 'EVENTS_NO_ATTENDEES':
      return only('list_events', { from: `${ymd(startOfDay(today) - 365 * DAY)}T00:00:00Z`, to: `${ymd(startOfDay(today) + 365 * DAY)}T23:59:59Z`, status: 'PUBLISHED', limit: 100 });
    case 'UPCOMING_EVENTS':
      return only('list_events', { from: `${today}T00:00:00Z`, to: `${ymd(startOfDay(today) + 180 * DAY)}T23:59:59Z`, status: 'PUBLISHED', limit: 50 });
    case 'MODERATION_PENDING':
      return only('list_flagged_content', { source: 'ALL', limit: 10 });
    case 'SAGAS_FAILED': {
      const r = rangeOf(question, today);
      return only('list_failed_sagas', { since: `${parseRange(question, today) ? r.from : today}T00:00:00Z`, limit: 50 });
    }
    case 'PLATFORM_HEALTH':
    case 'ERROR_QUEUES':
      return only('get_service_health', { includeQueues: true });
    case 'CREDITS_REFUNDED':
      return only('get_credit_stats', { ...rangeOf(question, today), groupBy: 'day' });
    case 'AVG_CREDITS_PER_REG': {
      const r = rangeOf(question, today);
      return [...only('get_credit_stats', { ...r, groupBy: 'day' }), ...only('get_registration_stats', { ...r, groupBy: 'day' })];
    }
    case 'COMPARE_PERIODS': {
      const periods = comparePeriods(question, today);
      const m = metricOf(q);
      const tool = m === 'REGISTRATIONS' ? 'get_registration_stats' : m === 'CREDITS_SPENT' || m === 'CREDITS_TOPPED_UP' ? 'get_credit_stats' : 'get_platform_kpis';
      const args = (r: { from: string; to: string }) => (tool === 'get_platform_kpis' ? { ...r } : { ...r, groupBy: 'day' });
      return [...only(tool, args(periods.current)), ...only(tool, args(periods.previous))];
    }
    case 'PEAK_DAY': {
      const r = rangeOf(question, today);
      const m = metricOf(q);
      if (m === 'CREDITS_SPENT' || m === 'CREDITS_TOPPED_UP') return only('get_credit_stats', { ...r, groupBy: 'day' });
      if (m === 'REGISTRATIONS') return only('get_registration_stats', { ...r, groupBy: 'day' });
      return only('get_platform_kpis', r);
    }
    default:
      return null;
  }
}

function comparePeriods(question: string, today: string) {
  const c = dateContext(today);
  const month = /este mes|this month/i.test(question);
  return { current: month ? c.thisMonth : c.thisWeek, previous: month ? c.lastMonth : c.lastWeek, month };
}

/** A `calculate` call that follows once the data is in (null: none needed, or already made). */
export function followUp(intent: Intent, data: Record<string, Obj>, question: string): Call | null {
  if (data.calculate) return null;
  switch (intent) {
    case 'AVG_CREDITS_PER_REG': {
      const debit = data.get_credit_stats?.totals?.debitCredits;
      const confirmed = data.get_registration_stats?.totals?.confirmed;
      return typeof debit === 'number' && typeof confirmed === 'number' && confirmed > 0 ? { name: 'calculate', input: { operation: 'RATIO', values: [debit, confirmed] } } : null;
    }
    case 'TICKET_USAGE': {
      const t = data.get_ticket_stats;
      return t && num(t.issued) > 0 ? { name: 'calculate', input: { operation: 'PERCENT', values: [t.used, t.issued] } } : null;
    }
    case 'COMPARE_PERIODS': {
      const [cur, prev] = comparePair(data, metricOf(question.toLowerCase()));
      return cur !== null && prev !== null && prev !== 0 ? { name: 'calculate', input: { operation: 'PERCENT_CHANGE', values: [prev, cur] } } : null;
    }
    default:
      return null;
  }
}

function metricValue(metric: MetricKey, d: Obj): number | null {
  switch (metric) {
    case 'REGISTRATIONS': return d.totals?.confirmed ?? null;
    case 'CREDITS_SPENT': return d.totals?.debitCredits ?? null;
    case 'CREDITS_TOPPED_UP': return d.totals?.topUpCredits ?? null;
    case 'POSTS': return d.posts ?? null;
    case 'COMMENTS': return d.comments ?? null;
    case 'NEW_USERS': return d.newUsers ?? null;
  }
}

/** [current, previous] values of the two calls of the same tool (the later `from` is the current period). */
function comparePair(data: Record<string, Obj>, metric: MetricKey): [number | null, number | null] {
  const name = metric === 'REGISTRATIONS' ? 'get_registration_stats' : metric === 'CREDITS_SPENT' || metric === 'CREDITS_TOPPED_UP' ? 'get_credit_stats' : 'get_platform_kpis';
  const a = data[name];
  const b = data[`${name}#2`];
  if (!a || !b) return [null, null];
  const [cur, prev] = String(a.from) >= String(b.from) ? [a, b] : [b, a];
  return [metricValue(metric, cur), metricValue(metric, prev)];
}

const METRIC_LABEL: Record<Locale, Record<MetricKey, [string, string]>> = {
  es: { REGISTRATIONS: ['inscripciones confirmadas', 'inscripción confirmada'], CREDITS_SPENT: ['créditos gastados', 'créditos gastados'], CREDITS_TOPPED_UP: ['créditos recargados', 'créditos recargados'], POSTS: ['publicaciones', 'publicación'], COMMENTS: ['comentarios', 'comentario'], NEW_USERS: ['usuarios nuevos', 'usuario nuevo'] },
  en: { REGISTRATIONS: ['confirmed registrations', 'confirmed registration'], CREDITS_SPENT: ['credits spent', 'credits spent'], CREDITS_TOPPED_UP: ['credits topped up', 'credits topped up'], POSTS: ['posts', 'post'], COMMENTS: ['comments', 'comment'], NEW_USERS: ['new users', 'new user'] },
};

const table = (cols: [string, string, string][], rows: unknown[][]) => ({ columns: cols.map(([name, label, type]) => ({ name, label, type })), rows });
const who = (locale: Locale, name: unknown) => safeText(name) || (locale === 'es' ? 'un usuario sin nombre registrado' : 'a user with no display name');
const plural = (locale: Locale, n: number, es: [string, string], en: [string, string]): string => (locale === 'es' ? `${n} ${n === 1 ? es[0] : es[1]}` : `${n} ${n === 1 ? en[0] : en[1]}`);
const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

/** The deterministic answers of the newer tools. Returns null when the intent is not one of them or the tool data is missing. */
export function buildExtraAnswer(locale: Locale, intent: Intent, question: string, today: string, data: Record<string, Obj>): DirectAnswer | null {
  const es = locale === 'es';
  const q = question.toLowerCase();
  const none = (answer: string): DirectAnswer => ({ answer, bullets: [], usesNames: false });
  switch (intent) {
    case 'TOP_BALANCE': {
      const w = data.get_wallet_overview;
      if (!w) return null;
      const items: Obj[] = w.topBalances ?? [];
      if (items.length === 0) return none(es ? 'Ningún usuario tiene saldo de créditos en este momento.' : 'No user has a credit balance right now.');
      const first = items[0] as Obj;
      return {
        answer: es ? `El usuario con más créditos es ${who(locale, first.displayName)}, con ${credits(locale, first.balanceCredits)}.` : `The user with the most credits is ${who(locale, first.displayName)}, with ${credits(locale, first.balanceCredits)}.`,
        bullets: items.slice(0, 5).map((i) => `**${who(locale, i.displayName)}**: ${credits(locale, i.balanceCredits)}`),
        dataset: table([['user', es ? 'Usuario' : 'User', 'string'], ['balanceCredits', es ? 'Saldo' : 'Balance', 'integer']], items.slice(0, 10).map((i) => [who(locale, i.displayName), i.balanceCredits])),
        chart: { type: 'bar', x: 'user', y: 'balanceCredits', title: es ? 'Saldo' : 'Balance' },
        usesNames: true,
      };
    }
    case 'CREDITS_CIRCULATION': {
      const w = data.get_wallet_overview;
      if (!w) return null;
      return {
        answer: es ? `Hay ${credits(locale, w.creditsInCirculation)} en circulación, repartidos en ${plural(locale, w.walletsWithBalance, ['billetera con saldo', 'billeteras con saldo'], ['', ''])}.` : `There are ${credits(locale, w.creditsInCirculation)} in circulation, spread across ${plural(locale, w.walletsWithBalance, ['', ''], ['wallet with a balance', 'wallets with a balance'])}.`,
        bullets: [es ? `**Saldo promedio**: ${w.averageBalance} créditos por billetera con saldo.` : `**Average balance**: ${w.averageBalance} credits per wallet with a balance.`],
        usesNames: false,
      };
    }
    case 'AVG_BALANCE': {
      const w = data.get_wallet_overview;
      if (!w) return null;
      return { answer: es ? `El saldo promedio es de ${w.averageBalance} créditos por billetera con saldo (${credits(locale, w.creditsInCirculation)} en circulación).` : `The average balance is ${w.averageBalance} credits per wallet with a balance (${credits(locale, w.creditsInCirculation)} in circulation).`, bullets: [], usesNames: false };
    }
    case 'USERS_TOTAL':
    case 'USERS_SUSPENDED': {
      const u = data.get_user_stats;
      if (!u) return null;
      const st = u.byStatus ?? {};
      const bullets = es
        ? [`**Estados**: ${st.ACTIVE ?? 0} activos, ${st.SUSPENDED ?? 0} suspendidos y ${st.PENDING_VERIFICATION ?? 0} pendientes de verificación.`]
        : [`**Statuses**: ${st.ACTIVE ?? 0} active, ${st.SUSPENDED ?? 0} suspended and ${st.PENDING_VERIFICATION ?? 0} pending verification.`];
      if (intent === 'USERS_SUSPENDED') {
        return { answer: es ? `Hay ${plural(locale, u.suspendedUsers, ['usuario suspendido', 'usuarios suspendidos'], ['', ''])} de ${u.totalUsers} registrados.` : `There ${u.suspendedUsers === 1 ? 'is' : 'are'} ${plural(locale, u.suspendedUsers, ['', ''], ['suspended user', 'suspended users'])} out of ${u.totalUsers} registered.`, bullets, usesNames: false };
      }
      return { answer: es ? `Hay ${plural(locale, u.totalUsers, ['usuario registrado', 'usuarios registrados'], ['', ''])} en la plataforma.` : `There ${u.totalUsers === 1 ? 'is' : 'are'} ${plural(locale, u.totalUsers, ['', ''], ['registered user', 'registered users'])} on the platform.`, bullets, usesNames: false };
    }
    case 'USERS_BY_UNIVERSITY':
    case 'USERS_BY_CAREER': {
      const u = data.get_user_stats;
      if (!u) return null;
      const uni = intent === 'USERS_BY_UNIVERSITY';
      const items: Obj[] = (uni ? u.byUniversity : u.byCareer) ?? [];
      const label = (i: Obj) => safeText(uni ? i.name : i.career);
      if (items.length === 0) return none(es ? 'No hay datos de usuarios por ' + (uni ? 'universidad' : 'carrera') + '.' : `There is no user data by ${uni ? 'university' : 'career'}.`);
      const first = items[0] as Obj;
      const count = /cu[aá]ntos|how many|por universidad|por carrera|per|by\b/.test(q) && items.length > 1 && !/(cu[aá]l|qu[eé]|which|what).{0,30}(m[aá]s|most)/.test(q);
      const answer = count
        ? es
          ? `Los usuarios se reparten así: ${items.slice(0, 5).map((i) => `${label(i)} (${i.users})`).join(', ')}.`
          : `Users are distributed as follows: ${items.slice(0, 5).map((i) => `${label(i)} (${i.users})`).join(', ')}.`
        : es
          ? `${uni ? 'La universidad' : 'La carrera'} con más usuarios es ${label(first)}, con ${first.users}.`
          : `The ${uni ? 'university' : 'career'} with the most users is ${label(first)}, with ${first.users}.`;
      return {
        answer,
        bullets: items.slice(0, 6).map((i) => `**${label(i)}**: ${i.users}`),
        dataset: table([['name', uni ? (es ? 'Universidad' : 'University') : es ? 'Carrera' : 'Career', 'string'], ['users', es ? 'Usuarios' : 'Users', 'integer']], items.slice(0, 10).map((i) => [label(i), i.users])),
        chart: { type: 'bar', x: 'name', y: 'users', title: es ? 'Usuarios' : 'Users' },
        usesNames: false,
      };
    }
    case 'ACTIVE_USERS': {
      const k = data.get_platform_kpis;
      if (!k) return null;
      const period = periodPhrase(locale, question, String(k.from ?? today), String(k.to ?? today), today);
      return { answer: es ? `${cap(period)} hubo ${plural(locale, k.activeUsers, ['usuario activo', 'usuarios activos'], ['', ''])}${k.from === k.to ? '' : ' como pico diario'}.` : `${cap(period)}, there ${k.activeUsers === 1 ? 'was' : 'were'} ${plural(locale, k.activeUsers, ['', ''], ['active user', 'active users'])}${k.from === k.to ? '' : ' at the daily peak'}.`, bullets: [], usesNames: false };
    }
    case 'TICKETS_ISSUED':
    case 'TICKETS_USED':
    case 'TICKET_USAGE': {
      const t = data.get_ticket_stats;
      if (!t) return null;
      const period = periodPhrase(locale, question, String(t.from), String(t.to), today);
      const pct = data.calculate?.result;
      const answer =
        intent === 'TICKETS_ISSUED'
          ? es ? `${cap(period)} se emitieron ${plural(locale, t.issued, ['ticket', 'tickets'], ['', ''])} (${t.used} usados y ${t.voided} anulados).` : `${cap(period)}, ${plural(locale, t.issued, ['', ''], ['ticket was', 'tickets were'])} issued (${t.used} used and ${t.voided} voided).`
          : intent === 'TICKETS_USED'
            ? es ? `${cap(period)} se usaron ${t.used} de ${plural(locale, t.issued, ['ticket emitido', 'tickets emitidos'], ['', ''])}.` : `${cap(period)}, ${t.used} of ${plural(locale, t.issued, ['', ''], ['ticket issued', 'tickets issued'])} ${t.used === 1 ? 'was' : 'were'} used.`
            : es ? `${cap(period)} se usaron ${t.used} de ${t.issued} tickets emitidos${typeof pct === 'number' ? `, una tasa de uso de ${pct} %` : ''}.` : `${cap(period)}, ${t.used} of ${t.issued} issued tickets were used${typeof pct === 'number' ? `, a usage rate of ${pct}%` : ''}.`;
      const byEvent: Obj[] = t.byEvent ?? [];
      return {
        answer,
        bullets: byEvent.slice(0, 5).map((e) => `**${safeText(e.title)}**: ${e.used}/${e.issued}`),
        dataset: table([['event', es ? 'Evento' : 'Event', 'string'], ['issued', es ? 'Emitidos' : 'Issued', 'integer'], ['used', es ? 'Usados' : 'Used', 'integer']], byEvent.slice(0, 10).map((e) => [safeText(e.title), e.issued, e.used])),
        chart: byEvent.length > 0 ? { type: 'bar', x: 'event', y: 'used', title: es ? 'Tickets usados' : 'Used tickets' } : { type: 'table' },
        usesNames: false,
      };
    }
    case 'HASHTAGS': {
      const r = data.get_content_rankings;
      if (!r) return null;
      const items: Obj[] = r.hashtags ?? [];
      const period = periodPhrase(locale, question, String(r.from), String(r.to), today);
      const tag = (h: Obj) => `#${String(h.hashtag).replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 30)}`;
      if (items.length === 0) return none(es ? `No hubo hashtags en publicaciones ${period}.` : `There were no hashtags in posts ${period}.`);
      const first = items[0] as Obj;
      return {
        answer: es ? `El hashtag más usado ${period} es ${tag(first)}, con ${plural(locale, first.posts, ['publicación', 'publicaciones'], ['', ''])}.` : `The most used hashtag ${period} is ${tag(first)}, in ${plural(locale, first.posts, ['', ''], ['post', 'posts'])}.`,
        bullets: items.slice(0, 5).map((h) => `**${tag(h)}**: ${h.posts}`),
        dataset: table([['hashtag', 'Hashtag', 'string'], ['posts', es ? 'Publicaciones' : 'Posts', 'integer']], items.slice(0, 10).map((h) => [tag(h), h.posts])),
        chart: { type: 'bar', x: 'hashtag', y: 'posts', title: es ? 'Publicaciones' : 'Posts' },
        usesNames: false,
      };
    }
    case 'TOP_AUTHORS': {
      const r = data.get_content_rankings;
      if (!r) return null;
      const items: Obj[] = r.authors ?? [];
      const period = periodPhrase(locale, question, String(r.from), String(r.to), today);
      if (items.length === 0) return none(es ? `Nadie publicó ${period}.` : `Nobody posted ${period}.`);
      const first = items[0] as Obj;
      return {
        answer: es ? `Quien más publicó ${period} fue ${who(locale, first.displayName)}, con ${plural(locale, first.posts, ['publicación', 'publicaciones'], ['', ''])}.` : `The top poster ${period} was ${who(locale, first.displayName)}, with ${plural(locale, first.posts, ['', ''], ['post', 'posts'])}.`,
        bullets: items.slice(0, 5).map((a) => `**${who(locale, a.displayName)}**: ${a.posts}`),
        dataset: table([['author', es ? 'Autor' : 'Author', 'string'], ['posts', es ? 'Publicaciones' : 'Posts', 'integer']], items.slice(0, 10).map((a) => [who(locale, a.displayName), a.posts])),
        chart: { type: 'bar', x: 'author', y: 'posts', title: es ? 'Publicaciones' : 'Posts' },
        usesNames: true,
      };
    }
    case 'TOP_POST': {
      const r = data.get_content_rankings;
      if (!r) return null;
      const items: Obj[] = r.posts ?? [];
      const period = periodPhrase(locale, question, String(r.from), String(r.to), today);
      if (items.length === 0) return none(es ? `No hubo publicaciones ${period}.` : `There were no posts ${period}.`);
      const first = items[0] as Obj;
      return {
        answer: es ? `La publicación con más reacciones ${period} es de ${who(locale, first.author?.displayName)}: «${safeText(first.excerpt)}», con ${plural(locale, first.reactions, ['reacción', 'reacciones'], ['', ''])} y ${plural(locale, first.comments, ['comentario', 'comentarios'], ['', ''])}.` : `The post with the most reactions ${period} is by ${who(locale, first.author?.displayName)}: "${safeText(first.excerpt)}", with ${plural(locale, first.reactions, ['', ''], ['reaction', 'reactions'])} and ${plural(locale, first.comments, ['', ''], ['comment', 'comments'])}.`,
        bullets: items.slice(0, 5).map((p) => `**${who(locale, p.author?.displayName)}**: «${safeText(p.excerpt)}» (${p.reactions}/${p.comments})`),
        usesNames: true,
      };
    }
    case 'EVENT_RANKING': {
      const r = data.get_event_ranking;
      if (!r) return null;
      const items: Obj[] = r.items ?? [];
      const by = String(r.by);
      if (items.length === 0) return none(es ? 'No hay eventos con datos para ese ranking en el periodo consultado.' : 'No events have data for that ranking in the requested period.');
      // "¿Cuánto ingreso generó el Taller de Docker?": a named event answers about that event
      const named = by === 'REVENUE' ? items.find((e) => safeText(e.title).length > 3 && q.includes(safeText(e.title).toLowerCase().replace(/\s*\(.*\)\s*$/, ''))) : undefined;
      const line = (e: Obj) => (by === 'REVENUE' ? credits(locale, e.revenueCredits) : by === 'ATTENDANCE' ? plural(locale, e.usedTickets ?? 0, ['ticket usado', 'tickets usados'], ['used ticket', 'used tickets']) : `${e.registrations}/${e.capacity}`);
      const bullets = items.slice(0, 5).map((e) => `**${safeText(e.title)}**: ${line(e)}`);
      const dataset = table([['event', es ? 'Evento' : 'Event', 'string'], ['registrations', es ? 'Inscripciones' : 'Registrations', 'integer'], ['capacity', es ? 'Cupo' : 'Capacity', 'integer'], ['revenueCredits', es ? 'Créditos recaudados' : 'Credits collected', 'integer']], items.slice(0, 10).map((e) => [safeText(e.title), e.registrations, e.capacity, e.revenueCredits]));
      const yCol = by === 'REVENUE' ? 'revenueCredits' : 'registrations';
      const chart = { type: 'bar', x: 'event', y: yCol, title: yCol === 'revenueCredits' ? (es ? 'Créditos recaudados' : 'Credits collected') : es ? 'Inscripciones' : 'Registrations' };
      if (named) return { answer: es ? `El evento ${safeText(named.title)} recaudó ${credits(locale, named.revenueCredits)} con ${plural(locale, named.registrations, ['inscripción', 'inscripciones'], ['', ''])}.` : `The event ${safeText(named.title)} collected ${credits(locale, named.revenueCredits)} from ${plural(locale, named.registrations, ['', ''], ['registration', 'registrations'])}.`, bullets, dataset, chart, usesNames: false };
      const n = topN(q, 1);
      const first = items[0] as Obj;
      const label = es ? { REVENUE: 'más ingresos', ATTENDANCE: 'más asistencia', FILL_RATE: 'el cupo más lleno' } : { REVENUE: 'the most revenue', ATTENDANCE: 'the highest attendance', FILL_RATE: 'the fullest seats' };
      const k = label[by as 'REVENUE'];
      let answer: string;
      if (n > 1 && /\btop\b/.test(q) && items.length > 1) {
        const list = items.slice(0, n).map((e) => `${safeText(e.title)} (${line(e)})`).join('; ');
        answer = es ? `Los ${Math.min(n, items.length)} eventos con ${k} son: ${list}.` : `The top ${Math.min(n, items.length)} events by ${by === 'REVENUE' ? 'revenue' : by === 'ATTENDANCE' ? 'attendance' : 'fill rate'} are: ${list}.`;
      } else if (by === 'FILL_RATE') {
        answer = es ? `El evento con el cupo más lleno es ${safeText(first.title)}, con ${first.registrations} de ${first.capacity} cupos ocupados.` : `The event with the fullest seats is ${safeText(first.title)}, with ${first.registrations} of ${first.capacity} seats taken.`;
      } else if (by === 'ATTENDANCE') {
        answer = es ? `El evento con más asistencia es ${safeText(first.title)}, con ${line(first)}.` : `The event with the highest attendance is ${safeText(first.title)}, with ${line(first)}.`;
      } else {
        answer = es ? `El evento con más ingresos es ${safeText(first.title)}, con ${line(first)} recaudados.` : `The event with the most revenue is ${safeText(first.title)}, with ${line(first)} collected.`;
      }
      return { answer, bullets, dataset, chart, usesNames: false };
    }
    case 'EVENTS_COUNT': {
      const e = data.list_events;
      if (!e) return null;
      const items: Obj[] = e.items ?? [];
      return { answer: es ? `Hay ${plural(locale, items.length, ['evento publicado', 'eventos publicados'], ['', ''])}${e.truncated ? ' o más' : ''}.` : `There ${items.length === 1 ? 'is' : 'are'} ${plural(locale, items.length, ['', ''], ['published event', 'published events'])}${e.truncated ? ' or more' : ''}.`, bullets: items.slice(0, 5).map((i) => `**${safeText(i.title)}**: ${i.seatsTaken}/${i.capacity}`), usesNames: false };
    }
    case 'UPCOMING_EVENTS': {
      const e = data.list_events;
      if (!e) return null;
      const items = ([...(e.items ?? [])] as Obj[]).sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
      if (items.length === 0) return none(es ? 'No hay eventos próximos publicados.' : 'There are no upcoming published events.');
      const first = items[0] as Obj;
      const d = fmtDay(locale, String(first.startsAt).slice(0, 10));
      return {
        answer: es ? `El próximo evento es ${safeText(first.title)} (${d}) y hay ${plural(locale, items.length, ['evento próximo publicado', 'eventos próximos publicados'], ['', ''])}.` : `The next event is ${safeText(first.title)} (${d}) and there ${items.length === 1 ? 'is' : 'are'} ${plural(locale, items.length, ['', ''], ['upcoming published event', 'upcoming published events'])}.`,
        bullets: items.slice(0, 6).map((i) => `**${safeText(i.title)}**: ${fmtDay(locale, String(i.startsAt).slice(0, 10))} (${i.seatsTaken}/${i.capacity})`),
        usesNames: false,
      };
    }
    case 'EVENTS_NO_ATTENDEES': {
      const e = data.list_events;
      if (!e) return null;
      const empty = ((e.items ?? []) as Obj[]).filter((i) => i.seatsTaken === 0);
      if (empty.length === 0) return none(es ? 'Todos los eventos publicados tienen al menos una inscripción.' : 'Every published event has at least one registration.');
      return { answer: es ? `Hay ${plural(locale, empty.length, ['evento sin inscritos', 'eventos sin inscritos'], ['', ''])}: ${empty.slice(0, 5).map((i) => safeText(i.title)).join(', ')}.` : `There ${empty.length === 1 ? 'is' : 'are'} ${plural(locale, empty.length, ['', ''], ['event with no registrations', 'events with no registrations'])}: ${empty.slice(0, 5).map((i) => safeText(i.title)).join(', ')}.`, bullets: [], usesNames: false };
    }
    case 'MODERATION_PENDING': {
      const f = data.list_flagged_content;
      if (!f) return null;
      return {
        answer: f.totalPending === 0 ? (es ? 'No hay contenido pendiente de moderación: la cola está vacía.' : 'There is no content pending moderation: the queue is empty.') : es ? `Hay ${plural(locale, f.totalPending, ['contenido pendiente', 'contenidos pendientes'], ['', ''])} de moderación.` : `There ${f.totalPending === 1 ? 'is' : 'are'} ${plural(locale, f.totalPending, ['', ''], ['item', 'items'])} pending moderation.`,
        bullets: [],
        usesNames: false,
      };
    }
    case 'SAGAS_FAILED': {
      const s = data.list_failed_sagas;
      if (!s) return null;
      const reasons = Object.entries(s.byFailureReason ?? {}).map(([k, v]) => `${String(k).replace(/[*`#<>[\]]/g, '').slice(0, 60)}: ${v}`).join(', ');
      return {
        answer: s.count === 0 ? (es ? 'No hubo SAGAs fallidas ni compensadas en el periodo consultado.' : 'There were no failed or compensated SAGAs in the requested period.') : es ? `Hubo ${plural(locale, s.count, ['SAGA fallida o compensada', 'SAGAs fallidas o compensadas'], ['', ''])}${reasons ? ` (${reasons})` : ''}.` : `There ${s.count === 1 ? 'was' : 'were'} ${plural(locale, s.count, ['', ''], ['failed or compensated SAGA', 'failed or compensated SAGAs'])}${reasons ? ` (${reasons})` : ''}.`,
        bullets: [],
        usesNames: false,
      };
    }
    case 'PLATFORM_HEALTH':
    case 'ERROR_QUEUES': {
      const h = data.get_service_health;
      if (!h) return null;
      const services: Obj[] = h.services ?? [];
      const down = services.filter((s) => s.status !== 'UP');
      const dlq = ((h.queues ?? []) as Obj[]).filter((x) => x.isDeadLetter && x.messagesReady > 0);
      if (intent === 'ERROR_QUEUES') {
        return {
          answer: dlq.length === 0 ? (es ? 'No hay mensajes en las colas de error.' : 'There are no messages in the error queues.') : es ? `Hay mensajes en ${plural(locale, dlq.length, ['cola de error', 'colas de error'], ['', ''])}: ${dlq.map((x) => `${safeText(x.name)} (${x.messagesReady})`).join(', ')}.` : `There are messages in ${plural(locale, dlq.length, ['', ''], ['error queue', 'error queues'])}: ${dlq.map((x) => `${safeText(x.name)} (${x.messagesReady})`).join(', ')}.`,
          bullets: [],
          usesNames: false,
        };
      }
      const up = services.length - down.length;
      const status = es ? ({ UP: 'operativa', DEGRADED: 'degradada', DOWN: 'caída' } as Record<string, string>)[h.overall] ?? h.overall : String(h.overall).toLowerCase();
      return {
        answer: es ? `La plataforma está ${status}: ${up} de ${services.length} servicios responden${down.length ? `; con problemas: ${down.map((s) => safeText(s.name)).join(', ')}` : ''}.` : `The platform is ${status}: ${up} of ${services.length} services respond${down.length ? `; with problems: ${down.map((s) => safeText(s.name)).join(', ')}` : ''}.`,
        bullets: dlq.length ? [`**${es ? 'Colas de error' : 'Error queues'}**: ${dlq.map((x) => `${safeText(x.name)} (${x.messagesReady})`).join(', ')}`] : [],
        usesNames: false,
      };
    }
    case 'CREDITS_REFUNDED': {
      const c = data.get_credit_stats;
      if (!c) return null;
      const period = periodPhrase(locale, question, String(c.from), String(c.to), today);
      const t = c.totals ?? {};
      return { answer: es ? `${cap(period)} hubo ${plural(locale, t.refundCount ?? 0, ['reembolso', 'reembolsos'], ['', ''])} por ${credits(locale, t.refundCredits ?? 0)}.` : `${cap(period)}, there ${t.refundCount === 1 ? 'was' : 'were'} ${plural(locale, t.refundCount ?? 0, ['', ''], ['refund', 'refunds'])} for ${credits(locale, t.refundCredits ?? 0)}.`, bullets: [], usesNames: false };
    }
    case 'AVG_CREDITS_PER_REG': {
      const c = data.get_credit_stats;
      const r = data.get_registration_stats;
      if (!c || !r) return null;
      const period = periodPhrase(locale, question, String(c.from), String(c.to), today);
      const avg = data.calculate?.result;
      if (r.totals?.confirmed === 0) return none(es ? `No hubo inscripciones confirmadas ${period}, así que no hay promedio.` : `There were no confirmed registrations ${period}, so there is no average.`);
      if (typeof avg !== 'number') return { answer: es ? `${cap(period)} se gastaron ${credits(locale, c.totals.debitCredits)} en ${plural(locale, r.totals.confirmed, ['inscripción confirmada', 'inscripciones confirmadas'], ['', ''])}.` : `${cap(period)}, ${credits(locale, c.totals.debitCredits)} were spent on ${plural(locale, r.totals.confirmed, ['', ''], ['confirmed registration', 'confirmed registrations'])}.`, bullets: [], usesNames: false };
      return { answer: es ? `${cap(period)}, cada inscripción confirmada costó en promedio ${avg} créditos (${credits(locale, c.totals.debitCredits)} en ${plural(locale, r.totals.confirmed, ['inscripción', 'inscripciones'], ['', ''])}).` : `${cap(period)}, each confirmed registration cost ${avg} credits on average (${credits(locale, c.totals.debitCredits)} across ${plural(locale, r.totals.confirmed, ['', ''], ['registration', 'registrations'])}).`, bullets: [], usesNames: false };
    }
    case 'COMPARE_PERIODS': {
      const metric = metricOf(q);
      const [cur, prev] = comparePair(data, metric);
      if (cur === null || prev === null) return null;
      const month = /este mes|this month/.test(q);
      const label = METRIC_LABEL[locale][metric][0];
      const pct = data.calculate?.result;
      const tail = typeof pct === 'number' ? ` (${signed(pct)} %)` : '';
      return {
        answer: es ? `${month ? 'Este mes' : 'Esta semana'} hubo ${cur} ${label} frente a ${prev} ${month ? 'el mes pasado' : 'la semana pasada'}${tail}.` : `${month ? 'This month' : 'This week'} there were ${cur} ${label} versus ${prev} ${month ? 'last month' : 'last week'}${tail}.`,
        bullets: [],
        dataset: table([['period', es ? 'Periodo' : 'Period', 'string'], ['value', es ? 'Valor' : 'Value', 'integer']], [[es ? (month ? 'Este mes' : 'Esta semana') : month ? 'This month' : 'This week', cur], [es ? (month ? 'Mes pasado' : 'Semana pasada') : month ? 'Last month' : 'Last week', prev]]),
        chart: { type: 'bar', x: 'period', y: 'value', title: label },
        usesNames: false,
      };
    }
    case 'PEAK_DAY': {
      const metric = metricOf(q);
      let series: { date: string; value: number }[] = [];
      let range = { from: today, to: today };
      if (metric === 'REGISTRATIONS' && data.get_registration_stats) {
        const r = data.get_registration_stats;
        range = { from: r.from, to: r.to };
        series = ((r.rows ?? []) as Obj[]).map((x) => ({ date: String(x.key), value: num(x.confirmed) }));
      } else if ((metric === 'CREDITS_SPENT' || metric === 'CREDITS_TOPPED_UP') && data.get_credit_stats) {
        const c = data.get_credit_stats;
        range = { from: c.from, to: c.to };
        series = ((c.series ?? []) as Obj[]).map((x) => ({ date: String(x.date), value: num(metric === 'CREDITS_SPENT' ? x.debitCredits : x.topUpCredits) }));
      } else if (data.get_platform_kpis) {
        const k = data.get_platform_kpis;
        range = { from: k.from, to: k.to };
        const key = metric === 'COMMENTS' ? 'comments' : metric === 'NEW_USERS' ? 'newUsers' : metric === 'POSTS' ? 'posts' : 'registrationsConfirmed';
        series = ((k.series ?? []) as Obj[]).map((x) => ({ date: String(x.date), value: num(x[key]) }));
      }
      if (series.length === 0) return none(es ? 'No hay datos diarios en el periodo consultado.' : 'There is no daily data in the requested period.');
      const best = series.reduce((a, b) => (b.value > a.value ? b : a));
      if (best.value === 0) return none(es ? 'No hubo actividad en el periodo consultado.' : 'There was no activity in the requested period.');
      const period = periodPhrase(locale, question, range.from, range.to, today);
      const label = METRIC_LABEL[locale][metric][0];
      return {
        answer: es ? `El día con más ${label} ${period} fue el ${fmtDay(locale, best.date)}, con ${best.value}.` : `The day with the most ${label} ${period} was ${best.date}, with ${best.value}.`,
        bullets: [],
        dataset: table([['date', es ? 'Fecha' : 'Date', 'date'], ['value', label, 'integer']], series.slice(-60).map((s) => [s.date, s.value])),
        chart: { type: series.length >= 3 ? 'line' : 'bar', x: 'date', y: 'value', title: label },
        usesNames: false,
      };
    }
    default:
      return null;
  }
}

/** Direct answer for any intent: the newer tools first, then the original ones. */
export function buildAnswer(locale: Locale, intent: Intent, question: string, today: string, data: Record<string, Obj>): DirectAnswer | null {
  return buildExtraAnswer(locale, intent, question, today, data) ?? buildDirectAnswer(locale, intent, question, today, data);
}
