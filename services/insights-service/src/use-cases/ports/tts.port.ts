import type { Locale } from '../../entities/locale';

export interface TtsResult {
  audio: Buffer;
  mime: 'audio/mpeg' | 'audio/wav';
  durationSeconds: number;
}
export interface TtsPort {
  readonly provider: string;
  /** False for NullTts / unconfigured providers: the report is produced without audio. */
  readonly enabled: boolean;
  synthesize(text: string, locale: Locale): Promise<TtsResult>;
}
export const TTS_PORT = Symbol('TtsPort');
