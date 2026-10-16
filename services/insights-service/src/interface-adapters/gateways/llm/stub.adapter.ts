import type { Locale } from '../../../entities/locale';
import type { LlmBlock, LlmPort, LlmRequest, LlmResponse } from '../../../use-cases/ports/llm.port';
import { textOf } from './common';
import { buildDirectAnswer, detectIntent, parseRange } from './stub-intents';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const DAY = 86_400_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const startOfDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Date range of a question (es/en): named months, "today", "this week", "last week/month", "N days", default last 30 days. */
export function inferRange(question: string, today: string): { from: string; to: string } {
  return parseRange(question, today) ?? { from: ymd(startOfDay(today) - 29 * DAY), to: today };
}

const CATEGORY_RE = {
  events: /inscri|registr|event|ticket|taller/,
  credits: /cr[eé]dit|wallet|billetera|recarga|top.?up|gast|spen/,
  content: /publica|post|contenido|content|hashtag|engagement|social|coment|reacci/,
  moderation: /moderaci|moderat|flag|denunc|report(ed|es de)|marcad/,
  incidents: /saga|fall|fail|error|incident|compens/,
  health: /salud|health|servicio|service|cola|queue|dlq|ca[ií]d|down|infra/,
  anomalies: /anomal|inusual|unusual|pico|spike/,
};
function categories(question: string) {
  const q = question.toLowerCase();
  return Object.fromEntries(Object.entries(CATEGORY_RE).map(([k, re]) => [k, re.test(q)])) as Record<keyof typeof CATEGORY_RE, boolean>;
}
/** True when the deterministic planner recognizes nothing concrete (no intent, no topic keyword): the question is open. */
export function isGeneralQuestion(question: string): boolean {
  return detectIntent(question) === null && !Object.values(categories(question)).some(Boolean);
}

/** Arguments of every tool for a date range (the planner's defaults). */
export function toolInput(name: string, range: { from: string; to: string }, today: string): Obj | null {
  switch (name) {
    case 'get_platform_kpis': return { ...range };
    case 'get_registration_stats': return { ...range, groupBy: 'day' };
    case 'list_events': return { from: `${range.from}T00:00:00Z`, to: `${range.to}T23:59:59Z`, limit: 10 };
    case 'get_credit_stats': return { ...range, groupBy: 'day' };
    case 'get_content_stats': return { ...range, topHashtags: 5 };
    case 'list_flagged_content': return { source: 'ALL', limit: 10 };
    case 'list_failed_sagas': return { since: `${range.from}T00:00:00Z`, limit: 50 };
    case 'get_service_health': return { includeQueues: true };
    case 'detect_anomalies': return { metrics: ['registrationsConfirmed', 'registrationsFailed', 'posts', 'creditsSpent'], ...range, granularity: 'day', sensitivity: 0.6 };
    case 'list_recent_registrations': return { status: 'CONFIRMED', limit: 10, from: range.from, to: range.to };
    case 'get_top_credit_spenders': return { ...range, limit: 5 };
    default: void today; return null;
  }
}

/** Which tools a question calls for (keywords es/en). */
export function planTools(question: string, range: { from: string; to: string }, offered: Set<string>, today: string = new Date().toISOString().slice(0, 10)): { name: string; input: Obj }[] {
  const intent = detectIntent(question);
  const explicit = parseRange(question, today);
  const only = (name: string, input: Obj) => (offered.has(name) ? [{ name, input }] : []);
  if (intent === 'LAST_BUYER' || intent === 'RECENT_BUYERS') {
    return only('list_recent_registrations', { status: 'CONFIRMED', limit: intent === 'LAST_BUYER' ? 5 : 10, ...(explicit ? { from: explicit.from, to: explicit.to } : {}) });
  }
  if (intent === 'TOP_SPENDERS') return only('get_top_credit_spenders', { ...range, limit: 5 });
  if (intent === 'TOP_EVENT') return only('list_events', { from: `${ymd(startOfDay(today) - 365 * DAY)}T00:00:00Z`, to: `${ymd(startOfDay(today) + 365 * DAY)}T23:59:59Z`, limit: 50 });
  if (intent === 'NEW_USERS') return only('get_platform_kpis', range);
  const plan: { name: string; input: Obj }[] = [];
  const add = (name: string, input: Obj) => offered.has(name) && plan.push({ name, input });
  const { events, credits, content, moderation, incidents, health, anomalies } = categories(question);
  const general = isGeneralQuestion(question);
  add('get_platform_kpis', range);
  if (events || general) add('get_registration_stats', { ...range, groupBy: 'day' });
  if (events) add('list_events', { from: `${range.from}T00:00:00Z`, to: `${range.to}T23:59:59Z`, limit: 10 });
  if (credits || general) add('get_credit_stats', { ...range, groupBy: 'day' });
  if (content || general) add('get_content_stats', { ...range, topHashtags: 5 });
  if (moderation || general) add('list_flagged_content', { source: 'ALL', limit: 10 });
  if (incidents) add('list_failed_sagas', { since: `${range.from}T00:00:00Z`, limit: 50 });
  if (health || incidents) add('get_service_health', { includeQueues: true });
  if (anomalies) add('detect_anomalies', { metrics: ['registrationsConfirmed', 'registrationsFailed', 'posts', 'creditsSpent'], ...range, granularity: 'day', sensitivity: 0.6 });
  return plan;
}

