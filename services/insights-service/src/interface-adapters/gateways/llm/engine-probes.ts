/** Cheap health checks (cached by the registry). None of them sends credentials except where noted, and none logs anything sensitive. */
type Fetch = typeof fetch;
const PROBE_TIMEOUT_MS = 2_500;

/** OpenCode Go: the key must be present and `GET {base}/v1/models` (listable without a key) must answer 2xx. */
export function opencodeProbe(o: { hasKey: boolean; disabledReason: string | null; baseUrl: string; fetch?: Fetch }): () => Promise<boolean> {
  const f = o.fetch ?? fetch;
  return async () => {
    if (!o.hasKey || o.disabledReason) return false;
    try {
      return (await f(`${o.baseUrl.replace(/\/+$/, '')}/v1/models`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })).ok;
    } catch {
      return false;
    }
  };
}

/** Ollama: `GET /api/tags` answers and the configured model is pulled. */
export function ollamaProbe(o: { url: string; model: string; fetch?: Fetch }): () => Promise<boolean> {
  const f = o.fetch ?? fetch;
  return async () => {
    try {
      const res = await f(`${o.url.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (!res.ok) return false;
      const json = (await res.json()) as { models?: { name?: string; model?: string }[] };
      const want = o.model.includes(':') ? o.model : `${o.model}:latest`;
      return (json.models ?? []).some((m) => (m.name ?? m.model) === want || (m.name ?? m.model) === o.model);
    } catch {
      return false;
    }
  };
}
