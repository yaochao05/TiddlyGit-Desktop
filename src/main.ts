import 'reflect-metadata';
import fs from 'fs';
import { delay } from 'bluebird';
import { ipcMain, nativeTheme, protocol, session, powerMonitor, app } from 'electron';
import isDev from 'electron-is-dev';
import settings from 'electron-settings';
import { autoUpdater } from 'electron-updater';

import { clearMainBindings, buildLanguageMenu } from '@services/libs/i18n/i18next-electron-fs-backend';
import { ThemeChannel } from '@/constants/channels';
import { container } from '@services/container';
import { logger } from '@services/libs/log';
import extractHostname from '@services/libs/extract-hostname';
import loadListeners from '@services/listeners';
import MAILTO_URLS from '@services/constants/mailto-urls';

import serviceIdentifier from '@services/serviceIdentifier';
import { Authentication } from '@services/auth';
import { Git } from '@services/git';
import { MenuService } from '@services/menu';
import { Notification } from '@services/notifications';
import { Preference } from '@services/preferences';
import { SystemPreference } from '@services/systemPreferences';
import { Updater } from '@services/updater';
import { View } from '@services/view';
import { Wiki } from '@services/wiki';
import { WikiGitWorkspace } from '@services/wikiGitWorkspace';
import { Window } from '@services/windows';
import { WindowNames } from '@services/windows/WindowProperties';
import { Workspace } from '@services/workspaces';
import { WorkspaceView } from '@services/workspacesView';

const gotTheLock = app.requestSingleInstanceLock();

container.bind<Authentication>(serviceIdentifier.Authentication).to(Authentication);
container.bind<Git>(serviceIdentifier.Git).to(Git);
container.bind<MenuService>(serviceIdentifier.View).to(MenuService);
container.bind<Notification>(serviceIdentifier.Notification).to(Notification);
container.bind<Preference>(serviceIdentifier.Preference).to(Preference);
container.bind<SystemPreference>(serviceIdentifier.SystemPreference).to(SystemPreference);
container.bind<Updater>(serviceIdentifier.Updater).to(Updater);
container.bind<View>(serviceIdentifier.View).to(View);
container.bind<Wiki>(serviceIdentifier.Wiki).to(Wiki);
container.bind<WikiGitWorkspace>(serviceIdentifier.WikiGitWorkspace).to(WikiGitWorkspace);
container.bind<Window>(serviceIdentifier.Window).to(Window);
container.bind<Workspace>(serviceIdentifier.Workspace).to(Workspace);
container.bind<WorkspaceView>(serviceIdentifier.WorkspaceView).to(WorkspaceView);
const authService = container.resolve(Authentication);
const gitService = container.resolve(Git);
const menuService = container.resolve(MenuService);
const preferenceService = container.resolve(Preference);
const viewService = container.resolve(View);
const wikiService = container.resolve(Wiki);
const windowService = container.resolve(Window);
const workspaceService = container.resolve(Workspace);
const workspaceViewService = container.resolve(WorkspaceView);

