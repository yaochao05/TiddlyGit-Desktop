import { contextBridge, ipcRenderer } from 'electron';
import { preloadBindings } from '@services/libs/i18n/preloadBindings';

const i18n = {
  i18nextElectronBackend: preloadBindings(ipcRenderer),
};
contextBridge.exposeInMainWorld('i18n', i18n);
declare global {
  interface Window {
    i18n: typeof i18n;
  }
}
