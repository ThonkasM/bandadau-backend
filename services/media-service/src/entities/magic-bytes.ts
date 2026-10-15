/** Number of leading bytes needed to recognise every supported format. */
export const MAGIC_BYTES_LENGTH = 32;

const startsWith = (b: Uint8Array, sig: readonly number[], offset = 0): boolean => sig.every((v, i) => b[offset + i] === v);
const ascii = (b: Uint8Array, offset: number, length: number): string => String.fromCharCode(...b.subarray(offset, offset + length));

const ISO_BMFF_BRANDS_HEIC = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);
const ISO_BMFF_BRANDS_QUICKTIME = new Set(['qt  ']);

/** True when the leading bytes of an object are coherent with the declared MIME type (pure: no I/O, no framework). */
export function matchesDeclaredMime(head: Uint8Array, mimeType: string): boolean {
  switch (mimeType) {
    case 'image/png':
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case 'image/webp':
      return ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP';
    case 'image/gif':
      return ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a';
    case 'image/heic':
      return ascii(head, 4, 4) === 'ftyp' && ISO_BMFF_BRANDS_HEIC.has(ascii(head, 8, 4));
    case 'video/mp4':
      // ISO-BMFF: `ftyp` box at offset 4; any brand except HEIC/QuickTime ones (isom, mp42, avc1, M4V, ...).
      return ascii(head, 4, 4) === 'ftyp' && !ISO_BMFF_BRANDS_HEIC.has(ascii(head, 8, 4)) && !ISO_BMFF_BRANDS_QUICKTIME.has(ascii(head, 8, 4));
    case 'video/quicktime':
      // .mov normally has brand `qt  `, but some muxers write `ftyp` + mp4 brands or start with `moov`/`mdat`/`wide`/`free`.
      return (ascii(head, 4, 4) === 'ftyp' && !ISO_BMFF_BRANDS_HEIC.has(ascii(head, 8, 4))) || ['moov', 'mdat', 'wide', 'free', 'skip'].includes(ascii(head, 4, 4));
    default:
      // Unknown to the verifier: other layers (UNSUPPORTED_MEDIA_TYPE) decide; do not block here.
      return true;
  }
}
