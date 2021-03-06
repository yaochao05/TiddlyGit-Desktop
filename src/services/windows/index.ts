/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { BrowserWindow, ipcMain, dialog, app, webFrame, clipboard, BrowserWindowConstructorOptions } from 'electron';
import isDevelopment from 'electron-is-dev';
import { injectable } from 'inversify';
import getDecorators from 'inversify-inject-decorators';
import { Menubar } from 'menubar';
import windowStateKeeper, { State as windowStateKeeperState } from 'electron-window-state';

import { IBrowserViewMetaData, WindowNames, windowDimension, WindowMeta } from '@services/windows/WindowProperties';
import serviceIdentifier from '@services/serviceIdentifier';

import type { IPreferenceService } from '@services/preferences/interface';
import type { IWorkspaceService } from '@services/workspaces/interface';
import type { IWorkspaceViewService } from '@services/workspacesView/interface';
import type { IMenuService } from '@services/menu/interface';
import { container } from '@services/container';
import { Channels, WindowChannel, MetaDataChannel, ViewChannel } from '@/constants/channels';

import i18n from '@services/libs/i18n';
import getViewBounds from '@services/libs/get-view-bounds';
import getFromRenderer from '@services/libs/getFromRenderer';
import handleAttachToMenuBar from './handleAttachToMenuBar';
import { IWindowService } from './interface';

const { lazyInject } = getDecorators(container);

@injectable()
export class Window implements IWindowService {
  private windows = {} as Partial<Record<WindowNames, BrowserWindow | undefined>>;
  private windowMeta = {} as Partial<WindowMeta>;
  private mainWindowMenuBar?: Menubar;

  @lazyInject(serviceIdentifier.Preference) private readonly preferenceService!: IPreferenceService;
  @lazyInject(serviceIdentifier.Workspace) private readonly workspaceService!: IWorkspaceService;
  @lazyInject(serviceIdentifier.WorkspaceView) private readonly workspaceViewService!: IWorkspaceViewService;
  @lazyInject(serviceIdentifier.MenuService) private readonly menuService!: IMenuService;

  constructor() {
    this.initIPCHandlers();
    this.registerMenu();
  }

  initIPCHandlers(): void {
    ipcMain.handle(WindowChannel.showDisplayMediaWindow, (_event: Electron.IpcMainInvokeEvent) => {
      const viewID = BrowserWindow.fromWebContents(_event.sender)?.id;
      if (viewID !== undefined) {
        return this.open(WindowNames.displayMedia, { displayMediaRequestedViewID: viewID }, (windowMeta: WindowMeta[WindowNames.displayMedia]) => {
          return viewID !== windowMeta.displayMediaRequestedViewID;
        });
      }
    });
  }

  public findInPage(text: string, forward?: boolean, windowName: WindowNames = WindowNames.main): void {
    const mainWindow = this.get(windowName);
    const contents = mainWindow?.getBrowserView()?.webContents;
    if (contents !== undefined) {
      contents.findInPage(text, {
        forward,
      });
    }
  }

  public stopFindInPage(close?: boolean, windowName: WindowNames = WindowNames.main): void {
    const mainWindow = this.get(windowName);
    const view = mainWindow?.getBrowserView();
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (view) {
      const contents = view.webContents;
      if (contents !== undefined) {
        contents.stopFindInPage('clearSelection');
        contents.send(ViewChannel.updateFindInPageMatches, 0, 0);
        // adjust bounds to hide the gap for find in page
        if (close === true && mainWindow !== undefined) {
          const contentSize = mainWindow.getContentSize();
          view.setBounds(getViewBounds(contentSize as [number, number]));
        }
      }
    }
  }

  public async requestShowRequireRestartDialog(): Promise<void> {
    const availableWindowToShowDialog = this.get(WindowNames.preferences) ?? this.get(WindowNames.main);
    if (availableWindowToShowDialog !== undefined) {
      await dialog
        .showMessageBox(availableWindowToShowDialog, {
          type: 'question',
          buttons: [i18n.t('Dialog.RestartNow'), i18n.t('Dialog.Later')],
          message: i18n.t('Dialog.RestartMessage'),
          cancelId: 1,
        })
        .then(({ response }) => {
          if (response === 0) {
            app.relaunch();
            app.quit();
          }
        })
        .catch(console.error);
    }
  }

  public get(windowName: WindowNames = WindowNames.main): BrowserWindow | undefined {
    return this.windows[windowName];
  }

  public close(name: WindowNames): void {
    this.get(name)?.close();
  }

