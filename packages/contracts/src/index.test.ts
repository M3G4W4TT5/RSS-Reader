import {describe, expect, it} from 'vitest';
import {healthCheckResponseSchema} from './index';

describe('healthCheckResponseSchema', () => {
    it('accepts the trusted IPC health response', () => {
        expect(
            healthCheckResponseSchema.parse({
                status: 'ok',
                database: {
                    name: 'reader',
                    time: '2026-01-01T00:00:00.000Z',
                    migration: 'stage-7',
                },
            }),
        ).toEqual({
            status: 'ok',
            database: {
                name: 'reader',
                time: '2026-01-01T00:00:00.000Z',
                migration: 'stage-7',
            },
        });
    });

    it('rejects an invalid response', () => {
        expect(() =>
            healthCheckResponseSchema.parse({status: 'ok', database: null}),
        ).toThrow();
        expect(() => healthCheckResponseSchema.parse({
            status: 'ok',
            database: {name: 'reader', time: '2026-01-01T00:00:00.000Z', migration: 'latest'},
        })).toThrow();
    });

    it('rejects non-HTTP source URLs', async () => {
        const {createSourceInputSchema} = await import('./index');
        expect(() =>
            createSourceInputSchema.parse({
                feedUrl: 'file:///private/feed.xml',
                collectionIds: [],
            }),
        ).toThrow(/HTTP or HTTPS/);
    });

    it('validates fetch progress without exposing a generic IPC surface', async () => {
        const {fetchOperationStatusSchema} = await import('./index');
        expect(
            fetchOperationStatusSchema.parse({
                running: true,
                mode: 'all',
                startedAt: '2026-01-01T00:00:00.000Z',
                completedAt: null,
                totalSources: 1,
                completedSources: 0,
                sources: [
                    {
                        sourceId: '2d8430d4-6aa7-4eb8-a4fb-0fcfd20e0783',
                        sourceName: 'Example',
                        status: 'fetching',
                        itemsInserted: 0,
                        itemsUpdated: 0,
                        itemsSkipped: 0,
                        errorMessage: null,
                    },
                ],
            }),
        ).toMatchObject({running: true, mode: 'all', totalSources: 1});
    });

    it('validates narrow Stage 3 item filters', async () => {
        const {itemQuerySchema} = await import('./index');
        expect(
            itemQuerySchema.parse({
                unreadOnly: true,
                sourceId: '2d8430d4-6aa7-4eb8-a4fb-0fcfd20e0783',
            }),
        ).toEqual({
            unreadOnly: true,
            sourceId: '2d8430d4-6aa7-4eb8-a4fb-0fcfd20e0783',
        });
    });

    it('requires the complete source membership when updating a collection', async () => {
        const {updateCollectionRequestSchema} = await import('./index');
        const id = '2d8430d4-6aa7-4eb8-a4fb-0fcfd20e0783';
        expect(updateCollectionRequestSchema.parse({
            id,
            input: {name: 'AI', icon: 'technology', sourceIds: [id]},
        })).toEqual({id, input: {name: 'AI', icon: 'technology', sourceIds: [id]}});
        expect(() => updateCollectionRequestSchema.parse({
            id,
            input: {name: 'AI'},
        })).toThrow();
    });

    it('limits collection icons to the curated set', async () => {
        const {createCollectionInputSchema} = await import('./index');
        expect(createCollectionInputSchema.parse({name: 'Science', icon: 'science'})).toEqual({name: 'Science', icon: 'science'});
        expect(() => createCollectionInputSchema.parse({name: 'Custom', icon: 'arbitrary-icon'})).toThrow();
    });

    it('validates the configurable initial article limit', async () => {
        const {updateApplicationSettingsSchema} = await import('./index');
        expect(updateApplicationSettingsSchema.parse({initialArticleLimit: 25}))
            .toEqual({initialArticleLimit: 25});
        expect(() => updateApplicationSettingsSchema.parse({initialArticleLimit: 0})).toThrow();
        expect(() => updateApplicationSettingsSchema.parse({initialArticleLimit: 501})).toThrow();
    });

    it('validates optional bulk-import fields while requiring a public-format URL', async () => {
        const {sourceImportRowSchema, sourceImportStatusSchema} = await import('./index');
        expect(sourceImportRowSchema.parse({
            url: 'https://example.com/',
            name: 'Example',
            collection: 'AI | Daily',
        })).toMatchObject({url: 'https://example.com/', name: 'Example'});
        expect(() => sourceImportRowSchema.parse({name: 'Missing URL'})).toThrow();
        expect(sourceImportStatusSchema.parse({
            running: true,
            fileName: 'sources.csv',
            totalRows: 10,
            completedRows: 4,
            imported: 3,
            updated: 1,
            failed: 0,
            collectionsCreated: 2,
            startedAt: '2026-01-01T00:00:00.000Z',
            completedAt: null,
        })).toMatchObject({running: true, completedRows: 4});
    });

    it('validates and deduplicates a bounded bulk source deletion request', async () => {
        const {deleteSourcesRequestSchema} = await import('./index');
        const id = '2d8430d4-6aa7-4eb8-a4fb-0fcfd20e0783';
        expect(deleteSourcesRequestSchema.parse({ids: [id, id]})).toEqual({ids: [id]});
        expect(() => deleteSourcesRequestSchema.parse({ids: []})).toThrow();
    });
});