export function toolData(messages: LlmRequest['messages']): Record<string, Obj> {
  const out: Record<string, Obj> = {};
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type !== 'tool_result' || b.isError) continue;
      const match = /<tool_data source="([^"]+)">([\s\S]*)<\/tool_data>/.exec(b.content);
      if (!match) continue;
      try {
        out[match[1] as string] = JSON.parse(match[2] as string) as Obj;
      } catch {
        /* truncated result: ignored */
      }
    }
  }
  return out;
}

const L = {
  es: {
    title: (f: string, t: string) => `Resumen de la plataforma: ${f} a ${t}`,
    intro: (f: string, t: string) => `Entre el ${f} y el ${t} se recopilaron los siguientes datos de Bandada U, obtenidos de las herramientas de la plataforma.`,
    social: (p: number, c: number, r: number) => `**Actividad social**: ${p} publicaciones, ${c} comentarios y ${r} reacciones.`,
    users: (n: number, a: number) => `**Usuarios**: ${n} usuarios nuevos; pico diario de usuarios activos: ${a}.`,
    regs: (c: number, f: number, k: number, p: number) => `**Inscripciones**: ${c} confirmadas, ${f} fallidas, ${k} canceladas y ${p} pendientes.`,
    credits: (t: number, d: number, r: number, n: number) => `**Créditos**: ${t} recargados, ${d} gastados en inscripciones y ${r} reembolsados; saldo neto ${n}.`,
    hashtags: (h: string) => `**Hashtags más usados**: ${h}.`,
    events: (e: string) => `**Eventos del periodo**: ${e}.`,
    flagged: (n: number) => `**Moderación**: ${n} contenidos pendientes de revisión.`,
    sagas: (n: number, r: string) => `**SAGAs**: ${n} fallidas o compensadas${r ? ` (${r})` : ''}.`,
    health: (o: string, down: string) => `**Salud de la plataforma**: estado general ${o}${down ? `; servicios caídos: ${down}` : '; todos los servicios responden'}.`,
    dlq: (q: string) => `**Colas con mensajes en dead letters**: ${q}.`,
    anomalies: (a: string) => `**Anomalías detectadas**: ${a}.`,
    limits: 'Limitaciones',
    limitsNames: 'Las cifras y los nombres provienen de las herramientas de datos de la plataforma. Los nombres para mostrar de los compradores solo son visibles para administradores; nunca se incluyen correos ni teléfonos. Este reporte se redactó con el generador determinista (sin modelo de lenguaje), por lo que no interpreta causas.',
    limitsText: 'Las cifras provienen de las herramientas de datos agregados de la plataforma; no incluyen datos personales. Este reporte se redactó con el generador determinista (sin modelo de lenguaje), por lo que no interpreta causas.',
    noData: 'No hay datos disponibles en el rango consultado.',
    cols: { date: 'Fecha', confirmed: 'Inscripciones confirmadas', failed: 'Inscripciones fallidas', cancelled: 'Inscripciones canceladas', posts: 'Publicaciones', creditsSpent: 'Créditos gastados', active: 'Usuarios activos', metric: 'Métrica', value: 'Valor' },
    audio: 'Resumen en audio de Bandada U.',
    metricNames: { posts: 'Publicaciones', comments: 'Comentarios', reactions: 'Reacciones', newUsers: 'Usuarios nuevos', registrationsConfirmed: 'Inscripciones confirmadas', registrationsFailed: 'Inscripciones fallidas', creditsToppedUp: 'Créditos recargados', creditsSpent: 'Créditos gastados', flaggedContent: 'Contenido marcado' } as Record<string, string>,
  },
  en: {
    title: (f: string, t: string) => `Platform summary: ${f} to ${t}`,
    intro: (f: string, t: string) => `Between ${f} and ${t} the following Bandada U data was collected from the platform tools.`,
    social: (p: number, c: number, r: number) => `**Social activity**: ${p} posts, ${c} comments and ${r} reactions.`,
    users: (n: number, a: number) => `**Users**: ${n} new users; daily peak of active users: ${a}.`,
    regs: (c: number, f: number, k: number, p: number) => `**Registrations**: ${c} confirmed, ${f} failed, ${k} cancelled and ${p} pending.`,
    credits: (t: number, d: number, r: number, n: number) => `**Credits**: ${t} topped up, ${d} spent on registrations and ${r} refunded; net balance ${n}.`,
    hashtags: (h: string) => `**Most used hashtags**: ${h}.`,
    events: (e: string) => `**Events in the period**: ${e}.`,
    flagged: (n: number) => `**Moderation**: ${n} items pending review.`,
    sagas: (n: number, r: string) => `**SAGAs**: ${n} failed or compensated${r ? ` (${r})` : ''}.`,
    health: (o: string, down: string) => `**Platform health**: overall status ${o}${down ? `; services down: ${down}` : '; all services respond'}.`,
    dlq: (q: string) => `**Queues with dead-lettered messages**: ${q}.`,
    anomalies: (a: string) => `**Anomalies detected**: ${a}.`,
    limits: 'Limitations',
    limitsNames: 'Figures and names come from the platform data tools. Buyers\' display names are only visible to administrators; emails and phone numbers are never included. This report was written by the deterministic generator (no language model), so it does not interpret causes.',
    limitsText: 'Figures come from the platform aggregate-data tools and contain no personal data. This report was written by the deterministic generator (no language model), so it does not interpret causes.',
    noData: 'No data is available for the requested range.',
    cols: { date: 'Date', confirmed: 'Confirmed registrations', failed: 'Failed registrations', cancelled: 'Cancelled registrations', posts: 'Posts', creditsSpent: 'Credits spent', active: 'Active users', metric: 'Metric', value: 'Value' },
    audio: 'Bandada U audio summary.',
    metricNames: { posts: 'Posts', comments: 'Comments', reactions: 'Reactions', newUsers: 'New users', registrationsConfirmed: 'Confirmed registrations', registrationsFailed: 'Failed registrations', creditsToppedUp: 'Credits topped up', creditsSpent: 'Credits spent', flaggedContent: 'Flagged content' } as Record<string, string>,
  },
} satisfies Record<Locale, Obj>;

