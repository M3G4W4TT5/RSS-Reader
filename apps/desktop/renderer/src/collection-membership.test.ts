import type {Source} from '@rss-reader/contracts';
import {describe, expect, it} from 'vitest';
import {filterSources} from './collection-membership';

const sources = [
  {name: 'OpenAI News', feedUrl: 'https://openai.com/news/rss.xml'},
  {name: 'Engineering', feedUrl: 'https://example.com/technology/feed'},
] as Source[];

describe('filterSources', () => {
  it('matches source names and feed URLs case-insensitively', () => {
    expect(filterSources(sources, 'OPENAI')).toEqual([sources[0]]);
    expect(filterSources(sources, 'technology')).toEqual([sources[1]]);
  });

  it('returns all sources for an empty search', () => {
    expect(filterSources(sources, '   ')).toBe(sources);
  });
});