  public async open<N extends WindowNames>(
    windowName: N,
    meta: WindowMeta[N] = {},
    recreate?: boolean | ((windowMeta: WindowMeta[N]) => boolean),
  ): Promise<void> {
    const existedWindow = this.get(windowName);
    // update window meta
    this.setWindowMeta(windowName, meta);
    const existedWindowMeta = this.getWindowMeta(windowName);
    const attachToMenubar: boolean = this.preferenceService.get('attachToMenubar');

    if (existedWindow !== undefined) {
      // TODO: handle this menubar logic
      if (attachToMenubar) {
        if (this.mainWindowMenuBar !== undefined) {
          this.mainWindowMenuBar.on('ready', () => {
            if (this.mainWindowMenuBar !== undefined) {
              void this.mainWindowMenuBar.showWindow();
            }
          });
        } else {
          // create window with menubar
        }
      }
      if (recreate === true || (typeof recreate === 'function' && existedWindowMeta !== undefined && recreate(existedWindowMeta))) {
        existedWindow.close();
      } else {
        return existedWindow.show();
      }
    }

    let mainWindowConfig: Partial<BrowserWindowConstructorOptions> = {};
    let mainWindowState: windowStateKeeperState | undefined;
    const isMainWindow = windowName === WindowNames.main;
    if (isMainWindow) {
      if (attachToMenubar) {
        this.mainWindowMenuBar = await handleAttachToMenuBar();
      }

      mainWindowState = windowStateKeeper({
        defaultWidth: windowDimension[WindowNames.main].width,
        defaultHeight: windowDimension[WindowNames.main].height,
      });
      mainWindowConfig = {
        x: mainWindowState.x,
        y: mainWindowState.y,
        width: mainWindowState.width,
        height: mainWindowState.height,
      };
    }

    const newWindow = new BrowserWindow({
      ...windowDimension[windowName],
      ...mainWindowConfig,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      autoHideMenuBar: false,
      webPreferences: {
        devTools: true,
        nodeIntegration: false,
        enableRemoteModule: true,
        webSecurity: !isDevelopment,
        contextIsolation: true,
        preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
        additionalArguments: [windowName, JSON.stringify(meta)],
      },
      parent: windowName === WindowNames.main || attachToMenubar ? undefined : this.get(WindowNames.main),
    });

    this.windows[windowName] = newWindow;
    if (isMainWindow) {
      mainWindowState?.manage(newWindow);
      this.registerMainWindowListeners(newWindow);
    } else {
      newWindow.setMenuBarVisibility(false);
    }
    newWindow.on('closed', () => {
      this.windows[windowName] = undefined;
    });
    await newWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
    if (isMainWindow) {
      // handle window show and Webview/browserView show
      return await new Promise<void>((resolve) => {
        newWindow.once('ready-to-show', () => {
          const mainWindow = this.get(WindowNames.main);
          if (mainWindow === undefined) return;
          const { wasOpenedAsHidden } = app.getLoginItemSettings();
          if (!wasOpenedAsHidden) {
            mainWindow.show();
          }
          // calling this to redundantly setBounds BrowserView
          // after the UI is fully loaded
          // if not, BrowserView mouseover event won't work correctly
          // https://github.com/atomery/webcatalog/issues/812
          this.workspaceViewService.realignActiveWorkspace();
          // ensure redux is loaded first
          // if not, redux might not be able catch changes sent from ipcMain
          mainWindow.webContents.once('did-stop-loading', () => {
            resolve();
          });
        });
      });
    }
  }

  private registerMainWindowListeners(newWindow: BrowserWindow): void {
    // Enable swipe to navigate
    const swipeToNavigate = this.preferenceService.get('swipeToNavigate');
    if (swipeToNavigate) {
      const mainWindow = this.get(WindowNames.main);
      if (mainWindow === undefined) return;
      mainWindow.on('swipe', (_event, direction) => {
        const view = mainWindow?.getBrowserView();
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        if (view) {
          if (direction === 'left') {
            view.webContents.goBack();
          } else if (direction === 'right') {
            view.webContents.goForward();
          }
        }
      });
    }

    // Hide window instead closing on macos
    newWindow.on('close', (event) => {
      const mainWindow = this.get(WindowNames.main);
      if (mainWindow === undefined) return;
      if (process.platform === 'darwin' && this.getWindowMeta(WindowNames.main)?.forceClose !== true) {
        event.preventDefault();
        // https://github.com/electron/electron/issues/6033#issuecomment-242023295
        if (mainWindow.isFullScreen()) {
          mainWindow.once('leave-full-screen', () => {
            const mainWindow = this.get(WindowNames.main);
            if (mainWindow !== undefined) {
              mainWindow.hide();
            }
          });
          mainWindow.setFullScreen(false);
        } else {
          mainWindow.hide();
        }
      }
    });

    newWindow.on('focus', () => {
      const mainWindow = this.get(WindowNames.main);
      if (mainWindow === undefined) return;
      const view = mainWindow?.getBrowserView();
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      view?.webContents?.focus();
    });

    newWindow.on('enter-full-screen', () => {
      const mainWindow = this.get(WindowNames.main);
      if (mainWindow === undefined) return;
      mainWindow?.webContents.send('is-fullscreen-updated', true);
      this.workspaceViewService.realignActiveWorkspace();
    });
    newWindow.on('leave-full-screen', () => {
      const mainWindow = this.get(WindowNames.main);
      if (mainWindow === undefined) return;
      mainWindow?.webContents.send('is-fullscreen-updated', false);
      this.workspaceViewService.realignActiveWorkspace();
    });
  }

