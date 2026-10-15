import { matchesDeclaredMime } from '../../src/entities/magic-bytes';

const bytes = (...v: number[]): Uint8Array => Uint8Array.from([...v, ...new Array(32 - v.length).fill(0)]);
const text = (offset: number, s: string, base: number[] = []): Uint8Array => {
  const b = new Uint8Array(32);
  b.set(base);
  b.set([...s].map((c) => c.charCodeAt(0)), offset);
  return b;
};

describe('matchesDeclaredMime (magic bytes)', () => {
  const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0);
  const webp = text(8, 'WEBP', [...'RIFF'].map((c) => c.charCodeAt(0)));
  const gif = text(0, 'GIF89a');
  const heic = text(4, 'ftypheic');
  const mp4 = text(4, 'ftypisom');
  const mov = text(4, 'ftypqt  ');

  it.each([
    ['image/png', png],
    ['image/jpeg', jpeg],
    ['image/webp', webp],
    ['image/gif', gif],
    ['image/heic', heic],
    ['video/mp4', mp4],
    ['video/quicktime', mov],
  ])('accepts a real %s', (mime, head) => expect(matchesDeclaredMime(head, mime)).toBe(true));

  it.each([
    ['image/png', jpeg],
    ['image/jpeg', png],
    ['image/webp', png],
    ['image/gif', png],
    ['image/heic', mp4],
    ['video/mp4', mov],
    ['video/mp4', png],
    ['video/quicktime', jpeg],
    ['image/png', new Uint8Array(32)],
    ['image/png', new TextEncoder().encode('<html><script>alert(1)</script>')],
  ])('rejects %s with foreign bytes', (mime, head) => expect(matchesDeclaredMime(head, mime)).toBe(false));

  it('accepts a quicktime file starting with moov/mdat atoms', () => expect(matchesDeclaredMime(text(4, 'moov'), 'video/quicktime')).toBe(true));
  it('does not decide for types it does not know', () => expect(matchesDeclaredMime(new Uint8Array(32), 'application/pdf')).toBe(true));
});
