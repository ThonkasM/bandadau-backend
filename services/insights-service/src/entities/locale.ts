export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const isLocale = (v: unknown): v is Locale => v === 'es' || v === 'en';