  public isFullScreen(windowName = WindowNames.main): boolean | undefined {
    return this.windows[windowName]?.isFullScreen();
  }

  public setWindowMeta<N extends WindowNames>(windowName: N, meta: WindowMeta[N]): void {
    this.windowMeta[windowName] = meta;
  }

  public updateWindowMeta<N extends WindowNames>(windowName: N, meta: WindowMeta[N]): void {
    this.windowMeta[windowName] = { ...this.windowMeta[windowName], ...meta };
  }

  public getWindowMeta<N extends WindowNames>(windowName: N): WindowMeta[N] | undefined {
    return this.windowMeta[windowName];
  }

  /**
   * BroadCast message to all opened windows, so we can sync state to redux and make them take effect immediately
   * @param channel ipc channel to send
   * @param arguments_ any messages
   */
  public sendToAllWindows = (channel: Channels, ...arguments_: unknown[]): void => {
    const wins = BrowserWindow.getAllWindows();
    wins.forEach((win) => {
      win.webContents.send(channel, ...arguments_);
    });
  };

  public async goHome(windowName: WindowNames = WindowNames.main): Promise<void> {
    const win = this.get(windowName);
    const contents = win?.getBrowserView()?.webContents;
    const activeWorkspace = this.workspaceService.getActiveWorkspace();
    if (contents !== undefined && activeWorkspace !== undefined && win !== undefined) {
      await contents.loadURL(activeWorkspace.homeUrl);
      contents.send(WindowChannel.updateCanGoBack, contents.canGoBack());
      contents.send(WindowChannel.updateCanGoForward, contents.canGoForward());
    }
  }

  public goBack(windowName: WindowNames = WindowNames.main): void {
    const win = this.get(windowName);
    const contents = win?.getBrowserView()?.webContents;
    if (contents?.canGoBack() === true) {
      contents.goBack();
      contents.send(WindowChannel.updateCanGoBack, contents.canGoBack());
      contents.send(WindowChannel.updateCanGoForward, contents.canGoForward());
    }
  }

  public goForward(windowName: WindowNames = WindowNames.main): void {
    const win = this.get(windowName);
    const contents = win?.getBrowserView()?.webContents;
    if (contents?.canGoForward() === true) {
      contents.goForward();
      contents.send(WindowChannel.updateCanGoBack, contents.canGoBack());
      contents.send(WindowChannel.updateCanGoForward, contents.canGoForward());
    }
  }

  public reload(windowName: WindowNames = WindowNames.main): void {
    const win = this.get(windowName);
    win?.getBrowserView()?.webContents?.reload();
  }

  public async clearStorageData(windowName: WindowNames = WindowNames.main): Promise<void> {
    const win = this.get(windowName);
    await win?.getBrowserView()?.webContents?.session?.clearStorageData();
  }

  /**
   * an wrapper around setVisualZoomLevelLimits
   */
  public setVisualZoomLevelLimits(minimumLevel: number, maximumLevel: number): void {
    webFrame.setVisualZoomLevelLimits(minimumLevel, maximumLevel);
  }

