/**
 * Provide API from electron to tiddlywiki
 * This file should be required by BrowserView's preload script to work
 */
import { contextBridge } from 'electron';

import { container } from '@services/container';
import { getModifiedFileList } from '@services/git/inspect';
import type { IGitService } from '@services/git';
import type { IWorkspaceService } from '@services/workspaces';
import type { IAuthenticationService } from '@services/auth';
import serviceIdentifier from '@services/serviceIdentifier';

contextBridge.exposeInMainWorld('git', {
  getModifiedFileList,
  commitAndSync: (wikiPath: string, githubRepoUrl: string) => {
    const gitService = container.get<IGitService>(serviceIdentifier.Git);
    const authService = container.get<IAuthenticationService>(serviceIdentifier.Authentication);
    const userInfo = authService.get('authing');
    if (userInfo !== undefined) {
      return gitService.commitAndSync(wikiPath, githubRepoUrl, userInfo);
    }
  },
  getWorkspacesAsList: () => {
    const workspaceService = container.get<IWorkspaceService>(serviceIdentifier.Workspace);
    return workspaceService.getWorkspacesAsList();
  },
});
