/**
 * Q&A mode offers the model only the tools that the question's topic can need (fewer definitions = fewer tokens and fewer wrong picks).
 * The union of every matching topic is offered, `calculate` only when the question asks for a derived figure; a question with no recognizable topic gets every tool.
 */
const TOPICS: { match: RegExp; tools: string[] }[] = [
  { match: /usuari|\busers?\b|estudiant|students?|alumn|carrera|career|universidad|universit|suspendid|suspended|cuentas|accounts|activos?\b|active/i, tools: ['get_user_stats', 'get_platform_kpis'] },
  { match: /cr[eé]dit|credits?|saldo|balance|billetera|wallet|recarg|top.?up|reembols|refund|\bgast|\bspen|circulaci|circulat|promedio|average/i, tools: ['get_wallet_overview', 'get_credit_stats', 'get_top_credit_spenders', 'get_registration_stats'] },
  { match: /evento|event|cupo|seat|ingres|revenue|income|taller|workshop|hackathon|charla|inscri|registr|compr|bought|purchas|buyer/i, tools: ['list_events', 'get_event_ranking', 'get_registration_stats', 'get_ticket_stats', 'list_recent_registrations', 'get_top_credit_spenders'] },
  { match: /ticket|entrada|boleto|asistencia|attendance|attended|asisti/i, tools: ['get_ticket_stats', 'get_event_ranking', 'list_recent_registrations'] },
  { match: /publicaci|\bposts?\b|hashtag|comentario|comment|reacci|contenido|content|autor|author|public[oó]|posted/i, tools: ['get_content_rankings', 'get_content_stats', 'get_platform_kpis'] },
  { match: /moderaci|moderat|denunc|flagged|marcad|reported/i, tools: ['list_flagged_content'] },
  { match: /\bsagas?\b|fall|fail|compensad/i, tools: ['list_failed_sagas', 'get_registration_stats'] },
  { match: /servicio|service|salud|health|cola|queue|dlq|dead.?letter|ca[ií]d|down|plataforma|platform/i, tools: ['get_service_health'] },
  { match: /anomal|inusual|unusual|spike|pico/i, tools: ['detect_anomalies', 'get_platform_kpis'] },
  { match: /actividad|activity|crecimiento|growth|kpi|resumen|summary/i, tools: ['get_platform_kpis', 'get_registration_stats', 'get_credit_stats', 'get_content_stats', 'list_flagged_content', 'get_service_health'] },
];

/** Questions whose answer needs a derived figure: only then is `calculate` worth its tokens. */
const NEEDS_CALCULATION = /compar|promedio|porcentaj|%|diferencia|cu[aá]nto\s+(m[aá]s|menos)|ratio|raz[oó]n|proporci|crecimiento|cambio|variaci|average|\bavg\b|percent|difference|versus|\bvs\b|growth|change|ratio|per\s+(registration|user|ticket)|por\s+(inscripci|usuario|ticket)|tasa|rate\b|sum[ao]|total\s+de\s+.*\s+y\s+/i;

export function routeTools<T extends { name: string }>(question: string, tools: T[]): T[] {
  const wanted = new Set<string>();
  for (const t of TOPICS) if (t.match.test(question)) for (const n of t.tools) wanted.add(n);
  if (wanted.size === 0) return tools;
  if (NEEDS_CALCULATION.test(question)) wanted.add('calculate');
  const picked = tools.filter((t) => wanted.has(t.name));
  // never route to nothing (e.g. the topic's tools are not deployed): fall back to every tool
  return picked.filter((t) => t.name !== 'calculate').length > 0 ? picked : tools;
}