  private registerMenu(): void {
    this.menuService.insertMenu(
      'window',
      [
        // `role: 'zoom'` is only supported on macOS
        process.platform === 'darwin'
          ? {
              role: 'zoom',
            }
          : {
              label: 'Zoom',
              click: () => {
                const mainWindow = this.get(WindowNames.main);
                if (mainWindow !== undefined) {
                  mainWindow.maximize();
                }
              },
            },
      ],
      'close',
    );

    this.menuService.insertMenu('Edit', [
      {
        label: 'Find',
        accelerator: 'CmdOrCtrl+F',
        click: () => {
          const mainWindow = this.get(WindowNames.main);
          if (mainWindow !== undefined) {
            mainWindow.webContents.focus();
            mainWindow.webContents.send('open-find-in-page');
            const contentSize = mainWindow.getContentSize();
            const view = mainWindow.getBrowserView();
            view?.setBounds(getViewBounds(contentSize as [number, number], true));
          }
        },
        enabled: () => this.workspaceService.countWorkspaces() > 0,
      },
      {
        label: 'Find Next',
        accelerator: 'CmdOrCtrl+G',
        click: () => {
          const mainWindow = this.get(WindowNames.main);
          mainWindow?.webContents?.send('request-back-find-in-page', true);
        },
        enabled: () => this.workspaceService.countWorkspaces() > 0,
      },
      {
        label: 'Find Previous',
        accelerator: 'Shift+CmdOrCtrl+G',
        click: () => {
          const mainWindow = this.get(WindowNames.main);
          mainWindow?.webContents?.send('request-back-find-in-page', false);
        },
        enabled: () => this.workspaceService.countWorkspaces() > 0,
      },
    ]);

    this.menuService.insertMenu('History', [
      {
        label: 'Home',
        accelerator: 'Shift+CmdOrCtrl+H',
        click: async () => await this.goHome(),
        enabled: () => this.workspaceService.countWorkspaces() > 0,
      },
      {
        label: 'Back',
        accelerator: 'CmdOrCtrl+[',
        click: async (_menuItem, browserWindow) => {
          // if back is called in popup window
          // navigate in the popup window instead
          if (browserWindow !== undefined) {
            // TODO: test if we really can get this isPopup value
            const { isPopup } = await getFromRenderer<IBrowserViewMetaData>(MetaDataChannel.getViewMetaData, browserWindow);
            if (isPopup === true) {
              browserWindow.webContents.goBack();
              return;
            }
          }
          ipcMain.emit('request-go-back');
        },
        enabled: () => this.workspaceService.countWorkspaces() > 0,
      },
      {
        label: 'Forward',
        accelerator: 'CmdOrCtrl+]',
        click: async (_menuItem, browserWindow) => {
          // if back is called in popup window
          // navigate in the popup window instead
          if (browserWindow !== undefined) {
            const { isPopup } = await getFromRenderer<IBrowserViewMetaData>(MetaDataChannel.getViewMetaData, browserWindow);
            if (isPopup === true) {
              browserWindow.webContents.goBack();
              return;
            }
          }
          ipcMain.emit('request-go-forward');
        },
        enabled: () => this.workspaceService.countWorkspaces() > 0,
      },
      { type: 'separator' },
      {
        label: 'Copy URL',
        accelerator: 'CmdOrCtrl+L',
        click: async (_menuItem, browserWindow) => {
          // if back is called in popup window
          // copy the popup window URL instead
          if (browserWindow !== undefined) {
            const { isPopup } = await getFromRenderer<IBrowserViewMetaData>(MetaDataChannel.getViewMetaData, browserWindow);
            if (isPopup === true) {
              const url = browserWindow.webContents.getURL();
              clipboard.writeText(url);
              return;
            }
          }
          const mainWindow = this.get(WindowNames.main);
          const url = mainWindow?.getBrowserView()?.webContents?.getURL();
          if (typeof url === 'string') {
            clipboard.writeText(url);
          }
        },
        enabled: () => this.workspaceService.countWorkspaces() > 0,
      },
    ]);

    if (process.platform === 'darwin') {
      // TODO: restore updater options here
      this.menuService.insertMenu('TiddlyGit', [
        {
          label: i18n.t('ContextMenu.About'),
          click: async () => await this.open(WindowNames.about),
        },
        { type: 'separator' },
        {
          label: i18n.t('ContextMenu.Preferences'),
          click: async () => await this.open(WindowNames.preferences),
          accelerator: 'CmdOrCtrl+,',
        },
        { type: 'separator' },
        {
          label: i18n.t('ContextMenu.Notifications'),
          click: async () => await this.open(WindowNames.notifications),
          accelerator: 'CmdOrCtrl+Shift+N',
        },
        { type: 'separator' },
        {
          label: i18n.t('Preference.ClearBrowsingData'),
          click: () => ipcMain.emit('request-clear-browsing-data'),
        },
        { type: 'separator' },
        { role: 'services', submenu: [] },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ]);
    }
  }
}
