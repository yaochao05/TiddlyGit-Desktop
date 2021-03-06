import path from 'path';
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import isDevelopment from 'electron-is-dev';

import { LOCALIZATION_FOLDER } from '@services/constants/paths';
import bindI18nListener from './bindI18nListener';
import changeToDefaultLanguage from './useDefaultLanguage';

// init i18n is async, but our usage is basically await the electron app to start, so this is basically ok
void i18next.use(Backend).init({
  backend: {
    loadPath: path.join(LOCALIZATION_FOLDER, 'locales/{{lng}}/{{ns}}.json'),
    addPath: path.join(LOCALIZATION_FOLDER, 'locales/{{lng}}/{{ns}}.missing.json'),
  },

  debug: false,
  interpolation: { escapeValue: false },
  saveMissing: isDevelopment,
  saveMissingTo: 'current',
  // namespace: 'translation',
  lng: 'zh_CN',
  fallbackLng: isDevelopment ? false : 'en', // set to false when generating translation files locally
});

export async function initI18NAfterServiceReady(): Promise<void> {
  await bindI18nListener();
  await changeToDefaultLanguage(i18next);
}

export default i18next;
