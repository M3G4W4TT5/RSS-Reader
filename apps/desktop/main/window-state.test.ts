import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {defaultWindowState, readWindowState, writeWindowState} from './window-state';

const directories: string[] = [];

function statePath(): string {
    const directory = mkdtempSync(path.join(tmpdir(), 'rss-reader-window-'));
    directories.push(directory);
    return path.join(directory, 'state.json');
}

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, {recursive: true, force: true})));

describe('window state', () => {
    it('uses defaults for missing or corrupt state', () => {
        const file = statePath();
        expect(readWindowState(file)).toEqual(defaultWindowState);
        writeFileSync(file, '{broken');
        expect(readWindowState(file)).toEqual(defaultWindowState);
    });

    it('persists normal bounds and maximized state', () => {
        const file = statePath();
        writeWindowState(file, {x: 80, y: 40, width: 1280, height: 800, maximized: true});
        expect(readWindowState(file)).toEqual({x: 80, y: 40, width: 1280, height: 800, maximized: true});
        expect(readFileSync(file, 'utf8')).toContain('"maximized": true');
    });

    it('enforces the application minimum size', () => {
        const file = statePath();
        writeFileSync(file, JSON.stringify({width: 2, height: 3, maximized: false}));
        expect(readWindowState(file)).toMatchObject({width: 720, height: 480});
    });
});
