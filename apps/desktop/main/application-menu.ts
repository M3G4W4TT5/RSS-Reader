import {Menu, type BrowserWindow, type MenuItemConstructorOptions} from 'electron';
import {ipcChannels, type AppCommand} from '@rss-reader/contracts';

export function installApplicationMenu(mainWindow: BrowserWindow): void {
    const send = (command: AppCommand): void => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send(ipcChannels.appCommand, command);
    };
    const template: MenuItemConstructorOptions[] = [
        {
            label: 'File',
            submenu: [
                {label: 'Add Source…', accelerator: 'CmdOrCtrl+N', click: () => send('add-source')},
                {label: 'Import Sources…', accelerator: 'CmdOrCtrl+Shift+I', click: () => send('import-sources')},
                {label: 'Update Sources', accelerator: 'CmdOrCtrl+R', click: () => send('fetch-all')},
                {type: 'separator'},
                {role: 'quit'},
            ],
        },
        {
            label: 'Item',
            submenu: [
                {label: 'Previous Item', accelerator: 'CmdOrCtrl+Up', click: () => send('previous-item')},
                {label: 'Next Item', accelerator: 'CmdOrCtrl+Down', click: () => send('next-item')},
                {type: 'separator'},
                {label: 'Mark Unread', accelerator: 'CmdOrCtrl+Shift+U', click: () => send('mark-unread')},
                {label: 'Open Original', accelerator: 'CmdOrCtrl+O', click: () => send('open-original')},
            ],
        },
        {
            label: 'View',
            submenu: [
                {role: 'resetZoom'},
                {role: 'zoomIn'},
                {role: 'zoomOut'},
                {type: 'separator'},
                {role: 'togglefullscreen'},
            ],
        },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