app.on('second-instance', () => {
  // Someone tried to run a second instance, we should focus our window.
  const mainWindow = windowService.get(WindowNames.main);
  if (mainWindow !== undefined) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
});
if (!gotTheLock) {
  logger.info('Quitting dut to we only allow one instance to run.');
  console.info('Quitting dut to we only allow one instance to run.');
  app.quit();
} else {
  // make sure "Settings" file exists
  // if not, ignore this chunk of code
  // as using electron-settings before app.on('ready') and "Settings" is created
  // would return error
  // https://github.com/nathanbuchar/electron-settings/issues/111
  if (fs.existsSync(settings.file())) {
    const useHardwareAcceleration = preferenceService.get('useHardwareAcceleration');
    if (!useHardwareAcceleration) {
      app.disableHardwareAcceleration();
    }
    const ignoreCertificateErrors = preferenceService.get('ignoreCertificateErrors');
    if (ignoreCertificateErrors) {
      // https://www.electronjs.org/docs/api/command-line-switches
      app.commandLine.appendSwitch('ignore-certificate-errors');
    }
  }
  let commonInitFinished = false;
  /** mock app.whenReady */
  const customCommonInitFinishedEvent = 'common-init-finished';
  ipcMain.once(customCommonInitFinishedEvent, () => {
    commonInitFinished = true;
  });
  /**
   * Make sure some logic only run after window and services are truly ready
   */
  const whenCommonInitFinished = async (): Promise<void> => {
    if (commonInitFinished) {
      return await Promise.resolve();
    }
    return await new Promise((resolve) => {
      ipcMain.once(customCommonInitFinishedEvent, () => {
        commonInitFinished = true;
        resolve();
      });
    });
  };
  protocol.registerSchemesAsPrivileged([
    { scheme: 'http', privileges: { standard: true } },
    { scheme: 'https', privileges: { standard: true } },
    { scheme: 'mailto', privileges: { standard: true } },
  ]);
  loadListeners();
  const commonInit = async (): Promise<void> => {
    // eslint-disable-next-line promise/catch-or-return
    return await app
      .whenReady()
      .then(
        () =>
          isDev &&
          protocol.registerFileProtocol('file', (request, callback) => {
            // TODO: this might be useless after use electron-forge, this is for loading html file after bundle, forge handle this now
            const pathname = decodeURIComponent(request.url.replace('file:///', ''));
            callback(pathname);
          }),
      )
      .then(async () => await windowService.open(WindowNames.main))
      .then(async () => {
        const { hibernateUnusedWorkspacesAtLaunch, proxyBypassRules, proxyPacScript, proxyRules, proxyType, themeSource } = preferenceService.getPreferences();
        // configure proxy for default session
        if (proxyType === 'rules') {
          await session.defaultSession.setProxy({
            proxyRules,
            proxyBypassRules,
          });
        } else if (proxyType === 'pacScript') {
          await session.defaultSession.setProxy({
            pacScript: proxyPacScript,
            proxyBypassRules,
          });
        }
        // apply theme
        nativeTheme.themeSource = themeSource;
        nativeTheme.addListener('updated', () => {
          windowService.sendToAllWindows(ThemeChannel.nativeThemeUpdated);
          viewService.reloadViewsDarkReader();
        });
        const workspaces = workspaceService.getWorkspaces();
        for (const workspaceID in workspaces) {
          const workspace = workspaces[workspaceID];
          // TODO: move this logic to service
          if ((hibernateUnusedWorkspacesAtLaunch || workspace.hibernateWhenUnused) && !workspace.active) {
            if (!workspace.hibernated) {
              await workspaceService.update(workspaceID, { hibernated: true });
            }
            return;
          }
          const mainWindow = windowService.get(WindowNames.main);
          if (mainWindow === undefined) return;
          await viewService.addView(mainWindow, workspace);
          try {
            const userInfo = authService.get('authing');
            const { name: wikiPath, gitUrl: githubRepoUrl, isSubWiki } = workspace;
            // wait for main wiki's watch-fs plugin to be fully initialized
            // and also wait for wiki BrowserView to be able to receive command
            // eslint-disable-next-line global-require
            let workspaceMetadata = workspaceService.getMetaData(workspaceID);
            if (!isSubWiki) {
              // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
              while (!workspaceMetadata.didFailLoadErrorMessage && !workspaceMetadata.isLoading) {
                // eslint-disable-next-line no-await-in-loop
                await delay(500);
                workspaceMetadata = workspaceService.getMetaData(workspaceID);
              }
            }
            // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
            if (!isSubWiki && !workspaceMetadata.didFailLoadErrorMessage?.length && userInfo) {
              await gitService.commitAndSync(wikiPath, githubRepoUrl, userInfo);
            }
          } catch {
            logger.warning(`Can't sync at wikiStartup()`);
          }
        }
        ipcMain.emit('request-update-pause-notifications-info');
      })
      .then(() => {
        // Fix webview is not resized automatically
        // when window is maximized on Linux
        // https://github.com/atomery/webcatalog/issues/561
        // run it here not in mainWindow.createAsync()
        // because if the `mainWindow` is maximized or minimized
        // before the workspaces's BrowserView fully loaded
        // error will occur
        // see https://github.com/atomery/webcatalog/issues/637
        // eslint-disable-next-line promise/always-return
        if (process.platform === 'linux') {
          const mainWindow = windowService.get(WindowNames.main);
          if (mainWindow !== undefined) {
            const handleMaximize = (): void => {
              // getContentSize is not updated immediately
              // try once after 0.2s (for fast computer), another one after 1s (to be sure)
              setTimeout(() => {
                workspaceViewService.realignActiveWorkspace();
              }, 200);
              setTimeout(() => {
                workspaceViewService.realignActiveWorkspace();
              }, 1000);
            };
            mainWindow.on('maximize', handleMaximize);
            mainWindow.on('unmaximize', handleMaximize);
          }
        }
      })
      // eslint-disable-next-line promise/always-return
      .then(() => {
        // trigger whenTrulyReady
        ipcMain.emit(customCommonInitFinishedEvent);
      })
      .then(() => {
        // build menu at last, this is not noticeable to user, so do it last
        buildLanguageMenu();
        menuService.buildMenu();
      });
  };
  app.on('ready', () => {
    autoUpdater.allowPrerelease = preferenceService.get('allowPrerelease');
    autoUpdater.logger = logger;
    whenCommonInitFinished()
      // eslint-disable-next-line promise/always-return
      .then(() => {
        ipcMain.emit('request-check-for-updates', undefined, true);
      })
      .catch((error) => console.error(error));
    powerMonitor.on('shutdown', () => {
      app.quit();
    });
    void commonInit();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
  app.on('activate', () => {
    const mainWindow = windowService.get(WindowNames.main);
    if (mainWindow === undefined) {
      void commonInit();
    } else {
      mainWindow.show();
    }
  });
  app.on(
    'open-url',
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    async (event, url): Promise<void> => {
      event.preventDefault();
      await whenCommonInitFinished();
      // focus on window
      const mainWindow = windowService.get(WindowNames.main);
      if (mainWindow === undefined) {
        await commonInit();
      } else {
        mainWindow.show();
      }
      if (workspaceService.countWorkspaces() === 0) {
        return;
      }
      // handle mailto:
      if (url.startsWith('mailto:')) {
        const mailtoWorkspaces = workspaceService.getWorkspacesAsList().filter((workspace) => {
          const hostName = extractHostname(workspace.homeUrl);
          return hostName !== undefined && hostName in MAILTO_URLS;
        });
        // pick automatically if there's only one choice
        if (mailtoWorkspaces.length === 0) {
          ipcMain.emit('request-show-message-box', undefined, 'None of your workspaces supports composing email messages.', 'error');
          return;
        }
        if (mailtoWorkspaces.length === 1) {
          const hostName = extractHostname(mailtoWorkspaces[0].homeUrl);
          if (hostName !== undefined) {
            const mailtoUrl = MAILTO_URLS[hostName];
            const u = mailtoUrl.replace('%s', url);
            ipcMain.emit('request-load-url', undefined, u, mailtoWorkspaces[0].id);
          }
          return;
        }
        return windowService.open(WindowNames.openUrlWith, { incomingUrl: url });
      }
      // handle https/http
      // pick automatically if there's only one choice
      if (workspaceService.countWorkspaces() === 1) {
        ipcMain.emit('request-load-url', undefined, url, workspaceService.getFirstWorkspace()!.id);
        return;
      }
      return windowService.open(WindowNames.openUrlWith, { incomingUrl: url });
    },
  );
  app.on(
    'before-quit',
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    async (): Promise<void> => {
      logger.info('Quitting worker threads and watcher.');
      await Promise.all([wikiService.stopAllWiki(), wikiService.stopWatchAllWiki()]);
      logger.info('Worker threads and watchers all terminated.');
      logger.info('Quitting I18N server.');
      clearMainBindings(ipcMain);
      logger.info('Quitted I18N server.');
      // https://github.com/atom/electron/issues/444#issuecomment-76492576
      if (process.platform === 'darwin') {
        const mainWindow = windowService.get(WindowNames.main);
        if (mainWindow !== undefined) {
          logger.info('App force quit on MacOS');
          windowService.updateWindowMeta(WindowNames.main, { forceClose: true });
        }
      }
      app.exit(0);
    },
  );
  app.on('quit', () => {
    logger.info('App quit');
  });
}