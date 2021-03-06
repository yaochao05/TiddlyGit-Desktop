import { app, dialog, shell, MessageBoxOptions } from 'electron';
import { injectable, inject } from 'inversify';

import type { IWindowService } from '@services/windows/interface';
import { WindowNames } from '@services/windows/WindowProperties';
import { INativeService } from './interface';
import serviceIdentifier from '@services/serviceIdentifier';

@injectable()
export class NativeService implements INativeService {
  constructor(@inject(serviceIdentifier.Window) private readonly windowService: IWindowService) {}

  public async showElectronMessageBox(message: string, type: MessageBoxOptions['type'] = 'info', windowName = WindowNames.main): Promise<void> {
    const window = this.windowService.get(windowName);
    if (window !== undefined) {
      await dialog.showMessageBox(window, { message, type });
    }
  }

  public async open(uri: string, isDirectory = false): Promise<void> {
    return isDirectory ? shell.showItemInFolder(uri) : await shell.openExternal(uri);
  }

  public quit(): void {
    app.quit();
  }
}
