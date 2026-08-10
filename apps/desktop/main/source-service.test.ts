import {randomUUID} from 'node:crypto';
import type {ResolvedFeed} from '@rss-reader/feeds';
import {
    createDatabase,
    IngestionRepository,
    migrateToLatest,
    SourcesRepository,
} from '@rss-reader/db';
import {describe, expect, it} from 'vitest';
import {SourceService} from './source-service';

function resolved(feedUrl: string): ResolvedFeed {
    return {
        requestedUrl: feedUrl,
        feedUrl,
        siteUrl: 'https://example.com/',
        discovered: false,
        feed: {
            format: 'rss',
            title: 'Validated source',
            siteUrl: 'https://example.com/',
            description: 'Fixture',
            items: [{
                externalId: 'id:initial',
                canonicalUrl: 'https://example.com/initial',
                title: 'Initial item',
                author: null,
                publishedAt: '2026-01-01T00:00:00.000Z',
                sourceUpdatedAt: null,
                summary: 'Summary',
                contentHtml: '<p>Body</p>',
            }],
        },
        response: {
            status: 'ok',
            httpStatus: 200,
            etag: '"fixture"',
            lastModified: null,
            finalUrl: feedUrl,
            contentType: 'application/rss+xml',
            content: '<rss/>',
        },
    };
}

describe('SourceService validation boundary', () => {
    it('persists a source and initial items atomically, and preserves them after a failed URL edit', async () => {
        const database = createDatabase();
        const sources = new SourcesRepository(database);
        const ingestion = new IngestionRepository(database);
        const suffix = randomUUID();
        const feedUrl = `https://example.com/${suffix}/feed.xml`;
        const service = new SourceService(sources, ingestion, async (url) => {
            if (url.includes('invalid')) throw new Error('No usable feed.');
            return resolved(url);
        });
        let sourceId: string | undefined;
        try {
            await migrateToLatest(database);
            const created = await service.create({feedUrl, name: 'Preferred import name', collectionIds: []});
            sourceId = created.source.id;
            expect(created).toMatchObject({
                source: {name: 'Preferred import name', feedUrl},
                fetchResult: {status: 'success', itemsInserted: 1},
            });
            await expect(service.importSource({
                feedUrl,
                name: 'Updated import name',
                collectionIds: [],
            })).resolves.toMatchObject({
                created: false,
                source: {id: sourceId, name: 'Updated import name'},
            });
            expect((await sources.list()).filter((source) => source.feedUrl === feedUrl)).toHaveLength(1);
            const before = await sources.get(sourceId);
            const beforeItems = await database
                .selectFrom('items')
                .select('id')
                .where('source_id', '=', sourceId)
                .execute();
            await expect(
                service.update({
                    id: sourceId,
                    input: {
                        name: 'Should not persist',
                        feedUrl: `https://invalid.example.com/${suffix}`,
                        enabled: false,
                        collectionIds: [],
                    },
                }),
            ).rejects.toThrow('No usable feed');
            expect(await sources.get(sourceId)).toEqual(before);
            expect(
                await database
                    .selectFrom('items')
                    .select('id')
                    .where('source_id', '=', sourceId)
                    .execute(),
            ).toEqual(beforeItems);
        } finally {
            if (sourceId) {
                await database.deleteFrom('sources').where('id', '=', sourceId).execute();
            }
            await database.destroy();
        }
    });

    it('does not create a placeholder source when validation fails', async () => {
        const database = createDatabase();
        const sources = new SourcesRepository(database);
        const service = new SourceService(
            sources,
            new IngestionRepository(database),
            async () => {
                throw new Error('No usable feed.');
            },
        );
        const url = `https://invalid.example.com/${randomUUID()}`;
        try {
            await migrateToLatest(database);
            await expect(service.create({feedUrl: url, collectionIds: []})).rejects.toThrow(
                'No usable feed',
            );
            expect((await sources.list()).some((source) => source.feedUrl === url)).toBe(false);
        } finally {
            await database.destroy();
        }
    });
});
