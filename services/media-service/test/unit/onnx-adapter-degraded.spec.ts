import { OnnxModerationAdapter } from '../../src/interface-adapters/gateways/moderation/onnx-moderation.adapter';
import { JsonLogger } from '../../src/interface-adapters/logger';

describe('OnnxModerationAdapter when the model cannot be loaded', () => {
  const lines: string[] = [];
  const logger = new JsonLogger('t', 'debug', (l) => lines.push(l));
  const registry = { load: () => Promise.reject(new Error('S3 down')) };
  const storage = { get: () => Promise.reject(new Error('must not be called')) };
  const adapter = new OnnxModerationAdapter(registry as never, storage as never, {} as never, { modelName: 'nsfw-classifier', modelVersion: '1.0.0', variant: 'fp32', threads: 1, maxVideoSeconds: 60, frameIntervalSeconds: 2, retryMs: 3_600_000 }, logger);

  afterAll(() => adapter.stop());

  it('degrades to manual review, reports DEGRADED and logs an error', async () => {
    await adapter.init();
    expect(adapter.status()).toMatchObject({ mode: 'onnx', state: 'DEGRADED', detail: 'S3 down' });
    const v = await adapter.moderate({ assetId: 'a', storageKey: 'k', mimeType: 'image/png', kind: 'IMAGE' });
    expect(v).toMatchObject({ decision: 'REVIEW', model: 'onnx-degraded-manual', modelVersion: 'nsfw-classifier@1.0.0' });
    expect(lines.some((l) => l.includes('"level":"error"') && l.includes('DEGRADED'))).toBe(true);
  });
});
