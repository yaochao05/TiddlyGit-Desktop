import { ProxyPropertyType } from '@/helpers/electron-ipc-proxy/common';
import { ContextChannel } from '@/constants/channels';

export interface IPaths {
  REACT_PATH: string;
  TIDDLYWIKI_TEMPLATE_FOLDER_PATH: string;
  TIDDLERS_PATH: string;
  ICON_PATH: string;
  CHROME_ERROR_PATH: string;
  DESKTOP_PATH: string;
  LOG_FOLDER: string;
  LOCALIZATION_FOLDER: string;
}
/**
 * Available values about running environment
 */
export interface IConstants {
  isDevelopment: boolean;
  platform: string;
  appVersion: string;
  appName: string;
  oSVersion: string;
  environmentVersions: NodeJS.ProcessVersions;
}

export interface IContext extends IPaths, IConstants {}

/**
 * Manage constant value like `isDevelopment` and many else, so you can know about about running environment in main and renderer process easily.
 */
export interface IContextService {
  get<K extends keyof IContext>(key: K): IContext[K];
}
export const ContextServiceIPCDescriptor = {
  channel: ContextChannel.name,
  properties: {
    get: ProxyPropertyType.Function,
  },
};
