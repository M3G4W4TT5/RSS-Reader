import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

export interface WindowState {
    width: number;
    height: number;
    x?: number;
    y?: number;
    maximized: boolean;
}

export const defaultWindowState: WindowState = {
    width: 1100,
    height: 720,
    maximized: false,
};

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function readWindowState(filePath: string): WindowState {
    try {
        const value = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
        if (!finite(value.width) || !finite(value.height)) return defaultWindowState;
        return {
            width: Math.max(720, Math.round(value.width)),
            height: Math.max(480, Math.round(value.height)),
            ...(finite(value.x) && finite(value.y) ? {x: Math.round(value.x), y: Math.round(value.y)} : {}),
            maximized: value.maximized === true,
        };
    } catch {
        return defaultWindowState;
    }
}

export function writeWindowState(filePath: string, state: WindowState): void {
    mkdirSync(path.dirname(filePath), {recursive: true});
    writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
