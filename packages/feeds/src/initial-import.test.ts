import {describe, expect, it} from 'vitest';
import {selectInitialFeedItems} from './initial-import';
import type {NormalizedFeedItem} from './types';

function item(
  externalId: string,
  publishedAt: string | null = null,
  sourceUpdatedAt: string | null = null,
): NormalizedFeedItem {
  return {
    externalId,
    canonicalUrl: null,
    title: externalId,
    author: null,
    publishedAt,
    sourceUpdatedAt,
    summary: null,
    contentHtml: null,
  };
}

describe('selectInitialFeedItems', () => {
  it('selects the newest dated entries and falls back to source-updated date', () => {
    const selection = selectInitialFeedItems([
      item('old', '2025-01-01T00:00:00.000Z'),
      item('updated', null, '2025-03-01T00:00:00.000Z'),
      item('new', '2025-04-01T00:00:00.000Z'),
    ], 2);
    expect(selection.imported.map(({externalId}) => externalId)).toEqual(['new', 'updated']);
    expect(selection.skipped.map(({externalId}) => externalId)).toEqual(['old']);
  });

  it('preserves feed order for undated entries', () => {
    const selection = selectInitialFeedItems([
      item('first'), item('second'), item('third'),
    ], 2);
    expect(selection.imported.map(({externalId}) => externalId)).toEqual(['first', 'second']);
    expect(selection.skipped.map(({externalId}) => externalId)).toEqual(['third']);
  });
});
