import type * as OrtNs from 'onnxruntime-node';
import sharp from 'sharp';

import type { ModelMetadata } from './model-metadata';

type OrtModule = typeof OrtNs;
type Session = Awaited<ReturnType<OrtModule['InferenceSession']['create']>>;

/** One singleton ONNX session per model. Preprocessing is driven by `metadata.json` (ml-dl.md M4): stretch resize, RGB, (x/scale - mean)/std, NCHW. */
export class OnnxImageClassifier {
  private constructor(
    private readonly ort: OrtModule,
    private readonly session: Session,
    readonly meta: ModelMetadata,
  ) {}

  static async create(modelPath: string, meta: ModelMetadata, threads: number): Promise<OnnxImageClassifier> {
    const ort = await import('onnxruntime-node');
    const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'], intraOpNumThreads: threads, graphOptimizationLevel: 'all' });
    const c = new OnnxImageClassifier(ort, session, meta);
    await c.classifyTensor(new Float32Array(3 * meta.input.resize * meta.input.resize)); // warm-up (also validates the model end to end)
    return c;
  }

  /** Decodes (auto-rotating EXIF), drops alpha and builds the normalised NCHW tensor. */
  async preprocess(image: Buffer): Promise<Float32Array> {
    const { resize, mean, std, scale = 255 } = this.meta.input;
    const { data, info } = await sharp(image, { failOn: 'error' })
      .rotate()
      .removeAlpha()
      .toColourspace('srgb')
      .resize(resize, resize, { fit: 'fill', kernel: 'linear' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3 || info.width !== resize || info.height !== resize) throw new Error(`unexpected decoded shape ${info.width}x${info.height}x${info.channels}`);
    const plane = resize * resize;
    const out = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      for (let c = 0; c < 3; c++) out[c * plane + i] = ((data[i * 3 + c] ?? 0) / scale - (mean[c] ?? 0)) / (std[c] ?? 1);
    }
    return out;
  }

  /** Softmax probabilities in `meta.output.labels` order. */
  async classifyTensor(tensor: Float32Array): Promise<number[]> {
    const { name, resize } = this.meta.input;
    const result = await this.session.run({ [name]: new this.ort.Tensor('float32', tensor, [1, 3, resize, resize]) });
    const logits = Array.from(result[this.meta.output.name]!.data as Float32Array);
    const max = Math.max(...logits);
    const exps = logits.map((l) => Math.exp(l - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((e) => e / sum);
  }

  /** P(positive label), e.g. P(nsfw). */
  async score(image: Buffer): Promise<number> {
    const probs = await this.classifyTensor(await this.preprocess(image));
    return probs[this.meta.output.labels.indexOf(this.meta.output.positiveLabel)] ?? 0;
  }
}