const safeTag = (s: string) => `#${String(s).replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 30)}`;
const safeText = (s: string) => String(s).replace(/[*_`#<>[\]]/g, '').slice(0, 60);

export function composeFromData(locale: Locale, data: Record<string, Obj>, ctx: { question?: string; today?: string } = {}) {
  const t = L[locale];
  const kpis = data.get_platform_kpis;
  const regs = data.get_registration_stats;
  const credits = data.get_credit_stats;
  const content = data.get_content_stats;
  const flagged = data.list_flagged_content;
  const sagas = data.list_failed_sagas;
  const health = data.get_service_health;
  const anomalies = data.detect_anomalies;
  const events = data.list_events;
  const range = kpis ?? regs ?? credits ?? content;
  const from = range?.from ?? '';
  const to = range?.to ?? '';

  const bullets: string[] = [];
  if (kpis) {
    bullets.push(t.social(kpis.posts, kpis.comments, kpis.reactions));
    bullets.push(t.users(kpis.newUsers, kpis.activeUsers));
  } else if (content) bullets.push(t.social(content.totals.posts, content.totals.comments, content.totals.reactions));
  if (regs) bullets.push(t.regs(regs.totals.confirmed, regs.totals.failed, regs.totals.cancelled, regs.totals.pending));
  if (credits) bullets.push(t.credits(credits.totals.topUpCredits, credits.totals.debitCredits, credits.totals.refundCredits, credits.totals.netCredits));
  if (content?.topHashtags?.length) bullets.push(t.hashtags(content.topHashtags.slice(0, 5).map((h: Obj) => `${safeTag(h.hashtag)} (${h.count})`).join(', ')));
  if (events?.items?.length) bullets.push(t.events(events.items.slice(0, 5).map((e: Obj) => `${safeText(e.title)} (${e.seatsTaken}/${e.capacity})`).join(', ')));
  if (flagged) bullets.push(t.flagged(flagged.totalPending));
  if (sagas) bullets.push(t.sagas(sagas.count, Object.entries(sagas.byFailureReason ?? {}).map(([k, v]) => `${safeText(k)}: ${v}`).join(', ')));
  if (health) {
    const down = (health.services ?? []).filter((s: Obj) => s.status === 'DOWN').map((s: Obj) => s.name).join(', ');
    bullets.push(t.health(health.overall, down));
    const dlq = (health.queues ?? []).filter((q: Obj) => q.isDeadLetter && q.messagesReady > 0).map((q: Obj) => `${q.name} (${q.messagesReady})`).join(', ');
    if (dlq) bullets.push(t.dlq(dlq));
  }
  if (anomalies?.anomalies?.length) {
    bullets.push(t.anomalies(anomalies.anomalies.slice(0, 5).map((a: Obj) => `${a.metric} ${a.at}: ${a.value} (${locale === 'es' ? 'esperado' : 'expected'} ${a.expected})`).join('; ')));
  }

  // dataset: the most informative table the collected data supports
  let dataset: Obj;
  let chart: Obj;
  const c = t.cols;
  if (regs && regs.groupBy === 'day' && regs.rows?.length) {
    dataset = {
      columns: [{ name: 'date', label: c.date, type: 'date' }, { name: 'confirmed', label: c.confirmed, type: 'integer' }, { name: 'failed', label: c.failed, type: 'integer' }, { name: 'cancelled', label: c.cancelled, type: 'integer' }],
      rows: regs.rows.slice(0, 200).map((r: Obj) => [r.key, r.confirmed, r.failed, r.cancelled]),
    };
    chart = { type: regs.rows.length >= 3 ? 'line' : 'bar', x: 'date', y: 'confirmed', title: c.confirmed };
  } else if (kpis?.series?.some((s: Obj) => s.posts || s.registrationsConfirmed || s.creditsSpent || s.activeUsers)) {
    dataset = {
      columns: [{ name: 'date', label: c.date, type: 'date' }, { name: 'posts', label: c.posts, type: 'integer' }, { name: 'registrationsConfirmed', label: c.confirmed, type: 'integer' }, { name: 'creditsSpent', label: c.creditsSpent, type: 'integer' }],
      rows: kpis.series.slice(-200).map((s: Obj) => [s.date, s.posts, s.registrationsConfirmed, s.creditsSpent]),
    };
    chart = { type: 'line', x: 'date', y: 'posts', title: c.posts };
  } else if (kpis) {
    const keys = Object.keys(t.metricNames).filter((k) => typeof kpis[k] === 'number');
    dataset = { columns: [{ name: 'metric', label: c.metric, type: 'string' }, { name: 'value', label: c.value, type: 'integer' }], rows: keys.map((k) => [t.metricNames[k], kpis[k]]) };
    chart = { type: 'bar', x: 'metric', y: 'value', title: c.value };
  } else {
    dataset = { columns: [{ name: 'metric', label: c.metric, type: 'string' }, { name: 'value', label: c.value, type: 'integer' }], rows: [] };
    chart = { type: 'table' };
  }

  const intent = ctx.question ? detectIntent(ctx.question) : null;
  const direct = intent ? buildDirectAnswer(locale, intent, ctx.question ?? '', ctx.today ?? new Date().toISOString().slice(0, 10), data) : null;
  if (direct?.dataset) {
    dataset = direct.dataset;
    chart = direct.chart ?? { type: 'table' };
  }
  if (direct) {
    const title = locale === 'es' ? 'Respuesta de Bandada U' : 'Bandada U answer';
    const detail = direct.bullets.length > 0 ? direct.bullets : bullets;
    const markdown = [
      direct.answer,
      '',
      `## ${locale === 'es' ? 'Detalle' : 'Details'}`,
      '',
      ...detail.map((b) => `- ${b}`),
      '',
      `## ${t.limits}`,
      '',
      direct.usesNames ? t.limitsNames : t.limitsText,
    ].join('\n');
    return { title, markdown, dataset, chartIntent: chart };
  }

  const title = from && to ? t.title(from, to) : locale === 'es' ? 'Reporte de la plataforma' : 'Platform report';
  const markdown = [
    `## ${title}`,
    '',
    bullets.length ? (from ? t.intro(from, to) : '') : t.noData,
    '',
    ...bullets.map((b) => `- ${b}`),
    '',
    `## ${t.limits}`,
    '',
    t.limitsText,
  ].join('\n');
  return { title, markdown, dataset, chartIntent: chart };
}

