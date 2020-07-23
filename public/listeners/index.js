/* eslint-disable no-param-reassign */
const { BrowserView, Notification, app, dialog, ipcMain, nativeTheme, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fetch = require('node-fetch');

const { initWikiGit, getRemoteUrl } = require('../libs/git');
const { stopWatchWiki } = require('../libs/wiki/watch-wiki');
const { stopWiki } = require('../libs/wiki/wiki-worker-mamager');
const { logger } = require('../libs/log');
const { createWiki, createSubWiki, removeWiki, ensureWikiExist } = require('../libs/create-wiki');
const { ICON_PATH, REACT_PATH, DESKTOP_PATH } = require('../constants/paths');

const { getPreference, getPreferences, resetPreferences, setPreference } = require('../libs/preferences');

const { getSystemPreference, getSystemPreferences, setSystemPreference } = require('../libs/system-preferences');

const {
  countWorkspaces,
  getActiveWorkspace,
  getWorkspace,
  getWorkspaces,
  setWorkspacePicture,
  removeWorkspacePicture,
} = require('../libs/workspaces');

const { getWorkspaceMeta, getWorkspaceMetas } = require('../libs/workspace-metas');

const {
  clearBrowsingData,
  createWorkspaceView,
  hibernateWorkspaceView,
  loadURL,
  removeWorkspaceView,
  setActiveWorkspaceView,
  setWorkspaceView,
  setWorkspaceViews,
  wakeUpWorkspaceView,
} = require('../libs/workspaces-views');

const { reloadViewsDarkReader, reloadViewsWebContentsIfDidFailLoad } = require('../libs/views');

const { updatePauseNotificationsInfo, getPauseNotificationsInfo } = require('../libs/notifications');

const sendToAllWindows = require('../libs/send-to-all-windows');
const getWebsiteIconUrlAsync = require('../libs/get-website-icon-url-async');
const getViewBounds = require('../libs/get-view-bounds');

const createMenu = require('../libs/create-menu');

const aboutWindow = require('../windows/about');
const addWorkspaceWindow = require('../windows/add-workspace');
const codeInjectionWindow = require('../windows/code-injection');
const customUserAgentWindow = require('../windows/custom-user-agent');
const displayMediaWindow = require('../windows/display-media');
const editWorkspaceWindow = require('../windows/edit-workspace');
const mainWindow = require('../windows/main');
const notificationsWindow = require('../windows/notifications');
const preferencesWindow = require('../windows/preferences');
const proxyWindow = require('../windows/proxy');
const spellcheckLanguagesWindow = require('../windows/spellcheck-languages');

const loadListeners = () => {
  ipcMain.handle('copy-wiki-template', async (event, newFolderPath, folderName) => {
    try {
      await createWiki(newFolderPath, folderName, logger);
    } catch (error) {
      return String(error);
    }
  });
  ipcMain.handle('create-sub-wiki', async (event, newFolderPath, folderName, mainWikiToLink, onlyLink) => {
    try {
      await createSubWiki(newFolderPath, folderName, mainWikiToLink, onlyLink);
    } catch (error) {
      console.info(error);
      return String(error);
    }
  });
  ipcMain.handle('ensure-wiki-exist', async (event, wikiPath, shouldBeMainWiki) => {
    try {
      await ensureWikiExist(wikiPath, shouldBeMainWiki);
    } catch (error) {
      console.info(error);
      return String(error);
    }
  });
  ipcMain.on('get-constant', (event, name) => {
    event.returnValue = {
      ICON_PATH,
      REACT_PATH,
      DESKTOP_PATH,
    }[name];
  });
  ipcMain.handle('request-init-wiki-git', async (event, wikiFolderPath, githubRepoUrl, userInfo, isMainWiki) => {
    try {
      await initWikiGit(wikiFolderPath, githubRepoUrl, userInfo, isMainWiki);
    } catch (error) {
      console.info(error);
      removeWiki(wikiFolderPath);
      return String(error);
    }
  });

  ipcMain.on('request-open', (e, uri) => {
    shell.openExternal(uri);
  });

  // Find In Page
  ipcMain.on('request-find-in-page', (e, text, forward) => {
    const contents = mainWindow.get().getBrowserView().webContents;
    contents.findInPage(text, {
      forward,
    });
  });

  ipcMain.on('request-stop-find-in-page', (e, close) => {
    const win = mainWindow.get();
    const view = win.getBrowserView();
    const contents = view.webContents;
    contents.stopFindInPage('clearSelection');

    win.send('update-find-in-page-matches', 0, 0);

    // adjust bounds to hide the gap for find in page
    if (close) {
      const contentSize = win.getContentSize();
      view.setBounds(getViewBounds(contentSize));
    }
  });

  // System Preferences
  ipcMain.on('get-system-preference', (e, name) => {
    const val = getSystemPreference(name);
    e.returnValue = val;
  });

  ipcMain.on('get-system-preferences', e => {
    const preferences = getSystemPreferences();
    e.returnValue = preferences;
  });

  ipcMain.on('request-set-system-preference', (e, name, value) => {
    setSystemPreference(name, value);
  });

  // Preferences
  ipcMain.on('get-preference', (e, name) => {
    const val = getPreference(name);
    e.returnValue = val;
  });

  ipcMain.on('get-preferences', e => {
    const preferences = getPreferences();
    e.returnValue = preferences;
  });

  ipcMain.on('request-set-preference', (e, name, value) => {
    setPreference(name, value);
  });

  ipcMain.on('request-show-code-injection-window', (e, type) => {
    codeInjectionWindow.show(type);
  });

  ipcMain.on('request-show-custom-user-agent-window', () => {
    customUserAgentWindow.show();
  });

  ipcMain.on('request-reset-preferences', () => {
    dialog
      .showMessageBox(preferencesWindow.get(), {
        type: 'question',
        buttons: ['Reset Now', 'Cancel'],
        message:
          "Are you sure? All preferences will be restored to their original defaults. Browsing data won't be affected. This action cannot be undone.",
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          resetPreferences();
          ipcMain.emit('request-show-require-restart-dialog');
        }
      })
      .catch(console.log); // eslint-disable-line
  });

  ipcMain.on('request-show-about-window', () => {
    aboutWindow.show();
  });

  ipcMain.on('request-show-preferences-window', (e, scrollTo) => {
    preferencesWindow.show(scrollTo);
  });

  ipcMain.on('request-show-edit-workspace-window', (e, id) => {
    editWorkspaceWindow.show(id);
  });

  ipcMain.on('request-show-add-workspace-window', () => {
    addWorkspaceWindow.show();
  });

  ipcMain.on('request-show-notifications-window', () => {
    notificationsWindow.show();
  });

  ipcMain.on('request-show-proxy-window', () => {
    proxyWindow.show();
  });

  ipcMain.on('request-show-spellcheck-languages-window', () => {
    spellcheckLanguagesWindow.show();
  });

  ipcMain.on('request-show-require-restart-dialog', () => {
    dialog
      .showMessageBox(preferencesWindow.get() || mainWindow.get(), {
        type: 'question',
        buttons: ['Restart Now', 'Later'],
        message: 'You need to restart the app for this change to take affect.',
        cancelId: 1,
      })
      .then(({ response }) => {
        // eslint-disable-next-line promise/always-return
        if (response === 0) {
          app.relaunch();
          app.quit();
        }
      })
      .catch(console.log);
  });

  // Notifications
  ipcMain.on('request-show-notification', (e, opts) => {
    if (Notification.isSupported()) {
      const notif = new Notification(opts);
      notif.show();
    }
  });

  ipcMain.on('get-pause-notifications-info', e => {
    e.returnValue = getPauseNotificationsInfo();
  });

  ipcMain.on('request-update-pause-notifications-info', () => {
    updatePauseNotificationsInfo();
  });

  // Workspace Metas
  ipcMain.on('get-workspace-meta', (e, id) => {
    e.returnValue = getWorkspaceMeta(id);
  });

  ipcMain.on('get-workspace-metas', e => {
    e.returnValue = getWorkspaceMetas();
  });

  // Workspaces
  ipcMain.on('count-workspace', e => {
    e.returnValue = countWorkspaces();
  });

  ipcMain.on('get-workspace', (e, id) => {
    const val = getWorkspace(id);
    e.returnValue = val;
  });

  ipcMain.on('get-workspaces', e => {
    const workspaces = getWorkspaces();
    e.returnValue = workspaces;
  });

  ipcMain.handle('get-workspaces-remote', async (event, wikiFolderPath) => {
    const url = await getRemoteUrl(wikiFolderPath);
    return url;
  });

  ipcMain.handle(
    'request-create-workspace',
    (event, name, isSubWiki, mainWikiToLink, port, homeUrl, gitUrl, picture, transparentBackground) => {
      createWorkspaceView(name, isSubWiki, mainWikiToLink, port, homeUrl, gitUrl, picture, transparentBackground);
      createMenu();
    },
  );
  ipcMain.handle('request-wait-for-wiki-start', async (event, port, timeoutLimit) => {
    const timeStart = Date.now();
    while (Date.now() < timeStart + timeoutLimit) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await fetch(`http://127.0.0.1:${port}`);
      } catch {
        console.log('request-wait-for-wiki-start Still waiting for wiki to start');
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  });

  ipcMain.on('request-set-active-workspace', (e, id) => {
    if (getWorkspace(id)) {
      setActiveWorkspaceView(id);
      createMenu();
    }
  });

  ipcMain.on('request-realign-active-workspace', () => {
    const { sidebar, titleBar, navigationBar } = getPreferences();

    global.sidebar = sidebar;
    global.titleBar = titleBar;
    global.navigationBar = navigationBar;

    const activeWorkspace = getActiveWorkspace();
    if (activeWorkspace) {
      setActiveWorkspaceView(activeWorkspace.id);
    }
    createMenu();
  });

  ipcMain.on('request-open-url-in-workspace', (e, url, id) => {
    if (id) {
      // if id is defined, switch to that workspace
      setActiveWorkspaceView(id);
      createMenu();

      // load url in the current workspace
      const activeWorkspace = getActiveWorkspace();
      loadURL(url, activeWorkspace.id);
    }
  });

  ipcMain.on('request-wake-up-workspace', (e, id) => {
    wakeUpWorkspaceView(id);
  });

  ipcMain.on('request-hibernate-workspace', (e, id) => {
    hibernateWorkspaceView(id);
  });

  ipcMain.on('request-remove-workspace', (e, id) => {
    // eslint-disable-next-line promise/catch-or-return
    dialog
      .showMessageBox(mainWindow.get(), {
        type: 'question',
        buttons: ['仅移除工作区', '移除工作区并删除Wiki文件夹', '取消'],
        message:
          '你确定要移除这个工作区吗？移除工作区会删除本应用中的工作区，但不会删除硬盘上的文件夹。如果你选择一并删除Wiki文件夹，则所有内容都会被被删除。',
        cancelId: 1,
      })
      .then(async ({ response }) => {
        // eslint-disable-next-line promise/always-return
        try {
          if (response === 0 || response === 1) {
            const workspace = getWorkspace(id);
            await stopWatchWiki(workspace.name).catch(error => logger.error(error.message, error));
            await stopWiki(workspace.name).catch(error => logger.error(error.message, error));
            if (response === 1) {
              await removeWiki(workspace.name, workspace.isSubWiki && workspace.mainWikiToLink);
            }
            removeWorkspaceView(id);
            createMenu();
          }
        } catch (error) {
          logger.error(error.message, error);
        }
      });
  });

  ipcMain.on('request-set-workspace', (e, id, opts) => {
    setWorkspaceView(id, opts);
    createMenu();
  });

  ipcMain.on('request-set-workspaces', (e, workspaces) => {
    setWorkspaceViews(workspaces);
    createMenu();
  });

  ipcMain.on('request-set-workspace-picture', (e, id, picturePath) => {
    setWorkspacePicture(id, picturePath);
  });

  ipcMain.on('request-remove-workspace-picture', (e, id) => {
    removeWorkspacePicture(id);
  });

  ipcMain.on('request-clear-browsing-data', () => {
    dialog
      .showMessageBox(preferencesWindow.get() || mainWindow.get(), {
        type: 'question',
        buttons: ['Clear Now', 'Cancel'],
        message: 'Are you sure? All browsing data will be cleared. This action cannot be undone.',
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          clearBrowsingData();
        }
      })
      .catch(console.log); // eslint-disable-line
  });

  ipcMain.on('request-load-url', (e, url, id) => {
    loadURL(url, id);
  });

  ipcMain.on('request-go-home', () => {
    const win = mainWindow.get();

    if (win != null && win.getBrowserView() != null) {
      const contents = win.getBrowserView().webContents;
      const activeWorkspace = getActiveWorkspace();
      contents.loadURL(activeWorkspace.homeUrl);
      win.send('update-can-go-back', contents.canGoBack());
      win.send('update-can-go-forward', contents.canGoForward());
    }
  });

  ipcMain.on('request-go-back', () => {
    const win = mainWindow.get();

    if (win != null && win.getBrowserView() != null) {
      const contents = win.getBrowserView().webContents;
      if (contents.canGoBack()) {
        contents.goBack();
        win.send('update-can-go-back', contents.canGoBack());
        win.send('update-can-go-forward', contents.canGoForward());
      }
    }
  });

  ipcMain.on('request-go-forward', () => {
    const win = mainWindow.get();

    if (win != null && win.getBrowserView() != null) {
      const contents = win.getBrowserView().webContents;
      if (contents.canGoForward()) {
        contents.goForward();
        win.send('update-can-go-back', contents.canGoBack());
        win.send('update-can-go-forward', contents.canGoForward());
      }
    }
  });

  ipcMain.on('request-reload', () => {
    const win = mainWindow.get();

    if (win != null) {
      win.getBrowserView().webContents.reload();
    }
  });

  ipcMain.on('request-show-message-box', (e, message, type) => {
    dialog
      .showMessageBox(mainWindow.get(), {
        type: type || 'error',
        message,
        buttons: ['OK'],
        cancelId: 0,
        defaultId: 0,
      })
      .catch(console.log); // eslint-disable-line
  });

  ipcMain.on('create-menu', () => {
    createMenu();
  });

  ipcMain.on('request-show-display-media-window', e => {
    const viewId = BrowserView.fromWebContents(e.sender).id;
    displayMediaWindow.show(viewId);
  });

  ipcMain.on('request-quit', () => {
    app.quit();
  });

  ipcMain.on('request-check-for-updates', (e, isSilent) => {
    // https://github.com/electron-userland/electron-builder/issues/4028
    if (!autoUpdater.isUpdaterActive()) return;

    // https://github.com/atomery/webcatalog/issues/634
    // https://github.com/electron-userland/electron-builder/issues/4046
    // disable updater if user is using AppImageLauncher
    if (process.platform === 'linux' && process.env.DESKTOPINTEGRATION === 'AppImageLauncher') {
      dialog
        .showMessageBox(mainWindow.get(), {
          type: 'error',
          message:
            'Updater is incompatible with AppImageLauncher. Please uninstall AppImageLauncher or download new updates manually from our website.',
          buttons: ['Learn More', 'Go to Website', 'OK'],
          cancelId: 2,
          defaultId: 2,
        })
        .then(({ response }) => {
          if (response === 0) {
            shell.openExternal('https://github.com/electron-userland/electron-builder/issues/4046');
          } else if (response === 1) {
            shell.openExternal('http://singleboxapp.com/');
          }
        })
        .catch(console.log); // eslint-disable-line
      return;
    }

    // restart & apply updates
    if (global.updaterObj && global.updaterObj.status === 'update-downloaded') {
      setImmediate(() => {
        app.removeAllListeners('window-all-closed');
        if (mainWindow.get() != null) {
          mainWindow.get().forceClose = true;
          mainWindow.get().close();
        }
        autoUpdater.quitAndInstall(false);
      });
    }

    // check for updates
    global.updateSilent = Boolean(isSilent);
    autoUpdater.checkForUpdates();
  });

  // to be replaced with invoke (electron 7+)
  // https://electronjs.org/docs/api/ipc-renderer#ipcrendererinvokechannel-args
  ipcMain.on('request-get-website-icon-url', (e, id, url) => {
    getWebsiteIconUrlAsync(url)
      .then(iconUrl => {
        sendToAllWindows(id, iconUrl);
      })
      .catch(err => {
        console.log(err); // eslint-disable-line no-console
        sendToAllWindows(id, null);
      });
  });

  // Native Theme
  ipcMain.on('get-should-use-dark-colors', e => {
    e.returnValue = nativeTheme.shouldUseDarkColors;
  });

  ipcMain.on('request-reload-views-dark-reader', () => {
    reloadViewsDarkReader();
  });

  // if global.forceNewWindow = true
  // the next external link request will be opened in new window
  ipcMain.on('request-set-global-force-new-window', (e, val) => {
    global.forceNewWindow = val;
  });

  // https://www.electronjs.org/docs/tutorial/online-offline-events
  ipcMain.on('online-status-changed', (e, online) => {
    if (online) {
      reloadViewsWebContentsIfDidFailLoad();
    }
  });
};

module.exports = loadListeners;
