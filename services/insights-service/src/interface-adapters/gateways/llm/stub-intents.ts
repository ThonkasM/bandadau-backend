import type { Locale } from '../../../entities/locale';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Intents answered with the data tools added for the admin Q&A (users, wallets, tickets, rankings, health, comparisons). */
export type ExtraIntent =
  | 'TOP_BALANCE' | 'CREDITS_CIRCULATION' | 'AVG_BALANCE' | 'AVG_CREDITS_PER_REG' | 'CREDITS_REFUNDED'
  | 'USERS_TOTAL' | 'USERS_SUSPENDED' | 'USERS_BY_UNIVERSITY' | 'USERS_BY_CAREER' | 'ACTIVE_USERS'
  | 'TICKETS_ISSUED' | 'TICKETS_USED' | 'TICKET_USAGE'
  | 'HASHTAGS' | 'TOP_AUTHORS' | 'TOP_POST'
  | 'EVENT_RANKING' | 'EVENTS_COUNT' | 'UPCOMING_EVENTS' | 'EVENTS_NO_ATTENDEES'
  | 'MODERATION_PENDING' | 'SAGAS_FAILED' | 'PLATFORM_HEALTH' | 'ERROR_QUEUES'
  | 'COMPARE_PERIODS' | 'PEAK_DAY';

export type Intent = ExtraIntent | 'LAST_BUYER' | 'RECENT_BUYERS' | 'TOP_SPENDERS' | 'TOP_EVENT' | 'CREDITS_SPENT' | 'CREDITS_TOPPED_UP' | 'NEW_USERS' | 'REGISTRATIONS_COUNT' | 'POSTS_COUNT';

export const DAY = 86_400_000;
export const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const startOfDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

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

const USERS = /usuari|\busers?\b|estudiant|students?|alumn|cuentas|accounts/;
const TICKETS = /ticket|entrada|boleto/;
const EVENT_WORD = /evento|event|taller|workshop|hackathon|charla|curso/;
const HOW_MANY = /cu[aá]nt[oa]s?|how\s+many|n[uú]mero|number|total|hubo|were|hay|are there/;

/** Which ranking of `get_event_ranking` a question asks for (null = none). */
export function eventRankingBy(q: string): 'REVENUE' | 'FILL_RATE' | 'ATTENDANCE' | null {
  if (/cupo\s+m[aá]s\s+lleno|m[aá]s\s+lleno|casi\s+lleno|fill\s*rate|ocupaci[oó]n|occupancy|fullest|most\s+full|nearly\s+full|almost\s+full/.test(q)) return 'FILL_RATE';
  if (EVENT_WORD.test(q) && /asistencia|attendance|attended|asistieron|asistentes/.test(q) && !/tasa|rate|porcentaje|percent/.test(q)) return 'ATTENDANCE';
  if (/ingres|recaud|revenue|income|facturaci|earned/.test(q) && (EVENT_WORD.test(q) || /\btop\b|ranking/.test(q)) && !/usuari|\busers?\b|gast|spen/.test(q)) return 'REVENUE';
  if (/cu[aá]nto\s+(ingreso|dinero|recaud)/.test(q) && EVENT_WORD.test(q)) return 'REVENUE';
  return null;
}

/** Metric a comparison / peak-day question talks about. */
export type MetricKey = 'REGISTRATIONS' | 'CREDITS_SPENT' | 'CREDITS_TOPPED_UP' | 'POSTS' | 'COMMENTS' | 'NEW_USERS';
export function metricOf(q: string): MetricKey {
  if (/recarg|top.?up/.test(q)) return 'CREDITS_TOPPED_UP';
  if (/cr[eé]ditos?.{0,12}(gast|spen)|gasto|spend|credits?\s+spent/.test(q)) return 'CREDITS_SPENT';
  if (/comentario|comment/.test(q)) return 'COMMENTS';
  if (/publicaci|\bposts?\b/.test(q)) return 'POSTS';
  if (/usuarios?\s+nuev|nuevos\s+usuarios|new\s+users|sign.?ups?/.test(q)) return 'NEW_USERS';
  return 'REGISTRATIONS';
}

