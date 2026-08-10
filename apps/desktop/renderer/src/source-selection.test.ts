import {describe, expect, it} from 'vitest';
import {pruneSourceSelection, selectAllSources, toggleSourceSelection} from './source-selection';

describe('bulk source selection', () => {
    it('stages and unstages individual sources without mutating the prior selection', () => {
        const prior = new Set(['one']);
        expect([...toggleSourceSelection(prior, 'two')]).toEqual(['one', 'two']);
        expect([...toggleSourceSelection(prior, 'one')]).toEqual([]);
        expect([...prior]).toEqual(['one']);
    });

    it('selects all available sources and prunes sources that are no longer available', () => {
        expect([...selectAllSources(['one', 'two'])]).toEqual(['one', 'two']);
        expect([...pruneSourceSelection(new Set(['one', 'missing']), ['one', 'two'])]).toEqual(['one']);
    });
});
