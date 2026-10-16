/**
 * Privacy towards EXTERNAL model providers (ADR-0022): people names (`displayName` of tool data) leave as «Persona A/B…» and are
 * restored in the final answer; emails, phone numbers and tokens never leave. The map lives only in memory, per request.
 * Aggregated figures are not personal data and pass through untouched.
 */
const NAME_FIELD = /"displayName"\s*:\s*("(?:[^"\\]|\\.)*")/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /\+\d[\d\s().-]{7,}\d|(?<![\d-])\d{10,15}(?![\d-])/g;
const TOKEN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sk|pk|key|tok|ghp|xox[bap])[-_][A-Za-z0-9_-]{16,}/g;
const PLACEHOLDER = /\b(Persona|Person) ([A-Z]{1,2})\b/g;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function letters(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export class Pseudonymizer {
  private readonly byName = new Map<string, string>(); // lowercase real name -> letters
  private readonly byLetters = new Map<string, string>(); // letters -> real name

  constructor(private readonly locale: 'es' | 'en' = 'es') {}

  get size(): number {
    return this.byLetters.size;
  }

  /** Learns the names found in `"displayName":"…"` fields of a JSON text (tool results). */
  learn(text: string): void {
    for (const m of text.matchAll(NAME_FIELD)) {
      let name: unknown;
      try {
        name = JSON.parse(m[1] as string);
      } catch {
        continue;
      }
      if (typeof name === 'string') this.register(name);
    }
  }

  register(name: string): string {
    const clean = name.trim();
    const key = clean.toLowerCase();
    if (clean.length < 2) return clean;
    let code = this.byName.get(key);
    if (!code) {
      code = letters(this.byName.size);
      this.byName.set(key, code);
      this.byLetters.set(code, clean);
    }
    return this.label(code);
  }

  private label(code: string): string {
    return `${this.locale === 'es' ? 'Persona' : 'Person'} ${code}`;
  }

  /** Text safe to send out: names replaced (longest first), emails, phones and tokens masked. */
  sanitize(text: string): string {
    let out = text;
    const names = [...this.byName.keys()].sort((a, b) => b.length - a.length);
    for (const key of names) {
      const code = this.byName.get(key) as string;
      out = out.replace(new RegExp(escapeRe(key), 'gi'), this.label(code));
      // the same name inside JSON text, escaped (accents or quotes)
      const escaped = JSON.stringify(key).slice(1, -1);
      if (escaped !== key) out = out.replace(new RegExp(escapeRe(escaped), 'gi'), this.label(code));
    }
    return out.replace(EMAIL, '[email]').replace(TOKEN, '[token]').replace(PHONE, '[phone]');
  }

  /** Puts the real names back in a model answer (plain text or JSON text: JSON strings are restored leaf by leaf). */
  restore(text: string): string {
    if (this.byLetters.size === 0) return text;
    const plain = (s: string) => s.replace(PLACEHOLDER, (m, _w: string, code: string) => this.byLetters.get(code) ?? m);
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.stringify(this.restoreValue(JSON.parse(trimmed) as unknown));
      } catch {
        /* not JSON: plain text */
      }
    }
    return plain(text);
  }

  restoreValue(value: unknown): unknown {
    if (typeof value === 'string') return this.restore(value);
    if (Array.isArray(value)) return value.map((v) => this.restoreValue(v));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.restoreValue(v)]));
    return value;
  }
}
