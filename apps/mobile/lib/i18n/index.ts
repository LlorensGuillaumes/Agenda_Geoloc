// Polyfill: Hermes en algunas versiones de RN no incluye Intl.PluralRules,
// que i18next usa para resolver claves con plurales. Tiene que importarse
// ANTES de i18next.
import 'intl-pluralrules';

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import en from './locales/en.json';
import es from './locales/es.json';
import ca from './locales/ca.json';

const supportedLanguages = ['es', 'en', 'ca'] as const;
type SupportedLanguage = (typeof supportedLanguages)[number];

function detectLanguage(): SupportedLanguage {
  const locales = getLocales();
  for (const locale of locales) {
    const code = locale.languageCode?.toLowerCase();
    if (code && (supportedLanguages as readonly string[]).includes(code)) {
      return code as SupportedLanguage;
    }
  }
  return 'es';
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    ca: { translation: ca },
  },
  lng: detectLanguage(),
  fallbackLng: 'es',
  interpolation: { escapeValue: false },
  compatibilityJSON: 'v4',
});

export default i18n;
export { supportedLanguages };
export type { SupportedLanguage };
