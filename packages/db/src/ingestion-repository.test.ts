import { randomUUID } from 'node:crypto';
import type {NormalizedFeed, ResolvedFeed} from '@rss-reader/feeds';
import { describe, expect, it } from 'vitest';
import {
  createDatabase,
  IngestionRepository,
  migrateToLatest,
  SourcesRepository,
} from './index';

const metadata = {
  httpStatus: 200,
  etag: '"fixture-v1"',
  lastModified: 'Wed, 08 Jan 2025 12:00:00 GMT',
};

function feed(version: 'first' | 'updated'): NormalizedFeed {
  const items: NormalizedFeed['items'] = [
    {
      externalId: 'id:item-a',
      canonicalUrl: 'https://example.com/a',
      title: version === 'first' ? 'Item A' : 'Item A corrected',
      author: 'Author',
      publishedAt: '2025-01-08T10:00:00.000Z',
      sourceUpdatedAt:
        version === 'first'
          ? '2025-01-08T10:00:00.000Z'
          : '2025-01-08T12:00:00.000Z',
      summary: version === 'first' ? 'Original' : 'Corrected',
      contentHtml: null,
    },
    {
      externalId: 'id:item-b',
      canonicalUrl: 'https://example.com/b',
      title: 'Item B',
      author: null,
      publishedAt: '2025-01-08T11:00:00.000Z',
      sourceUpdatedAt: null,
      summary: 'Unchanged',
      contentHtml: '<p>Full B</p>',
    },
  ];
  if (version === 'updated') {
    items.push({
      externalId: 'id:item-c',
      canonicalUrl: 'https://example.com/c',
      title: 'Item C',
      author: null,
      publishedAt: '2025-01-08T12:00:00.000Z',
      sourceUpdatedAt: null,
      summary: 'New',
      contentHtml: null,
    });
  }

  return {
    format: 'rss',
    title: 'Fetched feed title',
    siteUrl: 'https://example.com/',
    description: 'Fetched description',
    items,
  };
}

