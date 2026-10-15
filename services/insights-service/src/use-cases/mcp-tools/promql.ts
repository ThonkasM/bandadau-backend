import { ValidationError } from '../../entities/errors/domain-errors';

export const METRIC_ALLOWLIST = [
  'http_server_request_duration_seconds',
  'traefik_service_request_duration_seconds',
  'saga_duration_seconds',
  'saga_compensations_total',
  'saga_active',
  'idempotency_replays_total',
  'inbox_duplicates_total',
  'outbox_pending',
  'outbox_publish_lag_seconds',
  'messaging_consume_failures_total',
  'dlq_depth',
  'moderation_backlog',
  'ml_inference_duration_seconds',
  'ml_decisions_total',
  'auth_login_failures_total',
  'agent_runs_total',
  'agent_tokens_total',
] as const;

const KEYWORDS = new Set(
  `sum avg min max count stddev stdvar group topk bottomk quantile count_values by without on ignoring group_left group_right bool offset and or unless
   rate irate increase delta idelta deriv resets changes histogram_quantile histogram_count histogram_sum clamp clamp_min clamp_max round abs ceil floor sqrt exp ln log2 log10
   avg_over_time sum_over_time min_over_time max_over_time count_over_time quantile_over_time stddev_over_time last_over_time present_over_time predict_linear
   vector scalar time timestamp label_replace label_join sort sort_desc absent absent_over_time inf nan le`.split(/\s+/),
);

const MAX_SUBQUERY_SECONDS = 24 * 3600;
const UNIT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

const toSeconds = (d: string): number => [...d.matchAll(/(\d+)([smhdw])/g)].reduce((n, m) => n + Number(m[1]) * (UNIT[m[2] as string] as number), 0);

/** Light PromQL guard: every metric selector must be allowlisted; no `__name__` tricks; ranges inside subqueries <= 24 h. */
export function validatePromql(query: string): void {
  const fail = (m: string): never => {
    throw new ValidationError(m, [{ field: 'query', code: 'NOT_ALLOWED', message: m }]);
  };
  if (/__name__/.test(query)) fail('Selectors by __name__ are not allowed.');
  // remove string literals and label matcher bodies; keep structure
  const noStrings = query.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  for (const m of noStrings.matchAll(/\[([^\]]+)\]/g)) {
    const range = (m[1] as string).split(':');
    if (range.length === 2 && toSeconds(range[0] as string) > MAX_SUBQUERY_SECONDS) fail('Subquery ranges above 24 h are not allowed.');
  }
  const stripped = noStrings.replace(/\{[^}]*\}/g, '').replace(/\[[^\]]*\]/g, '');
  // identifiers in `by (…)` / `without (…)` / `on (…)` lists are label names, not metrics
  const noLabels = stripped.replace(/\b(?:by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/g, ' ');
  const names = [...noLabels.matchAll(/[a-zA-Z_:][a-zA-Z0-9_:]*/g)].map((m) => m[0]).filter((n) => !KEYWORDS.has(n));
  const selectors = names.filter((n) => !/^\d/.test(n));
  if (selectors.length === 0) fail('The query must select at least one allowlisted metric.');
  for (const n of selectors) {
    const base = n.replace(/_(bucket|count|sum)$/, '');
    if (!(METRIC_ALLOWLIST as readonly string[]).includes(n) && !(METRIC_ALLOWLIST as readonly string[]).includes(base)) fail(`Metric ${n} is not in the allowlist.`);
  }
  // selectors without a metric name: `{job="x"}` at the start or after an operator/paren
  if (/(^|[(,\s])\{/.test(noStrings.replace(/\b(?:by|without|on|ignoring)\s*\([^)]*\)/g, ''))) {
    if (/(^|[(,+\-*/\s])\{[^}]*\}/.test(noStrings) && !/[a-zA-Z_:][a-zA-Z0-9_:]*\s*\{/.test(noStrings)) fail('Selectors without a metric name are not allowed.');
  }
}
