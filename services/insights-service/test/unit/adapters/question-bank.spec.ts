import { hasProcessChatter, startsWithAnswer } from '../../../src/entities/policies/answer-quality';
import { checkNumberFidelity } from '../../../src/entities/policies/number-fidelity';
import { StubLlmAdapter } from '../../../src/interface-adapters/gateways/llm/stub.adapter';
import { CalculateUseCase } from '../../../src/use-cases/mcp-tools/calculate';
import type { LlmBlock, LlmMessage } from '../../../src/use-cases/ports/llm.port';
import { parseComposed } from '../../../src/use-cases/reports/report-schemas';

type Obj = Record<string, any>;
const TODAY = '2026-10-16'; // Friday
const TOOLS = [
  'calculate', 'detect_anomalies', 'get_content_rankings', 'get_content_stats', 'get_credit_stats', 'get_event_ranking', 'get_platform_kpis', 'get_registration_stats',
  'get_service_health', 'get_ticket_stats', 'get_top_credit_spenders', 'get_user_stats', 'get_wallet_overview', 'list_events', 'list_failed_sagas', 'list_flagged_content', 'list_recent_registrations',
].map((name) => ({ name, description: name, inputSchema: { type: 'object' } }));

const calc = new CalculateUseCase();
const series = (from: string, to: string, f: (d: string) => Obj) => {
  const out: Obj[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(f(new Date(t).toISOString().slice(0, 10)));
  return out;
};
const EVENTS = [
  { eventId: 'e1', title: 'Taller de Docker', startsAt: '2026-10-30T14:00:00Z', venue: 'Auditorio', capacity: 20, seatsTaken: 16, priceCredits: 20, status: 'PUBLISHED' },
  { eventId: 'e2', title: 'Hackathon UMSA', startsAt: '2026-10-22T09:00:00Z', venue: 'Lab', capacity: 40, seatsTaken: 9, priceCredits: 10, status: 'PUBLISHED' },
  { eventId: 'e3', title: 'Charla de IA', startsAt: '2026-11-05T18:00:00Z', venue: 'Aula 3', capacity: 100, seatsTaken: 0, priceCredits: 0, status: 'PUBLISHED' },
];
/** The platform as the tools see it; the numbers are what the expected answers quote. */
const WORLD: Record<string, (a: Obj) => Obj> = {
  calculate: (a) => ({ ...calc.execute(a.operation, a.values) }),
  get_wallet_overview: () => ({ creditsInCirculation: 1250, walletsWithBalance: 8, averageBalance: 156.25, topBalances: [{ userId: 'u1', displayName: 'Lucía Rojas', balanceCredits: 420 }, { userId: 'u2', displayName: 'Diego Flores', balanceCredits: 300 }] }),
  get_user_stats: () => ({ asOf: TODAY, totalUsers: 58, activeUsers: 50, suspendedUsers: 3, newUsers: null, byStatus: { ACTIVE: 50, SUSPENDED: 3, PENDING_VERIFICATION: 5 }, byUniversity: [{ universityId: 'x', name: 'UMSA', users: 40 }, { universityId: 'y', name: 'UCB', users: 18 }], byCareer: [{ career: 'Ingeniería de Sistemas', users: 22 }, { career: 'Derecho', users: 9 }] }),
  get_ticket_stats: (a) => ({ from: a.from, to: a.to, issued: 18, used: 5, voided: 2, usageRate: 0.2778, truncated: false, byEvent: [{ eventId: 'e1', title: 'Taller de Docker', issued: 9, used: 4, usageRate: 0.4444 }] }),
  get_content_rankings: (a) => ({ from: a.from, to: a.to, by: a.by, hashtags: [{ hashtag: 'umsa', posts: 7 }, { hashtag: 'docker', posts: 4 }], authors: [{ userId: 'u1', displayName: 'Lucía Rojas', posts: 6 }, { userId: 'u2', displayName: 'Diego Flores', posts: 3 }], posts: [{ postId: 'p1', excerpt: 'Hola mundo', author: { userId: 'u1', displayName: 'Lucía Rojas' }, reactions: 12, comments: 3 }] }),
  get_event_ranking: (a) => ({ from: a.from, to: a.to, by: a.by, items: [{ eventId: 'e1', title: 'Taller de Docker', value: 320, registrations: 16, capacity: 20, revenueCredits: 320, usedTickets: 4 }, { eventId: 'e2', title: 'Hackathon UMSA', value: 90, registrations: 9, capacity: 40, revenueCredits: 90, usedTickets: 1 }, { eventId: 'e3', title: 'Charla de IA', value: 0, registrations: 0, capacity: 100, revenueCredits: 0, usedTickets: 0 }] }),
  list_events: () => ({ truncated: false, items: EVENTS }),
  get_credit_stats: (a) => ({ from: a.from, to: a.to, groupBy: 'day', totals: { topUpCount: 4, topUpCredits: 500, debitCount: 11, debitCredits: 220, refundCount: 2, refundCredits: 40, netCredits: 240 }, series: series(a.from, a.to, (d) => ({ date: d, topUpCredits: d.endsWith('14') ? 300 : 0, debitCredits: d.endsWith('13') ? 120 : 10, refundCredits: 0 })) }),
  get_registration_stats: (a) => ({ from: a.from, to: a.to, groupBy: 'day', totals: { confirmed: a.from >= '2026-10-12' ? 11 : 7, failed: 2, cancelled: 1, pending: 0 }, rows: series(a.from, a.to, (d) => ({ key: d, confirmed: d.endsWith('13') ? 6 : 1, failed: 0, cancelled: 0 })) }),
  get_platform_kpis: (a) => ({ from: a.from, to: a.to, activeUsers: 12, newUsers: 4, posts: 22, comments: 14, reactions: 28, registrationsConfirmed: 11, registrationsFailed: 0, creditsToppedUp: 500, creditsSpent: 220, flaggedContent: 0, openAlerts: 0, series: series(a.from, a.to, (d) => ({ date: d, posts: d.endsWith('13') ? 9 : 1, comments: 1, newUsers: 0, activeUsers: 3, registrationsConfirmed: 1, creditsSpent: 10 })) }),
  list_flagged_content: () => ({ totalPending: 0, oldestEnqueuedAt: null, items: [] }),
  list_failed_sagas: () => ({ count: 2, byFailureReason: { EVENT_FULL: 2 }, items: [] }),
  get_service_health: () => ({ checkedAt: `${TODAY}T05:00:00Z`, overall: 'DEGRADED', services: [{ name: 'identity-service', status: 'UP' }, { name: 'wallet-service', status: 'UP' }, { name: 'ticketing-service', status: 'DOWN' }], queues: [{ name: 'q.wallet.dlq', isDeadLetter: true, messagesReady: 4 }, { name: 'q.events', isDeadLetter: false, messagesReady: 9 }] }),
  get_top_credit_spenders: (a) => ({ from: a.from, to: a.to, items: [{ displayName: 'Ana Pérez', creditsSpent: 105, registrations: 3 }] }),
  list_recent_registrations: () => ({ truncated: false, items: [{ registrationId: 'r1', event: { id: 'e', title: 'Taller de React Native' }, buyer: { userId: 'u1', displayName: 'Diego Flores' }, creditsPaid: 25, status: 'CONFIRMED', confirmedAt: '2026-10-16T14:32:00Z' }] }),
};

async function run(question: string, locale: 'es' | 'en') {
  const stub = new StubLlmAdapter();
  const messages: LlmMessage[] = [{ role: 'user', content: [{ type: 'text', text: question }] }];
  const called: { name: string; input: Obj }[] = [];
  const results: unknown[] = [];
  for (let round = 0; round < 4; round++) {
    const res = await stub.complete({ tier: 'smart', purpose: 'collect', locale, system: 's', messages, tools: TOOLS, maxTokens: 500, meta: { question, today: TODAY } });
    messages.push({ role: 'assistant', content: res.content });
    if (res.stopReason !== 'tool_use') break;
    const calls = res.content.filter((b): b is Extract<LlmBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    const out = calls.map((c): LlmBlock => {
      const value = (WORLD[c.name] ?? (() => ({})))(c.input);
      called.push({ name: c.name, input: c.input });
      results.push(value);
      return { type: 'tool_result', toolUseId: c.id, content: `<tool_data source="${c.name}">${JSON.stringify(value)}</tool_data>` };
    });
    messages.push({ role: 'user', content: out });
  }
  const composed = await stub.complete({ tier: 'smart', purpose: 'compose', locale, system: 's', messages, maxTokens: 500, meta: { question, today: TODAY } });
  const report = parseComposed((composed.content[0] as { text: string }).text);
  return { first: report.markdown.split('\n')[0] ?? '', markdown: report.markdown, called, results, report };
}

// [question, locale, first tool, substrings expected in the FIRST line]
const BANK: [string, 'es' | 'en', string, string[]][] = [
  ['¿cuál es el usuario con más créditos?', 'es', 'get_wallet_overview', ['Lucía Rojas', '420 créditos']],
  ['¿Quién tiene el saldo más alto?', 'es', 'get_wallet_overview', ['Lucía Rojas']],
  ['¿Cuántos créditos hay en circulación en total?', 'es', 'get_wallet_overview', ['1250 créditos', 'en circulación']],
  ['¿Cuál es el saldo promedio de las billeteras?', 'es', 'get_wallet_overview', ['156.25']],
  ['¿Cuántos reembolsos hubo este mes?', 'es', 'get_credit_stats', ['2 reembolsos', '40 créditos']],
  ['¿Cuántos usuarios hay registrados en total?', 'es', 'get_user_stats', ['58 usuarios registrados']],
  ['¿Cuántos usuarios están suspendidos?', 'es', 'get_user_stats', ['3 usuarios suspendidos', '58']],
  ['¿Cuántos usuarios hay por universidad?', 'es', 'get_user_stats', ['UMSA (40)', 'UCB (18)']],
  ['¿Qué universidad tiene más usuarios?', 'es', 'get_user_stats', ['UMSA', '40']],
  ['¿Qué carrera tiene más usuarios?', 'es', 'get_user_stats', ['Ingeniería de Sistemas', '22']],
  ['¿Cuántos usuarios activos hubo ayer?', 'es', 'get_platform_kpis', ['Ayer', '12 usuarios activos']],
  ['¿Cuántos tickets se han emitido?', 'es', 'get_ticket_stats', ['18 tickets', '5 usados']],
  ['¿Cuántos tickets fueron usados?', 'es', 'get_ticket_stats', ['5 de 18']],
  ['¿Cuál es la tasa de asistencia a los eventos?', 'es', 'get_ticket_stats', ['5 de 18', '27.78 %']],
  ['¿Qué evento tuvo más asistencia?', 'es', 'get_event_ranking', ['Taller de Docker', '4 tickets usados']],
  ['¿Qué evento tiene el cupo más lleno?', 'es', 'get_event_ranking', ['Taller de Docker', '16 de 20']],
  ['¿Cuánto ingreso generó el Taller de Docker?', 'es', 'get_event_ranking', ['Taller de Docker', '320 créditos']],
  ['Top 3 eventos por ingresos', 'es', 'get_event_ranking', ['Los 3 eventos', 'Taller de Docker', 'Hackathon UMSA']],
  ['¿Cuántos eventos hay publicados?', 'es', 'list_events', ['3 eventos publicados']],
  ['¿Cuáles son los próximos eventos?', 'es', 'list_events', ['Hackathon UMSA', '22/10/2026']],
  ['¿Qué eventos no tienen inscritos?', 'es', 'list_events', ['1 evento sin inscritos', 'Charla de IA']],
  ['¿Cuáles son los hashtags más usados?', 'es', 'get_content_rankings', ['#umsa', '7 publicaciones']],
  ['¿Quién publicó más esta semana?', 'es', 'get_content_rankings', ['Lucía Rojas', '6 publicaciones']],
  ['¿Qué publicación tiene más reacciones?', 'es', 'get_content_rankings', ['Lucía Rojas', 'Hola mundo', '12 reacciones']],
  ['¿Hay contenido pendiente de moderación?', 'es', 'list_flagged_content', ['No hay contenido pendiente']],
  ['¿Cuántas denuncias abiertas hay?', 'es', 'list_flagged_content', ['No hay contenido pendiente']],
  ['¿Cómo están los servicios?', 'es', 'get_service_health', ['degradada', '2 de 3', 'ticketing-service']],
  ['¿Hay mensajes en las colas de error?', 'es', 'get_service_health', ['q.wallet.dlq (4)']],
  ['¿Qué sagas fallaron hoy?', 'es', 'list_failed_sagas', ['2 SAGAs', 'EVENT_FULL: 2']],
  ['Compara las inscripciones de esta semana con la semana pasada', 'es', 'get_registration_stats', ['11 inscripciones confirmadas frente a 7', '+57.14 %']],
  ['Compara los créditos gastados de este mes con el mes pasado', 'es', 'get_credit_stats', ['220 créditos gastados frente a 220', '(0 %)']],
  ['¿Cuál fue el día con más inscripciones del último mes?', 'es', 'get_registration_stats', ['13/', 'con 6']],
  ['¿Cuál es el promedio de créditos por inscripción?', 'es', 'get_credit_stats', ['20 créditos', '220 créditos']],
  ['¿Cuántas inscripciones fallaron esta semana?', 'es', 'get_registration_stats', ['2']],
  ['¿Cuántos créditos se gastaron hoy?', 'es', 'get_credit_stats', ['Hoy', '220 créditos']],
  ['¿Quién gastó más créditos esta semana?', 'es', 'get_top_credit_spenders', ['Ana Pérez', '105 créditos']],
  ['¿Quién compró el último ticket?', 'es', 'list_recent_registrations', ['Diego Flores']],
  ['Who has the highest credit balance?', 'en', 'get_wallet_overview', ['Lucía Rojas', '420 credits']],
  ['How many credits are in circulation?', 'en', 'get_wallet_overview', ['1250 credits', 'in circulation']],
  ['How many users are there in total?', 'en', 'get_user_stats', ['58 registered users']],
  ['How many users are suspended?', 'en', 'get_user_stats', ['3 suspended users']],
  ['Which university has the most users?', 'en', 'get_user_stats', ['UMSA', '40']],
  ['How many tickets were used?', 'en', 'get_ticket_stats', ['5 of 18']],
  ['How many tickets were issued?', 'en', 'get_ticket_stats', ['18 tickets']],
  ['Top 3 events by revenue', 'en', 'get_event_ranking', ['top 3 events', 'Taller de Docker (320 credits)']],
  ['Which event has the fullest seats?', 'en', 'get_event_ranking', ['Taller de Docker', '16 of 20']],
  ['Which event had the most attendance?', 'en', 'get_event_ranking', ['Taller de Docker', '4 used tickets']],
  ['What are the most used hashtags?', 'en', 'get_content_rankings', ['#umsa', '7 posts']],
  ['Who posted the most this week?', 'en', 'get_content_rankings', ['Lucía Rojas', '6 posts']],
  ['Which post has the most reactions?', 'en', 'get_content_rankings', ['Lucía Rojas', '12 reactions']],
  ['What is the platform health?', 'en', 'get_service_health', ['degraded', '2 of 3']],
  ['Are there messages in the error queues?', 'en', 'get_service_health', ['q.wallet.dlq (4)']],
  ['Compare this week registrations with last week', 'en', 'get_registration_stats', ['11 confirmed registrations versus 7', '+57.14 %']],
  ['What is the average credits per registration?', 'en', 'get_credit_stats', ['20 credits']],
  ['How many events are published?', 'en', 'list_events', ['3 published events']],
  ['What are the upcoming events?', 'en', 'list_events', ['Hackathon UMSA', '2026-10-22']],
  ['Is there content pending moderation?', 'en', 'list_flagged_content', ['no content pending moderation']],
];

describe(`question bank (${BANK.length} questions es/en): deterministic planner + direct answers`, () => {
  it('has at least 40 questions in both languages', () => {
    expect(BANK.length).toBeGreaterThanOrEqual(40);
    expect(BANK.filter((b) => b[1] === 'en').length).toBeGreaterThanOrEqual(15);
  });

  it.each(BANK)('%s (%s)', async (question, locale, firstTool, expected) => {
    const r = await run(question, locale);
    expect(r.called.map((c) => c.name)).toContain(firstTool);
    for (const e of expected) expect(r.first).toContain(e);
    // direct answer first, never a heading/preamble, never process chatter, never the generic summary
    expect(startsWithAnswer(r.markdown)).toBe(true);
    expect(hasProcessChatter(r.markdown)).toBe(false);
    expect(r.report.title).not.toMatch(/Resumen de la plataforma|Platform summary/);
    // every figure of the deterministic text is backed by the tool data (the same verifier that guards the model text)
    const fid = checkNumberFidelity(r.markdown, r.report.dataset, r.results, { question, today: TODAY, toolCalls: r.called });
    expect(fid.unsupported).toEqual([]);
  });

  it('derived figures come from calculate (percent change, ratio, usage rate)', async () => {
    expect((await run('Compara las inscripciones de esta semana con la semana pasada', 'es')).called.map((c) => c.name)).toEqual(['get_registration_stats', 'get_registration_stats', 'calculate']);
    expect((await run('¿Cuál es el promedio de créditos por inscripción?', 'es')).called.at(-1)).toMatchObject({ name: 'calculate', input: { operation: 'RATIO', values: [220, 7] } });
    expect((await run('What is the ticket usage rate?', 'en')).called.at(-1)).toMatchObject({ name: 'calculate', input: { operation: 'PERCENT', values: [5, 18] } });
  });

  it('resolves relative dates in code (this week = Monday → today, last month, last N days)', async () => {
    expect((await run('¿Quién publicó más esta semana?', 'es')).called[0]?.input).toMatchObject({ from: '2026-10-12', to: TODAY, by: 'AUTHORS' });
    expect((await run('¿Cuántos reembolsos hubo el mes pasado?', 'es')).called[0]?.input).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect((await run('hashtags de los últimos 7 días', 'es')).called[0]?.input).toMatchObject({ from: '2026-10-10', to: TODAY });
  });
});