/** Questions that the new data tools answer (checked before the older intents). */
export function detectExtra(q: string): ExtraIntent | null {
  const spend = /gast|spen|compr|bought|purchas/;
  if (/promedio.{0,30}cr[eé]ditos.{0,25}(inscripci|ticket|entrada|compra)|cr[eé]ditos\s+por\s+inscripci|average.{0,20}credits?.{0,20}(per|by|each)\s+(registration|ticket|purchase)/.test(q)) return 'AVG_CREDITS_PER_REG';
  if (/saldo\s+promedio|promedio\s+de\s+saldos?|average\s+(credit\s+)?balance|promedio.{0,15}cr[eé]ditos?\s+por\s+(usuario|billetera)|average.{0,20}credits?\s+per\s+(user|wallet)/.test(q)) return 'AVG_BALANCE';
  if (
    (/(usuario|\buser\b|qui[eé]n|\bwho\b|persona).{0,30}(m[aá]s|mayor|highest|most|largest|biggest|top).{0,25}(cr[eé]ditos|credits|saldo|balance)|(saldo|balance)\s+(m[aá]s\s+alto|mayor|highest)|(highest|largest|biggest|top)\s+(credit\s+)?balances?|ranking de saldos/.test(q)) &&
    !spend.test(q) &&
    !/recarg|top.?up/.test(q)
  )
    return 'TOP_BALANCE';
  if (/cr[eé]ditos?.{0,25}(circulaci[oó]n|circulantes|existen|en total|totales)|credits?.{0,20}(circulation|circulating|in total|outstanding|exist)|total credits/.test(q) && !/recarg|top.?up|gast|spen|reembols|refund|hoy|today|ayer|yesterday|semana|week|mes\b|month/.test(q)) return 'CREDITS_CIRCULATION';
  if (/reembols|refund/.test(q) && HOW_MANY.test(q)) return 'CREDITS_REFUNDED';

  if (USERS.test(q) && /suspendid|suspended|bloquead|baneado|banned/.test(q)) return 'USERS_SUSPENDED';
  if (/universidad|universidades|universit/.test(q) && (USERS.test(q) || /cu[aá]nt|how many|m[aá]s|most|\bpor\b|\bper\b|\bby\b/.test(q)) && !EVENT_WORD.test(q)) return 'USERS_BY_UNIVERSITY';
  if (/carrera|career|\bmajor\b/.test(q) && (USERS.test(q) || /m[aá]s|most/.test(q))) return 'USERS_BY_CAREER';
  if (USERS.test(q) && /activ/.test(q) && HOW_MANY.test(q)) return 'ACTIVE_USERS';
  if (
    /cu[aá]nt[oa]s?\s+(usuarios|estudiantes|alumnos|cuentas).{0,40}(hay|registrad|tiene|existen|total|plataforma|en bandada)|how many\s+(users|students|accounts)|total\s+(de\s+)?(usuarios|users|students)|(usuarios|users)\s+(registrados|totales|in total|registered)/.test(q) &&
    !/nuev|\bnew\b|hoy|today|ayer|yesterday|semana|week|este mes|this month|activ|suspend/.test(q)
  )
    return 'USERS_TOTAL';

  const by = eventRankingBy(q);
  if (by) return 'EVENT_RANKING';
  if (/(tasa|porcentaje|%|rate|percent).{0,25}(asistencia|uso|used|attendance|usage|usados)|attendance rate|usage rate|qu[eé] porcentaje.{0,30}(usad|asisti)/.test(q)) return 'TICKET_USAGE';
  if (TICKETS.test(q) && /usad|\bused\b|escane|scanned|validad|canjead|redeem|asisti|attended/.test(q) && HOW_MANY.test(q)) return 'TICKETS_USED';
  if (TICKETS.test(q) && /emitid|issued|generad|se han (emitido|creado|vendido)|sold|vendid/.test(q) && HOW_MANY.test(q)) return 'TICKETS_ISSUED';

  if (/hashtag/.test(q)) return 'HASHTAGS';
  if (/qui[eé]n(es)?\s+(public[oó]|ha\s+publicado|posteo|escribi[oó])\s+m[aá]s|autor(es)?\s+m[aá]s|who\s+(posted|published|wrote)\s+(the\s+)?most|top\s+(authors|posters)|most\s+active\s+(author|poster)/.test(q)) return 'TOP_AUTHORS';
  if (/publicaci[oó]n.{0,25}m[aá]s\s+(reaccion|comentad|popular|likes?)|\bpost.{0,25}(most|more)\s+(reactions|comments|popular)|most\s+(popular|liked|reacted|commented)\s+post/.test(q)) return 'TOP_POST';

  if (/eventos?\s+(sin|(que\s+)?no\s+tienen?)\s+inscrit|events?\s+(with\s+no|without)\s+(registrations|attendees|sign.?ups)/.test(q)) return 'EVENTS_NO_ATTENDEES';
  if (/pr[oó]ximos?\s+eventos|upcoming\s+events|next\s+events?|eventos\s+(futuros|pr[oó]ximos)/.test(q)) return 'UPCOMING_EVENTS';
  if (/cu[aá]ntos\s+eventos|how\s+many\s+events/.test(q) && !/inscrit|registr|asist|attend/.test(q)) return 'EVENTS_COUNT';

  if (/\bsagas?\b|compensad|failed\s+sagas/.test(q) && /cu[aá]nt|hay|fall|fail|how\s+many|which|qu[eé]|any/.test(q)) return 'SAGAS_FAILED';
  if (/(colas?|queues?).{0,25}(error|dead|dlq|fall)|dead.?letter|\bdlq\b|error\s+queues?|mensajes.{0,20}(error|dlq|muertos)/.test(q)) return 'ERROR_QUEUES';
  if (/moderaci|moderation|denunc|reportes?\s+abiertos|flagged|marcad|reported\s+content|pending\s+review|open\s+reports|contenido\s+(pendiente|marcado)/.test(q) && /cu[aá]nt|hay|pending|pendiente|how\s+many|any|is\s+there|are\s+there/.test(q)) return 'MODERATION_PENDING';
  if (/salud|health|estado\s+de\s+(la\s+plataforma|los\s+servicios)|c[oó]mo\s+(est[aá]n|va).{0,20}(servicios|plataforma)|servicios?\s+(ca[ií]d|down|arriba|funcion)|services?\s+(up|down|status|running|healthy)|how\s+are\s+(the\s+)?services|platform\s+(status|health)|is\s+the\s+platform\s+(up|down|healthy)|are\s+(all|the)\s+services/.test(q)) return 'PLATFORM_HEALTH';

  if (/compar|\bvs\.?\b|versus|respecto|frente\s+a|than\s+last|compared\s+(to|with)|difference\s+between/.test(q) && /(esta|this)\s+(semana|week)|(este|this)\s+(mes|month)/.test(q) && /pasad|last|previous|anterior/.test(q)) return 'COMPARE_PERIODS';
  if (/d[ií]a\s+(con\s+)?m[aá]s|busiest\s+day|day\s+with\s+(the\s+)?most|peak\s+day|d[ií]a\s+pico/.test(q)) return 'PEAK_DAY';
  return null;
}

/** The concrete question the admin asks (es/en keywords). `null` = a general question (summary report). */
export function detectIntent(question: string): Intent | null {
  const q = question.toLowerCase();
  const extra = detectExtra(q);
  if (extra) return extra;
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
export function dateParts(iso: string): { d: string; t: string } {
  const dt = new Date(iso);
  return { d: `${pad(dt.getUTCDate())}/${pad(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()}`, t: `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}` };
}
export const fmtDay = (locale: Locale, iso: string) => (locale === 'es' ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);
export const credits = (locale: Locale, n: number) => (locale === 'es' ? `${n} ${n === 1 ? 'crédito' : 'créditos'}` : `${n} ${n === 1 ? 'credit' : 'credits'}`);
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const safeText = (s: unknown) => String(s ?? '').replace(/[*_`#<>[\]]/g, '').slice(0, 60);

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
    default:
      return null; // the intents of the newer data tools are answered by stub-answers.ts
  }
}

export { noData };
