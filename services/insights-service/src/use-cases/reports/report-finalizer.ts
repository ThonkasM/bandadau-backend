import type { Locale } from '../../entities/locale';
import { buildChartSpec, type ChartIntent } from '../../entities/policies/chart-spec';
import type { GeneratedReport, ReportDataset } from '../../entities/report';
import type { ConcreteEngine } from '../../entities/report-engine';
import { reportReadyMessage } from '../messages';
import type { AppLogger,AudioStorage, Clock } from '../ports/misc';
import type { ReportRepository } from '../ports/repositories';
import type { TtsPort } from '../ports/tts.port';
import { hashDataset } from './dataset-hash';

export const AUDIO_MAX_SECONDS = 90;
const WORD_LIMIT: Record<Locale, number> = { es: 200, en: 220 };

/** Trims a narration script to the word budget that keeps the audio under 90 s (cut on a sentence boundary when possible). */
export function limitWords(text: string, locale: Locale): string {
  const words = text.trim().split(/\s+/);
  const max = WORD_LIMIT[locale];
  if (words.length <= max) return text.trim();
  const cut = words.slice(0, max).join(' ');
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.'));
  return lastStop > cut.length * 0.6 ? cut.slice(0, lastStop + 1) : `${cut}.`;
}

/** Removes anything stylistic from an externally supplied Vega-Lite spec: colors come from design tokens in the MFE (D13). */
export function stripChartStyling(spec: Record<string, unknown>): Record<string, unknown> {
  const DROP = new Set(['config', 'range', 'scheme', 'fill', 'stroke', 'background', 'font', 'fontSize', 'fontWeight', 'strokeWidth', 'opacity']);
  const walk = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (DROP.has(k)) continue;
        // a `color` encoding channel (object with `field`) is data-driven and allowed; a literal color string is not
        if (k === 'color' && typeof x === 'string') continue;
        if (k === 'data' && x && typeof x === 'object' && 'url' in x) continue;
        out[k] = walk(x, k);
      }
      return out;
    }
    void key;
    return v;
  };
  const clean = walk(spec) as Record<string, unknown>;
  clean.data = { name: 'dataset' };
  return clean;
}

export interface FinalizeInput {
  title: string;
  markdown: string;
  dataset: ReportDataset | null;
  chartIntent?: ChartIntent | null;
  chartSpec?: Record<string, unknown> | null;
  audioScript?: string | null;
  fidelityWarning?: boolean;
  /** Real engine and model that wrote it (ADR-0022). */
  engine?: ConcreteEngine | null;
  model?: string | null;
}

/** Last phase shared by the ReportAgent and the external `generate_report` tool: chart, hash, audio, READY, outbox event. */
export class ReportFinalizer {
  constructor(
    private readonly reports: ReportRepository,
    private readonly tts: TtsPort,
    private readonly storage: AudioStorage,
    private readonly clock: Clock,
    private readonly logger: AppLogger,
  ) {}

  async finish(report: GeneratedReport, input: FinalizeInput): Promise<GeneratedReport> {
    const next: GeneratedReport = {
      ...report,
      title: input.title.slice(0, 140),
      markdown: input.markdown,
      dataset: input.dataset,
      datasetHash: input.dataset ? hashDataset(input.dataset) : null,
      fidelityWarning: input.fidelityWarning ?? false,
      ...(input.engine !== undefined ? { engine: input.engine } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      chart: input.chartSpec ? stripChartStyling(input.chartSpec) : input.chartIntent && input.dataset ? buildChartSpec(input.chartIntent, input.dataset) : null,
    };
    const script = input.audioScript?.trim();
    if (script && this.tts.enabled) {
      try {
        const spoken = limitWords(script, report.locale);
        const audio = await this.tts.synthesize(spoken, report.locale);
        const key = `reports/${report.id}/summary.${report.locale}.${audio.mime === 'audio/wav' ? 'wav' : 'mp3'}`;
        await this.storage.put(key, audio.audio, audio.mime);
        next.audioKey = key;
        next.audioMime = audio.mime;
        next.audioDurationSeconds = Math.min(AUDIO_MAX_SECONDS, Math.max(1, Math.round(audio.durationSeconds)));
      } catch (error) {
        // graceful degradation: the report is still READY, without audio
        next.audioError = (error as Error).message.slice(0, 200);
        this.logger.warn('tts failed; report without audio', { reportId: report.id, error: next.audioError });
      }
    }
    const now = this.clock.now().toISOString();
    next.status = 'READY';
    next.completedAt = now;
    await this.reports.save(next, [reportReadyMessage(next, now)]);
    return next;
  }

  async fail(report: GeneratedReport, reason: string): Promise<GeneratedReport> {
    const now = this.clock.now().toISOString();
    const next: GeneratedReport = { ...report, status: 'FAILED', failureReason: reason.slice(0, 300), completedAt: now };
    await this.reports.save(next, [reportReadyMessage(next, now)]);
    return next;
  }
}
