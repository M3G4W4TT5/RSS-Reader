import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {Collection, CreateSourceInput, Source} from '@rss-reader/contracts';
import {describe, expect, it} from 'vitest';
import {parseSourceImport, SourceImportService} from './source-import';

function fixture(name: string): string {
    return readFileSync(
        new URL(`../../../tests/fixtures/import/${name}`, import.meta.url),
        'utf8',
    );
}

function collection(name: string): Collection {
    return {
        id: randomUUID(),
        name,
        icon: 'folder',
        sourceCount: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };
}

function source(input: CreateSourceInput): Source {
    return {
        id: randomUUID(),
        name: input.name ?? 'Discovered source',
        feedUrl: input.feedUrl,
        siteUrl: null,
        description: null,
        enabled: true,
        lastFetchedAt: null,
        collectionIds: input.collectionIds,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };
}

describe('source import parsing', () => {
    it('parses the supplied CSV shape, quoted commas, optional names, and multiple collections', () => {
        const rows = parseSourceImport(`\uFEFF${fixture('sources.csv')}`, '.csv');
        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({
            url: 'https://example.com/feed.xml',
            name: 'Example, Incorporated',
            collectionNames: ['AI > Research', 'Daily'],
        });
        expect(rows[1]).toMatchObject({name: undefined, collectionNames: ['Daily']});
    });

    it('parses the equivalent JSON array shape', () => {
        expect(parseSourceImport(fixture('sources.json'), '.json')).toMatchObject([
            {name: 'Example, Incorporated', collectionNames: ['AI > Research', 'Daily']},
            {url: 'https://second.example.com/', collectionNames: ['Daily']},
        ]);
    });

    it('rejects missing URL columns, invalid URLs, and unsupported formats clearly', () => {
        expect(() => parseSourceImport('name\nNo URL', '.csv')).toThrow(/url header/);
        expect(() => parseSourceImport('[{"url":"file:///feed.xml"}]', '.json')).toThrow(/Row 1/);
        expect(() => parseSourceImport('url\nhttps://example.com', '.txt')).toThrow(/csv or .json/);
    });
});

describe('SourceImportService', () => {
    it('creates missing collections once and continues after an unusable source', async () => {
        const existing = collection('Daily');
        const created: Collection[] = [];
        const inputs: CreateSourceInput[] = [];
        const service = new SourceImportService(
            {
                list: async () => [existing],
                create: async ({name}) => {
                    const value = collection(name);
                    created.push(value);
                    return value;
                },
            },
            {
                importSource: async (input) => {
                    inputs.push(input);
                    if (input.feedUrl.includes('broken')) throw new Error('No usable RSS/Atom feed was found.');
                    return {source: source(input), created: !input.feedUrl.includes('second')};
                },
            },
        );

        const result = await service.importFile(
            fileURLToPath(new URL('../../../tests/fixtures/import/sources.csv', import.meta.url)),
        );

        expect(created.map(({name}) => name)).toEqual(['AI > Research']);
        expect(inputs[0]?.collectionIds).toEqual(expect.arrayContaining([existing.id, created[0]!.id]));
        expect(result).toMatchObject({
            totalRows: 3,
            imported: 1,
            updated: 1,
            failed: 1,
            collectionsCreated: 1,
        });
        expect(service.getStatus()).toMatchObject({running: false, completedRows: 3});
    });
});
