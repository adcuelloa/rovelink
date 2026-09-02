import { EN_CONCEPTS, EN_UI } from './en.ts';
import { ES_CONCEPTS, ES_UI } from './es.ts';
import type { ConceptCopy, UiStrings } from './types.ts';

export * from './types.ts';
export { EN_CONCEPTS, EN_UI } from './en.ts';
export { ES_CONCEPTS, ES_UI } from './es.ts';

export type Locale = 'en' | 'es';
export const LOCALES: readonly Locale[] = ['en', 'es'];

const CONCEPTS_BY_LOCALE: Record<Locale, Record<string, ConceptCopy>> = {
  en: EN_CONCEPTS,
  es: ES_CONCEPTS,
};

const UI_BY_LOCALE: Record<Locale, UiStrings> = {
  en: EN_UI,
  es: ES_UI,
};

export function conceptCopy(locale: Locale, id: string): ConceptCopy {
  const copy = CONCEPTS_BY_LOCALE[locale][id];
  if (copy === undefined) throw new Error(`missing ${locale} copy for concept "${id}"`);
  return copy;
}

export function uiStrings(locale: Locale): UiStrings {
  return UI_BY_LOCALE[locale];
}