describe('IngestionRepository', () => {
  it('upserts logical items, records runs, and preserves local read state', async () => {
    const database = createDatabase();
    const sources = new SourcesRepository(database);
    const ingestion = new IngestionRepository(database);
    let sourceId: string | undefined;

    try {
      await migrateToLatest(database);
      const source = await sources.create({
        feedUrl: `https://example.com/${randomUUID()}/feed.xml`,
        collectionIds: [],
      });
      sourceId = source.id;

      const firstRun = await ingestion.startRun(source.id);
      const first = await ingestion.completeFeed(
        firstRun.id,
        source.id,
        feed('first'),
        metadata,
      );
      expect(first).toMatchObject({
        sourceName: 'Fetched feed title',
        itemsReceived: 2,
        itemsInserted: 2,
        itemsUpdated: 0,
      });

      const itemA = await database
        .selectFrom('items')
        .select(['id', 'external_id'])
        .where('source_id', '=', source.id)
        .where('external_id', '=', 'id:item-a')
        .executeTakeFirstOrThrow();
      await database
        .updateTable('items')
        .set({ read_at: new Date('2025-01-09T00:00:00Z') })
        .where('id', '=', itemA.id)
        .execute();

      const secondRun = await ingestion.startRun(source.id);
      const second = await ingestion.completeFeed(
        secondRun.id,
        source.id,
        feed('updated'),
        { ...metadata, etag: '"fixture-v2"' },
      );
      expect(second).toMatchObject({
        itemsReceived: 3,
        itemsInserted: 1,
        itemsUpdated: 1,
      });

      const persisted = await database
        .selectFrom('items')
        .select(['external_id', 'title', 'read_at'])
        .where('source_id', '=', source.id)
        .orderBy('external_id')
        .execute();
      expect(persisted).toHaveLength(3);
      expect(persisted.find((item) => item.external_id === 'id:item-a')).toMatchObject({
        title: 'Item A corrected',
        read_at: expect.any(Date),
      });

      const unchangedRun = await ingestion.startRun(source.id);
      await ingestion.completeNotModified(unchangedRun.id, source.id, {
        httpStatus: 304,
        etag: '"fixture-v2"',
        lastModified: null,
      });

      const runs = await database
        .selectFrom('fetch_runs')
        .select(['status', 'items_inserted', 'items_updated'])
        .where('source_id', '=', source.id)
        .orderBy('started_at')
        .execute();
      expect(runs.map((run) => run.status)).toEqual([
        'success',
        'success',
        'unchanged',
      ]);
      expect((await sources.get(source.id)).lastFetchedAt).not.toBeNull();

      const fetchedSource = await sources.get(source.id);
      await sources.update({
        id: source.id,
        input: {
          name: fetchedSource.name,
          feedUrl: `https://example.com/${randomUUID()}/replacement.xml`,
          enabled: true,
          collectionIds: [],
        },
      });
      await expect(ingestion.getSource(source.id)).resolves.toMatchObject({
        etag: null,
        lastModified: null,
      });
    } finally {
      if (sourceId) {
        await database.deleteFrom('sources').where('id', '=', sourceId).execute();
      }
      await database.destroy();
    }
  });

  it('limits the initial import, suppresses its backlog, and resets suppression for a replacement feed', async () => {
    const database = createDatabase();
    const ingestion = new IngestionRepository(database);
    let sourceId: string | undefined;
    let originalLimit: number | undefined;
    const suffix = randomUUID();
    const initialFeed: NormalizedFeed = {
      format: 'rss',
      title: 'Limited feed',
      siteUrl: 'https://example.com/',
      description: null,
      items: [1, 2, 3, 4].map((number) => ({
        externalId: `id:initial-${number}`,
        canonicalUrl: `https://example.com/initial-${number}`,
        title: `Initial ${number}`,
        author: null,
        publishedAt: `2025-01-0${number}T00:00:00.000Z`,
        sourceUpdatedAt: null,
        summary: null,
        contentHtml: null,
      })),
    };
    const resolved = (feedUrl: string, normalizedFeed: NormalizedFeed): ResolvedFeed => ({
      requestedUrl: feedUrl,
      feedUrl,
      siteUrl: normalizedFeed.siteUrl,
      discovered: false,
      feed: normalizedFeed,
      response: {
        status: 'ok',
        httpStatus: 200,
        etag: null,
        lastModified: null,
        finalUrl: feedUrl,
        contentType: 'application/rss+xml',
        content: '<rss/>',
      },
    });

    try {
      await migrateToLatest(database);
      const settings = await database
        .selectFrom('application_settings')
        .select('initial_article_limit')
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
      originalLimit = settings.initial_article_limit;
      await database
        .updateTable('application_settings')
        .set({initial_article_limit: 2})
        .where('id', '=', 1)
        .execute();

      const feedUrl = `https://example.com/${suffix}/feed.xml`;
      const created = await ingestion.createResolvedSource(
        {feedUrl, collectionIds: []},
        resolved(feedUrl, initialFeed),
      );
      sourceId = created.sourceId;
      expect(created).toMatchObject({
        itemsReceived: 4,
        itemsInserted: 2,
        itemsSkipped: 2,
      });
      expect(await database.selectFrom('items').select('id').where('source_id', '=', sourceId).execute())
        .toHaveLength(2);
      expect(await database.selectFrom('initial_item_suppressions').select('external_id')
        .where('source_id', '=', sourceId).orderBy('external_id').execute())
        .toEqual([{external_id: 'id:initial-1'}, {external_id: 'id:initial-2'}]);

      const nextFeed: NormalizedFeed = {
        ...initialFeed,
        items: [...initialFeed.items, {
          ...initialFeed.items[0]!,
          externalId: 'id:new-after-subscription',
          title: 'New after subscription',
          publishedAt: '2025-02-01T00:00:00.000Z',
        }],
      };
      const run = await ingestion.startRun(sourceId);
      const refreshed = await ingestion.completeFeed(run.id, sourceId, nextFeed, metadata);
      expect(refreshed).toMatchObject({itemsInserted: 1, itemsSkipped: 2});
      expect(await database.selectFrom('items').select('id').where('source_id', '=', sourceId).execute())
        .toHaveLength(3);

      const replacementFeed: NormalizedFeed = {
        ...initialFeed,
        items: [5, 6, 7].map((number) => ({
          ...initialFeed.items[0]!,
          externalId: `id:replacement-${number}`,
          title: `Replacement ${number}`,
          publishedAt: `2025-03-0${number - 4}T00:00:00.000Z`,
        })),
      };
      const replacementUrl = `https://example.com/${suffix}/replacement.xml`;
      const replaced = await ingestion.replaceResolvedSource({
        id: sourceId,
        input: {
          name: 'Replacement feed',
          feedUrl: replacementUrl,
          enabled: true,
          collectionIds: [],
        },
      }, resolved(replacementUrl, replacementFeed));
      expect(replaced).toMatchObject({itemsInserted: 2, itemsSkipped: 1});
      expect(await database.selectFrom('initial_item_suppressions').select('external_id')
        .where('source_id', '=', sourceId).execute())
        .toEqual([{external_id: 'id:replacement-5'}]);
    } finally {
      if (sourceId) {
        await database.deleteFrom('sources').where('id', '=', sourceId).execute();
      }
      if (originalLimit !== undefined) {
        await database.updateTable('application_settings')
          .set({initial_article_limit: originalLimit})
          .where('id', '=', 1)
          .execute();
      }
      await database.destroy();
    }
  });
});
