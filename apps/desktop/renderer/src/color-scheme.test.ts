import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

describe('approved base colour scheme', () => {
    it('declares every approved token and no unapproved literal colour', () => {
        const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
        const literals = [...css.matchAll(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/gi)].map(([value]) => value.toUpperCase());
        expect(new Set(literals)).toEqual(new Set(['#171615', '#1E1D1B', '#D6D5D4', '#4E99A3', '#9B6C22']));
        expect(css).not.toMatch(/(?:color|background):\s*(?:white|black)\b/i);
        expect(css).toContain('--background: #171615');
        expect(css).toContain('--sidebar: #1E1D1B');
        expect(css).toContain('--text: #D6D5D4');
        expect(css).toContain('--highlight: #4E99A3');
        expect(css).toContain('--note-highlight: #9B6C22');
    });
});
