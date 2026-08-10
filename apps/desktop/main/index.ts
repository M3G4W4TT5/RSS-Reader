import path from 'node:path';
import {app, BrowserWindow, protocol, screen} from 'electron';
import {
    checkDatabase,
    createDatabase,
    migrateToLatest,
    type Database,
} from '@rss-reader/db';
import {registerIpcHandlers} from './ipc';
import {installApplicationMenu} from './application-menu';
import {readWindowState, writeWindowState} from './window-state';
import {registerArticleImageProtocol} from './image-protocol';
import {registerSourceFaviconProtocol} from './favicon-protocol';

protocol.registerSchemesAsPrivileged([{
    scheme: 'rss-reader-image',
    privileges: {standard: true, secure: true},
}]);
protocol.registerSchemesAsPrivileged([{
    scheme: 'rss-reader-favicon',
    privileges: {standard: true, secure: true},
}]);

let database: Database | undefined;

function createMainWindow(): BrowserWindow {
    const stateFile = path.join(app.getPath('userData'), 'window-state.json');
    const state = readWindowState(stateFile);
    const display = state.x !== undefined && state.y !== undefined
        ? screen.getDisplayMatching({x: state.x, y: state.y, width: state.width, height: state.height})
        : screen.getPrimaryDisplay();
    const workArea = display.workArea;
    const width = Math.min(state.width, workArea.width);
    const height = Math.min(state.height, workArea.height);
    const restoredPosition = state.x !== undefined && state.y !== undefined
        ? {
            x: Math.min(Math.max(state.x, workArea.x), workArea.x + workArea.width - width),
            y: Math.min(Math.max(state.y, workArea.y), workArea.y + workArea.height - height),
        }
        : {};
    const mainWindow = new BrowserWindow({
        width,
        height,
        ...restoredPosition,
        minWidth: 720,
        minHeight: 480,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    mainWindow.once('ready-to-show', () => {
        if (state.maximized) mainWindow.maximize();
        mainWindow.show();
    });
    mainWindow.on('close', () => {
        const bounds = mainWindow.getNormalBounds();
        writeWindowState(stateFile, {...bounds, maximized: mainWindow.isMaximized()});
    });
    installApplicationMenu(mainWindow);

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
        void mainWindow.loadFile(
            path.join(
                __dirname,
                `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
            ),
        );
    }

    return mainWindow;
}

app.whenReady().then(async () => {
    try {
        database = createDatabase();
        await migrateToLatest(database);
        const databaseHealth = await checkDatabase(database);
        console.info(
            `[startup] PostgreSQL connected: ${databaseHealth.name} (${databaseHealth.migration}).`,
        );
        registerIpcHandlers(database);
        registerArticleImageProtocol(database);
        registerSourceFaviconProtocol(database);
        createMainWindow();
    } catch (error) {
        console.error('Application startup failed.', error);
        app.quit();
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0 && database) {
            createMainWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    if (database) {
        void database.destroy();
        database = undefined;
    }
});
