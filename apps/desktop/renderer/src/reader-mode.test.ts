import {describe, expect, it} from 'vitest';
import {readerGridClassName, readerModeLabel} from './reader-mode';

describe('fullscreen reader mode', () => {
    it('expands the in-app reader box and describes the inverse action', () => {
        expect(readerGridClassName(false)).toBe('reader-grid');
        expect(readerModeLabel(false)).toBe('Enter fullscreen reader mode');
        expect(readerGridClassName(true)).toBe('reader-grid reader-expanded');
        expect(readerModeLabel(true)).toBe('Exit fullscreen reader mode');
    });
});
