import {describe, expect, it} from 'vitest';
import {sidebarLayoutClassName, sidebarToggleLabel} from './sidebar-state';

describe('sidebar state', () => {
    it('switches between expanded and icon-only layout classes', () => {
        expect(sidebarLayoutClassName(false)).toBe('app-shell');
        expect(sidebarLayoutClassName(true)).toBe('app-shell sidebar-collapsed');
    });

    it('exposes the action the arrow control will perform', () => {
        expect(sidebarToggleLabel(false)).toBe('Collapse sidebar');
        expect(sidebarToggleLabel(true)).toBe('Expand sidebar');
    });
});
