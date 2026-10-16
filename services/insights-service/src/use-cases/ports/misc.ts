import type { Locale } from '../../entities/locale';
import type { MetricName } from '../../entities/metric-point';
import type { AnomalyPoint, SeriesPoint } from '../../entities/policies/stat-anomaly';

export interface Clock {
  now(): Date;
}
export const CLOCK = Symbol('Clock');
export interface IdGenerator {
  next(): string;
}
export const ID_GENERATOR = Symbol('IdGenerator');

export interface OutboundMessage {
  type: string;
  subject: string;
  data: Record<string, unknown>;
  correlationId?: string;
}

export interface AudioStorage {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  /** Presigned GET URL (15 min) reachable by the client (S3_PUBLIC_ENDPOINT). */
  presignedUrl(key: string, ttlSeconds: number): Promise<string>;
}
export const AUDIO_STORAGE = Symbol('AudioStorage');

export interface AnomalyDetector {
  readonly modelVersion: string;
  detect(metric: MetricName, series: SeriesPoint[], sensitivity: number): Promise<AnomalyPoint[]>;
}
export const ANOMALY_DETECTOR = Symbol('AnomalyDetector');

/** Runs background work in-process (report generation) with bounded concurrency. */
export interface JobRunner {
  enqueue(name: string, job: () => Promise<void>): void;
}
export const JOB_RUNNER = Symbol('JobRunner');

export interface PromptCatalog {
  version: string;
  system(agent: 'report' | 'alert', locale: Locale): string;
  compose(locale: Locale, question: string): string;
  /** Q&A mode (a concrete question, not a summary): short system prompt for the agent loop. */
  qaSystem(locale: Locale): string;
  /** Q&A mode: JSON composition (direct answer first) for engines that do not write the final text themselves. */
  qaCompose(locale: Locale, question: string): string;
  /** Internal instruction of the single silent regeneration (never shown to the user). */
  rewrite(locale: Locale, unsupported: number[], problems: { chatter: boolean; notAnAnswer: boolean }): string;
  audio(locale: Locale): string;
}
export const PROMPT_CATALOG = Symbol('PromptCatalog');

export interface AppLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}
export const APP_LOGGER = Symbol('AppLogger');