const ALERT_TEXT: Record<string, string> = {
  SERVICE_DOWN: 'El servicio {r} no respondió a su chequeo de salud. Puede afectar a los estudiantes que usan sus funciones. Primera verificación: revisar el estado y los logs del contenedor de {r}. La causa exacta no está en los datos.',
  SAGA_FAILURES: 'Se detectaron inscripciones que no se completaron ({r}). Los estudiantes pueden quedar sin entrada y con créditos devueltos. Primera verificación: revisar ticketing-service y wallet-service y los motivos de fallo de las SAGAs. La causa exacta no está en los datos.',
  DLQ_BACKLOG: 'La cola {r} acumula mensajes sin procesar. Algunas notificaciones o proyecciones podrían estar retrasadas. Primera verificación: inspeccionar los mensajes de la cola en RabbitMQ y el consumidor correspondiente. La causa exacta no está en los datos.',
  MODERATION_BACKLOG: 'La cola de moderación supera el umbral. Contenido marcado podría seguir visible o bloqueado más tiempo del esperado. Primera verificación: asignar moderadores desde el panel.',
  METRIC_ANOMALY: 'La métrica {r} tuvo un valor inusual frente a su comportamiento habitual. Primera verificación: contrastar con eventos o campañas del día. La causa no está en los datos.',
  MODERATION_ESCALATION: 'Un autor acumula varios contenidos marcados. Primera verificación: revisar el historial de moderación desde el panel.',
};

