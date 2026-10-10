/**
 * The app language.
 *
 * Before sign-in the device language decides; once the profile loads, the account's
 * own setting wins (see `useSyncLanguage` in app/(tabs)/_layout.tsx), because the
 * server writes the reminder pushes in that language too and the two must agree.
 */

import { create } from 'zustand';

import { STRINGS, type Strings } from './strings';

export type Lang = keyof typeof STRINGS;

/** The server's Locale enum. */
export type ServerLocale = 'TR' | 'EN';

export const toServerLocale = (lang: Lang): ServerLocale => (lang === 'en' ? 'EN' : 'TR');
export const fromServerLocale = (locale: ServerLocale): Lang => (locale === 'EN' ? 'en' : 'tr');

/** Turkish for a Turkish device, English for everything else. */
function deviceLanguage(): Lang {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
    return locale.startsWith('tr') ? 'tr' : 'en';
  } catch {
    return 'tr';
  }
}

interface LanguageState {
  readonly lang: Lang;
  readonly setLang: (lang: Lang) => void;
}

export const useLanguage = create<LanguageState>((set) => ({
  lang: deviceLanguage(),
  setLang: (lang) => set({ lang }),
}));

/** The strings for the current language. */
export function useT(): Strings {
  return STRINGS[useLanguage((state) => state.lang)];
}

/** A date in the current language's conventions. */
export function formatDate(value: string | Date, lang: Lang): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleDateString(lang === 'en' ? 'en-GB' : 'tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export type { Strings };
