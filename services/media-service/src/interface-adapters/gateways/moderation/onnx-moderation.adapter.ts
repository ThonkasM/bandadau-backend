import sharp from 'sharp';

import { decide, type ModerationThresholds } from '../../../entities/moderation-policy';
import type { ModerationPort, ModerationStatus, ModerationVerdict, ObjectStorage } from '../../../use-cases/ports';
import type { JsonLogger } from '../../logger';
import type { FfmpegFrameExtractor } from './ffmpeg-frame-extractor';
import { OnnxImageClassifier } from './onnx-image-classifier';
import type { S3ModelRegistry } from './s3-model-registry';

export interface OnnxModerationOptions {
  modelName: string;
  modelVersion: string;
  variant: 'fp32' | 'int8';
  threads: number;
  /** Env overrides; default = the model's metadata.json thresholds. */
  blockThreshold?: number | undefined;
  reviewThreshold?: number | undefined;
  maxVideoSeconds: number;
  /** Seconds between analysed frames (same value as the frame extractor), to timestamp `frameScores`. */
  frameIntervalSeconds: number;
  retryMs: number;
}

/**
 * Phase-2 `ModerationPort`: NSFW classifier (ONNX, onnxruntime-node). Images -> P(nsfw); video -> 1 frame / 2 s, score = max over frames.
 * If the model cannot be loaded the adapter DEGRADES to manual review (everything FLAGGED) and keeps retrying in the background.
 */
export class OnnxModerationAdapter implements ModerationPort {
  private classifier: OnnxImageClassifier | null = null;
  private thresholds: ModerationThresholds = { block: 0.85, review: 0.5 };
  private loadError: string | null = null;
  private loading: Promise<void> | null = null;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly registry: S3ModelRegistry,
    private readonly storage: ObjectStorage,
    private readonly frames: FfmpegFrameExtractor,
    private readonly o: OnnxModerationOptions,
    private readonly logger: JsonLogger,
  ) {}

  get modelVersionLabel(): string {
    return `${this.o.modelName}@${this.o.modelVersion}`;
  }

  /** Loads the model (never throws). Schedules background retries while degraded. */
  init(): Promise<void> {
    this.loading ??= this.tryLoad().finally(() => (this.loading = null));
    return this.loading;
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  private async tryLoad(): Promise<void> {
    try {
      const files = await this.registry.load(this.o.modelName, this.o.modelVersion, this.o.variant);
      this.classifier = await OnnxImageClassifier.create(files.modelPath, files.metadata, this.o.threads);
      this.thresholds = {
        block: this.o.blockThreshold ?? files.metadata.thresholds.block,
        review: this.o.reviewThreshold ?? files.metadata.thresholds.review,
      };
      if (this.thresholds.review > this.thresholds.block) throw new Error(`invalid thresholds ${JSON.stringify(this.thresholds)}`);
      this.loadError = null;
      this.logger.info('moderation model loaded', { model: this.modelVersionLabel, variant: this.o.variant, sha256: files.sha256, thresholds: this.thresholds });
    } catch (error) {
      this.classifier = null;
      this.loadError = String(error instanceof Error ? error.message : error);
      this.logger.error('MODERATION DEGRADED: model failed to load, falling back to manual review', { model: this.modelVersionLabel, err: this.loadError });
      this.timer = setTimeout(() => void this.init(), this.o.retryMs);
      this.timer.unref();
    }
  }

  status(): ModerationStatus {
    return this.classifier
      ? { mode: 'onnx', state: 'READY', model: this.modelVersionLabel }
      : { mode: 'onnx', state: 'DEGRADED', model: this.modelVersionLabel, ...(this.loadError ? { detail: this.loadError } : {}) };
  }

  private manual(reason: string): ModerationVerdict {
    return { model: 'onnx-degraded-manual', modelVersion: this.modelVersionLabel, decision: 'REVIEW', labels: [`moderation:${reason}`], scores: {} };
  }

  private verdict(score: number, extra: Partial<ModerationVerdict> = {}): ModerationVerdict {
    const decision = decide(score, this.thresholds);
    return { model: this.o.modelName, modelVersion: this.modelVersionLabel, decision, labels: decision === 'ALLOW' ? [] : ['moderation:nsfw'], scores: { nsfw: Number(score.toFixed(6)) }, ...extra };
  }

  async moderate(input: { assetId: string; storageKey: string; mimeType: string; kind: 'IMAGE' | 'VIDEO' }): Promise<ModerationVerdict> {
    const classifier = this.classifier;
    if (!classifier) return this.manual('model_unavailable');
    const started = performance.now();
    try {
      const bytes = await this.storage.get(input.storageKey);
      const verdict = input.kind === 'IMAGE' ? this.verdict(await classifier.score(bytes)) : await this.moderateVideo(classifier, bytes);
      this.logger.info('asset moderated', { assetId: input.assetId, kind: input.kind, decision: verdict.decision, maxScore: verdict.scores.nsfw, ms: Math.round(performance.now() - started) });
      return verdict;
    } catch (error) {
      this.logger.warn('moderation failed for asset, sending to human review', { assetId: input.assetId, err: String(error) });
      return this.manual('analysis_error');
    }
  }

  private async moderateVideo(classifier: OnnxImageClassifier, bytes: Buffer): Promise<ModerationVerdict> {
    return this.frames.withVideo(bytes, async ({ durationSeconds, extractFrames }) => {
      if (durationSeconds > this.o.maxVideoSeconds + 0.5) return this.manual('video_too_long');
      const frames = await extractFrames();
      if (frames.length === 0) return this.manual('no_frames');
      const frameScores: number[] = [];
      for (const f of frames) frameScores.push(await classifier.score(f));
      const max = Math.max(...frameScores);
      const worst = frameScores.indexOf(max);
      const thumb = await this.bestThumbnail(frames, frameScores);
      return this.verdict(max, { frameScores: frameScores.map((s, index) => ({ index, timestampSeconds: index * this.o.frameIntervalSeconds, nsfw: Number(s.toFixed(6)) })), frameIndex: worst, thumbnailJpeg: thumb });
    });
  }

  /** Best frame = sharpest among those below the review threshold; if none is safe, the lowest-scoring frame blurred. */
  private async bestThumbnail(frames: Buffer[], scores: number[]): Promise<Buffer> {
    const safe = scores.map((s, i) => ({ s, i })).filter((x) => x.s < this.thresholds.review);
    if (safe.length === 0) {
      const lowest = scores.indexOf(Math.min(...scores));
      return sharp(frames[lowest]!).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).blur(20).jpeg({ quality: 70 }).toBuffer();
    }
    let best = safe[0]!.i;
    let bestSharp = -1;
    for (const { i } of safe) {
      const { sharpness } = await sharp(frames[i]!).stats();
      if (sharpness > bestSharp) [best, bestSharp] = [i, sharpness];
    }
    return sharp(frames[best]!).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  }
}
