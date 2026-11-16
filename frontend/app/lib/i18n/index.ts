// app/lib/i18n/index.ts
// Trilingual UI: RO (default, Romanian market) · EN · FR.
//
// Every UI string is written once per language at its call site: `tr(lang, ro, en, fr?)`.
// When the French text is not passed explicitly, it comes from the FR dictionary keyed by the English
// source string (gettext-style), so data tables with `xxRo / xxEn` fields and the API's `titleEn` values
// are localised without duplicating every record. Missing entries fall back to English.
import type { Language } from '@/app/types';
import { FR } from './fr';
import { frenchByPattern } from './patterns';

export const LANGUAGES: readonly Language[] = ['ro', 'en', 'fr'] as const;
export const DEFAULT_LANGUAGE: Language = 'ro';

export const LANGUAGE_LABELS: Record<Language, string> = { ro: 'RO', en: 'EN', fr: 'FR' };

/** BCP-47 locale per language (numbers, dates, money). */
export const LOCALES: Record<Language, string> = { fr: 'fr-FR', en: 'en-GB', ro: 'ro-RO' };

/** OpenGraph / html lang. */
export const HTML_LANG: Record<Language, string> = { fr: 'fr', en: 'en', ro: 'ro' };

export function isLanguage(v: unknown): v is Language {
  return v === 'fr' || v === 'en' || v === 'ro';
}

/** French text for an English source string (undefined when the dictionary has no entry). */
export function frenchOf(en: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(FR, en)) return FR[en];
  return frenchByPattern(en, frenchOf);
}

/**
 * Picks the text for `lang`. Works with strings and any other value (arrays, React nodes):
 * for non-string values without an explicit `fr`, French falls back to the English value.
 */
export function tr<T>(lang: Language, ro: T, en: T, fr?: T): T {
  if (lang === 'ro') return ro;
  if (lang === 'en') return en;
  if (fr !== undefined) return fr;
  if (typeof en === 'string') return (frenchOf(en) ?? en) as T;
  return en;
}

export type Translate = (ro: string, en: string, fr?: string) => string;

/** Local `t(ro, en, fr?)` bound to a language. */
export function makeT(lang: Language): Translate {
  return (ro, en, fr) => tr(lang, ro, en, fr);
}

/** Localised short date (`15 nov. 2026` in FR); `—` when absent, the raw text when unparseable (legacy rows). */
export function formatDate(iso: string | null | undefined, lang: Language, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(LOCALES[lang], opts ?? { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Display unit for BOM / quote lines (data keeps the historical `buc.`). */
export function unitLabel(unit: string, lang: Language): string {
  if (unit === 'buc.') return tr(lang, 'buc.', 'pcs', 'u.');
  if (unit === 'punct') return tr(lang, 'punct', 'point', 'point');
  return unit;
}

/** Lists (plan features, loading steps): French items come from the dictionary, item by item. */
export function trList(lang: Language, ro: readonly string[], en: readonly string[], fr?: readonly string[]): string[] {
  if (lang === 'ro') return [...ro];
  if (lang === 'en') return [...en];
  if (fr) return [...fr];
  return en.map((e) => frenchOf(e) ?? e);
}