const approxTokens = (s: string) => Math.ceil(s.length / 4);

/**
 * Deterministic LlmPort for local demos and CI (no network, no key): plans tool calls from keywords, then writes the
 * report with templates from the REAL tool results, so every figure in the text comes from the data (A2).
 */
export class StubLlmAdapter implements LlmPort {
  readonly provider = 'stub';

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const inTokens = approxTokens(req.system + JSON.stringify(req.messages));
    const respond = (content: LlmBlock[], stopReason: LlmResponse['stopReason']): LlmResponse => ({
      stopReason,
      content,
      usage: { inputTokens: inTokens, outputTokens: approxTokens(JSON.stringify(content)), cacheReadTokens: 0, cacheWriteTokens: 0 },
      model: 'stub-deterministic-1',
    });
    switch (req.purpose) {
      case 'collect': {
        const done = req.messages.some((m) => m.content.some((b) => b.type === 'tool_result'));
        if (done) return respond([{ type: 'text', text: req.locale === 'es' ? 'Datos recolectados; listo para redactar el reporte.' : 'Data collected; ready to write the report.' }], 'end_turn');
        const today = req.meta?.today ?? new Date().toISOString().slice(0, 10);
        const range = inferRange(req.meta?.question ?? '', today);
        const offered = new Set((req.tools ?? []).map((t) => t.name));
        const plan = planTools(req.meta?.question ?? '', range, offered, today);
        if (plan.length === 0) return respond([{ type: 'text', text: req.locale === 'es' ? 'No hay herramientas aplicables.' : 'No applicable tools.' }], 'end_turn');
        return respond(plan.map((p, i) => ({ type: 'tool_use' as const, id: `stub_${i + 1}`, name: p.name, input: p.input })), 'tool_use');
      }
      case 'compose':
      case 'correct':
        return respond([{ type: 'text', text: JSON.stringify(composeFromData(req.locale, toolData(req.messages), { question: req.meta?.question, today: req.meta?.today })) }], 'end_turn');
      case 'audio_script': {
        const md = textOf(req.messages.flatMap((m) => m.content));
        const body = md
          .split('\n')
          .filter((l) => l.startsWith('- ') || (!l.startsWith('#') && l.trim().length > 0))
          .slice(0, 8)
          .map((l) => l.replace(/^-\s*/, '').replace(/\*\*/g, '').replace(/[#`]/g, ''))
          .join('. ')
          .replace(/\.\./g, '.');
        return respond([{ type: 'text', text: `${L[req.locale].audio} ${body}` }], 'end_turn');
      }
      case 'explain_alert': {
        let kind = 'METRIC_ANOMALY';
        let resource = '';
        try {
          const f = JSON.parse(textOf(req.messages.flatMap((m) => m.content))) as { kind: string; resource: string };
          kind = f.kind;
          resource = f.resource;
        } catch {
          /* keep defaults */
        }
        return respond([{ type: 'text', text: (ALERT_TEXT[kind] ?? ALERT_TEXT.METRIC_ANOMALY ?? '').replaceAll('{r}', resource || 'afectado') }], 'end_turn');
      }
    }
  }
}
