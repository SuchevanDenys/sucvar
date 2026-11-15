// app/lib/theme/usePrefs.ts
// Single source of truth for UI language + theme (persisted in localStorage).
// Backed by useStoredValue (useSyncExternalStore): every component that calls usePrefs() stays in
// sync, and no setState-in-effect is needed to restore the saved values.
// Language: French by default (Paris & Île-de-France market); EN and RO stay one click away.
"use client";

import { useCallback, useEffect, useMemo } from 'react';
import { STORAGE_KEYS, writeStorage } from '@/app/lib/storage';
import { useStoredValue } from '@/app/lib/useStoredValue';
import { DEFAULT_LANGUAGE, HTML_LANG, isLanguage, makeT, type Translate } from '@/app/lib/i18n';
import type { Language, ThemeMode } from '@/app/types';

export interface Prefs {
  lang: Language;
  theme: ThemeMode;
  isDark: boolean;
  /** true only for Romanian (kept for older call sites) */
  isRo: boolean;
  isFr: boolean;
  /** `t(ro, en, fr?)` bound to the current language */
  t: Translate;
  setLang: (next: Language) => void;
  setTheme: (next: ThemeMode) => void;
}

export function usePrefs(): Prefs {
  const theme: ThemeMode = useStoredValue(STORAGE_KEYS.theme) === 'dark' ? 'dark' : 'light'; // light gallery = default
  const stored = useStoredValue(STORAGE_KEYS.lang);
  const lang: Language = isLanguage(stored) ? stored : DEFAULT_LANGUAGE;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = HTML_LANG[lang];
  }, [lang]);

  const setLang = useCallback((next: Language) => {
    writeStorage(STORAGE_KEYS.lang, next);
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    writeStorage(STORAGE_KEYS.theme, next);
  }, []);

  const t = useMemo(() => makeT(lang), [lang]);

  return { lang, theme, isDark: theme === 'dark', isRo: lang === 'ro', isFr: lang === 'fr', t, setLang, setTheme };
}
