import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FeedIngestionError, parseAndNormalizeFeed } from './index';

function fixture(name: string): string {
  return readFileSync(
    new URL(`../../../tests/fixtures/feeds/${name}`, import.meta.url),
    'utf8',
  );
}

describe('parseAndNormalizeFeed', () => {
  it('normalizes RSS metadata, entries, URLs, and dates', () => {
    const feed = parseAndNormalizeFeed(
      fixture('rss-2.0.xml'),
      'https://example.com/feed.xml',
    );
    expect(feed).toMatchObject({
      format: 'rss',
      title: 'Example RSS',
      siteUrl: 'https://example.com/',
      description: 'Fixture RSS feed',
    });
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]).toMatchObject({
      externalId: 'id:rss-one',
      title: 'First RSS item',
      author: 'Sam Example',
      publishedAt: '2025-01-06T10:00:00.000Z',
    });
    expect(feed.items[1]?.canonicalUrl).toBe('https://example.com/posts/two');
  });

  it('normalizes Atom metadata and entries', () => {
    const feed = parseAndNormalizeFeed(
      fixture('atom.xml'),
      'https://atom.example.com/feed.xml',
    );
    expect(feed).toMatchObject({
      format: 'atom',
      title: 'Example Atom',
      siteUrl: 'https://atom.example.com/',
    });
    expect(feed.items[0]).toMatchObject({
      externalId: 'id:tag:atom.example.com,2025:one',
      title: 'Atom entry',
      author: 'Alex Atom',
      contentHtml: '<p>Atom content</p>',
    });
  });

  it('keeps full content separate from a summary', () => {
    const full = parseAndNormalizeFeed(
      fixture('full-content.xml'),
      'https://example.com/feed',
    );
    const summary = parseAndNormalizeFeed(
      fixture('summary-only.xml'),
      'https://example.com/feed',
    );
    expect(full.items[0]).toMatchObject({
      summary: 'Short version',
      contentHtml: '<article><p>Complete feed article.</p></article>',
    });
    expect(summary.items[0]).toMatchObject({
      summary: 'A summary without full content.',
      contentHtml: null,
    });
  });

  it('uses URL identity and a deterministic hash when GUID is absent', () => {
    const first = parseAndNormalizeFeed(
      fixture('missing-guid.xml'),
      'https://example.com/feed.xml',
    );
    const second = parseAndNormalizeFeed(
      fixture('missing-guid.xml'),
      'https://example.com/feed.xml',
    );
    expect(first.items[0]?.externalId).toBe(
      'url:https://example.com/posts/url-identity',
    );
    expect(first.items[1]?.externalId).toMatch(/^fallback:[a-f0-9]{64}$/);
    expect(first.items[1]?.externalId).toBe(second.items[1]?.externalId);
  });

  it('deduplicates repeated logical entries and keeps the last representation', () => {
    const feed = parseAndNormalizeFeed(
      fixture('duplicate-entries.xml'),
      'https://example.com/feed',
    );
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]?.title).toBe('Later duplicate');
  });

  it('keeps item identity stable when mutable fields change', () => {
    const original = parseAndNormalizeFeed(
      fixture('rss-2.0.xml'),
      'https://example.com/feed',
    );
    const updated = parseAndNormalizeFeed(
      fixture('updated-entry.xml'),
      'https://example.com/feed',
    );
    expect(updated.items[0]?.externalId).toBe(original.items[0]?.externalId);
    expect(updated.items[0]?.title).not.toBe(original.items[0]?.title);
  });

  it('accepts an empty feed and normalizes unusual dates safely', () => {
    expect(
      parseAndNormalizeFeed(
        fixture('empty.xml'),
        'https://example.com/feed',
      ).items,
    ).toEqual([]);
    const dated = parseAndNormalizeFeed(
      fixture('unusual-dates.xml'),
      'https://example.com/feed',
    );
    expect(dated.items[0]?.publishedAt).toBe('2025-01-07T12:35:00.000Z');
    expect(dated.items[1]?.publishedAt).toBeNull();
  });

  it('reports malformed input as an invalid feed', () => {
    expect(() =>
      parseAndNormalizeFeed(
        fixture('malformed.xml'),
        'https://example.com/feed',
      ),
    ).toThrowError(
      expect.objectContaining<Partial<FeedIngestionError>>({
        category: 'invalid_feed',
      }),
    );
  });
});
