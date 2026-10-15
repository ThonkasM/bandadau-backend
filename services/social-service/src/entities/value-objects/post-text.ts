import { DomainError } from '../errors/domain-error';

export const POST_TEXT_MAX = 2000;
export const MAX_HASHTAGS = 10;

const HASHTAG = /(?<![\p{L}\p{N}_#])#([\p{L}\p{N}_]{2,50})(?![\p{L}\p{N}_])/gu;

/** Hashtags (RN-05.3): `#` + 2-50 letters/digits/underscore, lowercase, unique, at most 10. */
export function extractHashtags(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(HASHTAG)) {
    const tag = (match[1] ?? '').toLowerCase();
    if (tag && !found.includes(tag)) found.push(tag);
    if (found.length === MAX_HASHTAGS) break;
  }
  return found;
}

export function normalizePostText(text: string, hasMedia: boolean): string {
  const value = text.trim();
  if (value.length > POST_TEXT_MAX) throw new DomainError('VALIDATION_FAILED', { field: 'text', code: 'TOO_LONG' });
  if (value.length === 0 && !hasMedia) throw new DomainError('EMPTY_POST');
  return value;
}
