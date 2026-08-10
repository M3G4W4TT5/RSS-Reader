import {randomUUID} from 'node:crypto';
import type {ResolvedFeed} from '@rss-reader/feeds';
import {describe, expect, it} from 'vitest';
import {
    ArticleContentRepository,
    CollectionsRepository,
    createDatabase,
    IngestionRepository,
    ItemsRepository,
    migrateToLatest,
} from './index';

function fixture(feedUrl: string): ResolvedFeed {
    return {
        requestedUrl: feedUrl,
        feedUrl,
        siteUrl: 'https://example.com/',
        discovered: false,
        feed: {
            format: 'atom',
            title: 'Reader test',
            siteUrl: 'https://example.com/',
            description: null,
            items: [
                {
                    externalId: 'newer',
                    canonicalUrl: 'https://example.com/newer',
                    title: 'Newer',
                    author: 'Writer',
                    publishedAt: '2026-02-02T00:00:00.000Z',
                    sourceUpdatedAt: null,
                    summary: 'Newer summary',
                    contentHtml: '<p>Newer body</p>',
                },
                {
                    externalId: 'older',
                    canonicalUrl: 'https://example.com/older',
                    title: 'Older',
                    author: null,
                    publishedAt: '2026-01-01T00:00:00.000Z',
                    sourceUpdatedAt: null,
                    summary: null,
                    contentHtml: '<p>Older body</p>',
                },
            ],
        },
        response: {
            status: 'ok',
            httpStatus: 200,
            etag: null,
            lastModified: null,
            finalUrl: feedUrl,
            contentType: 'application/atom+xml',
            content: '<feed/>',
        },
    };
}

describe('ItemsRepository', () => {
    it('filters by unread/source/collection and persists read state across a new connection', async () => {
        const database = createDatabase();
        const collectionIds: string[] = [];
        let sourceId: string | undefined;
        try {
            await migrateToLatest(database);
            const collection = await new CollectionsRepository(database).create({
                name: `Reader ${randomUUID()}`,
                icon: 'folder',
            });
            collectionIds.push(collection.id);
            const feedUrl = `https://example.com/${randomUUID()}/feed.xml`;
            const created = await new IngestionRepository(database).createResolvedSource(
                {feedUrl, collectionIds: [collection.id]},
                fixture(feedUrl),
            );
            sourceId = created.sourceId;
            const items = new ItemsRepository(database);
            const all = await items.list({unreadOnly: false});
            const scoped = all.filter((item) => item.sourceId === sourceId);
            expect(scoped.map((item) => item.title)).toEqual(['Newer', 'Older']);
            expect(
                await items.list({
                    unreadOnly: false,
                    sourceId,
                    collectionId: collection.id,
                }),
            ).toHaveLength(2);

            const read = await items.setRead(scoped[0]!.id, true);
            expect(read.readAt).not.toBeNull();
            expect(await items.list({unreadOnly: true, sourceId})).toHaveLength(1);

            const content = new ArticleContentRepository(database);
            expect((await content.get(read.id)).status).toBe('not_requested');
            await content.markFetching(read.id, read.canonicalUrl);
            const imageId = '03c7b981-94f2-49c6-b002-534f6a54ab32';
            await content.persist(read.id, {
                status: 'complete',
                retrievedUrl: read.canonicalUrl!,
                rawHtml: '<html><article>Fixture raw article</article></html>',
                readerHtml: '<article>Fixture reader article</article>',
                readerText: 'Fixture reader article',
                error: null,
                images: [{
                    id: imageId,
                    originalUrl: 'https://example.com/image.jpg',
                    mimeType: 'image/webp',
                    width: 800,
                    height: 450,
                    data: Buffer.from('cached-image'),
                }],
            });
            await expect(content.getImage(read.id, imageId)).resolves.toEqual({
                mimeType: 'image/webp',
                data: Buffer.from('cached-image'),
            });

            const restarted = createDatabase();
            try {
                await expect(new ItemsRepository(restarted).get(read.id)).resolves.toMatchObject({
                    id: read.id,
                    readAt: read.readAt,
                    feedContentHtml: '<p>Newer body</p>',
                    articleContent: {
                        status: 'complete',
                        readerHtml: '<article>Fixture reader article</article>',
                    },
                });
            } finally {
                await restarted.destroy();
            }
        } finally {
            if (sourceId) {
                await database.deleteFrom('sources').where('id', '=', sourceId).execute();
            }
            if (collectionIds.length > 0) {
                await database
                    .deleteFrom('collections')
                    .where('id', 'in', collectionIds)
                    .execute();
            }
            await database.destroy();
        }
    });
});
