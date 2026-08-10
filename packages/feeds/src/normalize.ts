import { createHash } from 'node:crypto';
import { parseFeed } from 'feedsmith';
import type { Atom, DeepPartial, Rss } from 'feedsmith/types';
import {
  FeedIngestionError,
  type NormalizedFeed,
  type NormalizedFeedItem,
} from './types';

function text(value: string | undefined | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function date(value: string | undefined | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function url(value: string | undefined | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim(), baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function identity(
  suppliedId: string | null,
  canonicalUrl: string | null,
  item: Omit<NormalizedFeedItem, 'externalId' | 'canonicalUrl'>,
): string {
  if (suppliedId) return `id:${suppliedId}`;
  if (canonicalUrl) return `url:${canonicalUrl}`;

  const seed = [
    item.title,
    item.author ?? '',
    item.publishedAt ?? '',
    item.sourceUpdatedAt ?? '',
    item.summary ?? '',
    item.contentHtml ?? '',
  ].join('\u001f');
  return `fallback:${createHash('sha256').update(seed).digest('hex')}`;
}

function rssAuthor(item: DeepPartial<Rss.Item<string>>): string | null {
  const author = item.authors?.[0];
  if (author) return text(author);
  return (
    text(item.dc?.creators?.[0]) ?? text(item.dcterms?.creators?.[0])
  );
}

function normalizeRssItem(
  item: DeepPartial<Rss.Item<string>>,
  feedUrl: string,
): NormalizedFeedItem {
  const canonicalUrl = url(item.link, feedUrl);
  const normalized = {
    title:
      text(item.title) ??
      text(item.dc?.titles?.[0]) ??
      'Untitled',
    author: rssAuthor(item),
    publishedAt:
      date(item.pubDate) ??
      date(item.dc?.dates?.[0]) ??
      date(item.dcterms?.issued),
    sourceUpdatedAt:
      date(item.atom?.updated) ?? date(item.dcterms?.modified),
    summary:
      text(item.description) ??
      text(item.dc?.descriptions?.[0]) ??
      text(item.dcterms?.abstracts?.[0]),
    contentHtml: text(item.content?.encoded),
  };
  const suppliedId =
    text(item.guid?.value) ??
    text(item.atom?.id) ??
    text(item.dc?.identifiers?.[0]);

  return {
    externalId: identity(suppliedId, canonicalUrl, normalized),
    canonicalUrl,
    ...normalized,
  };
}

function atomLink(
  links: Array<DeepPartial<Atom.Link<string>>> | undefined,
  feedUrl: string,
): string | null {
  const preferred =
    links?.find(
      (link) =>
        (!link.rel || link.rel === 'alternate') &&
        (!link.type || link.type === 'text/html'),
    ) ?? links?.find((link) => !link.rel || link.rel === 'alternate');
  return url(preferred?.href, feedUrl);
}

function normalizeAtomItem(
  item: DeepPartial<Atom.Entry<string>>,
  feedUrl: string,
): NormalizedFeedItem {
  const canonicalUrl = atomLink(item.links, feedUrl);
  const normalized = {
    title: text(item.title) ?? 'Untitled',
    author:
      text(item.authors?.[0]?.name) ??
      text(item.source?.authors?.[0]?.name) ??
      text(item.dc?.creators?.[0]),
    publishedAt: date(item.published) ?? date(item.dc?.dates?.[0]),
    sourceUpdatedAt: date(item.updated) ?? date(item.dcterms?.modified),
    summary:
      text(item.summary) ??
      text(item.dc?.descriptions?.[0]) ??
      text(item.dcterms?.abstracts?.[0]),
    contentHtml: text(item.content),
  };

  return {
    externalId: identity(text(item.id), canonicalUrl, normalized),
    canonicalUrl,
    ...normalized,
  };
}

function deduplicate(items: NormalizedFeedItem[]): NormalizedFeedItem[] {
  const byIdentity = new Map<string, NormalizedFeedItem>();
  for (const item of items) byIdentity.set(item.externalId, item);
  return [...byIdentity.values()];
}

export function parseAndNormalizeFeed(
  content: string,
  feedUrl: string,
): NormalizedFeed {
  let parsed: ReturnType<typeof parseFeed>;
  try {
    parsed = parseFeed(content);
  } catch (error) {
    throw new FeedIngestionError(
      'invalid_feed',
      error instanceof Error ? error.message : 'The response is not a valid feed.',
      { cause: error },
    );
  }

  if (parsed.format === 'rss') {
    return {
      format: 'rss',
      title: text(parsed.feed.title),
      siteUrl: url(parsed.feed.link, feedUrl),
      description: text(parsed.feed.description),
      items: deduplicate(
        (parsed.feed.items ?? []).map((item) =>
          normalizeRssItem(item, feedUrl),
        ),
      ),
    };
  }

  if (parsed.format === 'atom') {
    return {
      format: 'atom',
      title: text(parsed.feed.title),
      siteUrl: atomLink(parsed.feed.links, feedUrl),
      description: text(parsed.feed.subtitle),
      items: deduplicate(
        (parsed.feed.entries ?? []).map((entry) =>
          normalizeAtomItem(entry, feedUrl),
        ),
      ),
    };
  }

  throw new FeedIngestionError(
    'unsupported_response',
    `Detected ${parsed.format.toUpperCase()} feed; Stage 2 supports RSS and Atom.`,
  );
}
