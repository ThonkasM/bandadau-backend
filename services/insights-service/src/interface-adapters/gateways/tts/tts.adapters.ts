import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';

import type { Locale } from '../../../entities/locale';
import type { TtsPort, TtsResult } from '../../../use-cases/ports/tts.port';

export class NullTts implements TtsPort {
  readonly provider = 'none';
  readonly enabled = false;
  async synthesize(): Promise<TtsResult> {
    throw new Error('TTS is disabled (TTS_PROVIDER=none)');
  }
}

/** Duration of a PCM WAV from its header (`fmt ` and `data` chunks); falls back to a words-per-second estimate. */
export function wavDurationSeconds(wav: Buffer, fallbackWords = 0): number {
  try {
    if (wav.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not RIFF');
    let pos = 12;
    let byteRate = 0;
    while (pos + 8 <= wav.length) {
      const id = wav.toString('ascii', pos, pos + 4);
      const size = wav.readUInt32LE(pos + 4);
      if (id === 'fmt ') byteRate = wav.readUInt32LE(pos + 16);
      if (id === 'data') {
        const bytes = size === 0xffffffff || pos + 8 + size > wav.length ? wav.length - pos - 8 : size;
        if (byteRate > 0) return bytes / byteRate;
        break;
      }
      pos += 8 + size + (size % 2);
    }
  } catch {
    /* fall through */
  }
  return fallbackWords / 2.5;
}

const words = (t: string) => t.trim().split(/\s+/).length;

export interface PiperOptions {
  url: string;
  voiceEs: string;
  voiceEn: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** Piper HTTP server (local): `POST PIPER_URL {text, voice}` -> `audio/wav`. */
export class PiperTts implements TtsPort {
  readonly provider = 'piper';
  readonly enabled = true;
  constructor(private readonly o: PiperOptions) {}

  async synthesize(text: string, locale: Locale): Promise<TtsResult> {
    const f = this.o.fetch ?? fetch;
    const res = await f(this.o.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: locale === 'es' ? this.o.voiceEs : this.o.voiceEn }),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 60_000),
    });
    if (!res.ok) throw new Error(`Piper responded ${res.status}`);
    const audio = Buffer.from(await res.arrayBuffer());
    return { audio, mime: 'audio/wav', durationSeconds: wavDurationSeconds(audio, words(text)) };
  }
}

export interface PollyOptions {
  region: string;
  voiceEs: string;
  voiceEn: string;
  /** False when no real AWS credentials are available (local `AWS_ACCESS_KEY_ID=local`). */
  enabled: boolean;
  client?: Pick<PollyClient, 'send'>;
}

/** Amazon Polly neural voices (prod). Output MP3 (neural 24 kHz ~ 48 kbps). */
export class PollyTts implements TtsPort {
  readonly provider = 'polly';
  readonly enabled: boolean;
  private readonly client: Pick<PollyClient, 'send'>;
  constructor(private readonly o: PollyOptions) {
    this.enabled = o.enabled;
    this.client = o.client ?? new PollyClient({ region: o.region });
  }

  async synthesize(text: string, locale: Locale): Promise<TtsResult> {
    const res = await this.client.send(
      new SynthesizeSpeechCommand({
        Engine: 'neural',
        OutputFormat: 'mp3',
        Text: text,
        VoiceId: (locale === 'es' ? this.o.voiceEs : this.o.voiceEn) as never,
        LanguageCode: locale === 'es' ? 'es-MX' : 'en-US',
      }),
    );
    const bytes = await res.AudioStream?.transformToByteArray();
    if (!bytes) throw new Error('Polly returned no audio');
    const audio = Buffer.from(bytes);
    return { audio, mime: 'audio/mpeg', durationSeconds: Math.max(words(text) / 2.6, (audio.length * 8) / 48_000) };
  }
}
