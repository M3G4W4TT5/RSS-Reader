import {readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {
    createCollectionInputSchema,
    sourceImportRowSchema,
    type SourceImportResult,
    type SourceImportRowResult,
    type SourceImportStatus,
} from '@rss-reader/contracts';
import type {CollectionsRepository} from '@rss-reader/db';
import type {SourceService} from './source-service';

const maximumImportBytes = 5 * 1024 * 1024;
const maximumImportRows = 2_000;
const importConcurrency = 4;

interface ParsedSourceImportRow {
    row: number;
    url: string;
    name?: string;
    collectionNames: string[];
}

type CollectionStore = Pick<CollectionsRepository, 'list' | 'create'>;
type SourceImporter = Pick<SourceService, 'importSource'>;

function csvRows(input: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;

    for (let index = 0; index < input.length; index += 1) {
        const character = input[index]!;
        if (quoted) {
            if (character === '"' && input[index + 1] === '"') {
                field += '"';
                index += 1;
            } else if (character === '"') {
                quoted = false;
            } else {
                field += character;
            }
            continue;
        }
        if (character === '"' && field.length === 0) {
            quoted = true;
        } else if (character === ',') {
            row.push(field);
            field = '';
        } else if (character === '\n') {
            row.push(field.replace(/\r$/, ''));
            if (row.some((value) => value.trim())) rows.push(row);
            row = [];
            field = '';
        } else {
            field += character;
        }
    }
    if (quoted) throw new Error('The CSV file contains an unterminated quoted field.');
    row.push(field.replace(/\r$/, ''));
    if (row.some((value) => value.trim())) rows.push(row);
    return rows;
}

function collections(value: string | undefined, row: number): string[] {
    if (!value?.trim()) return [];
    const names = [...new Set(value.split(/\s*\|\s*/).map((name) => name.trim()).filter(Boolean))];
    for (const name of names) {
        const parsed = createCollectionInputSchema.safeParse({name, icon: 'folder'});
        if (!parsed.success) {
            throw new Error(`Row ${row}: collection names must contain 1–200 characters.`);
        }
    }
    return names;
}

function parseRecord(value: unknown, row: number): ParsedSourceImportRow {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`Row ${row}: expected an object with a url field.`);
    }
    const normalized = Object.fromEntries(
        Object.entries(value).map(([key, field]) => [key.trim().toLowerCase(), field]),
    );
    const raw = {
        url: typeof normalized.url === 'string' ? normalized.url.trim() : '',
        name: typeof normalized.name === 'string' && normalized.name.trim()
            ? normalized.name.trim()
            : undefined,
        collection: typeof normalized.collection === 'string' && normalized.collection.trim()
            ? normalized.collection.trim()
            : undefined,
    };
    const parsed = sourceImportRowSchema.safeParse(raw);
    if (!parsed.success) {
        const issue = parsed.error.issues[0]?.message ?? 'Invalid source row.';
        throw new Error(`Row ${row}: ${issue}`);
    }
    return {
        row,
        url: parsed.data.url,
        name: parsed.data.name,
        collectionNames: collections(parsed.data.collection, row),
    };
}

function parseCsv(input: string): ParsedSourceImportRow[] {
    const rows = csvRows(input.replace(/^\uFEFF/, ''));
    const header = rows.shift()?.map((value) => value.trim().toLowerCase());
    if (!header?.includes('url')) throw new Error('The CSV file must include a url header.');
    const records = rows.map((values, index) => {
        const record = Object.fromEntries(header.map((key, column) => [key, values[column] ?? '']));
        return parseRecord(record, index + 2);
    });
    return records;
}

function parseJson(input: string): ParsedSourceImportRow[] {
    let value: unknown;
    try {
        value = JSON.parse(input.replace(/^\uFEFF/, ''));
    } catch {
        throw new Error('The JSON file is not valid JSON.');
    }
    if (!Array.isArray(value)) throw new Error('The JSON file must contain an array of source objects.');
    return value.map((record, index) => parseRecord(record, index + 1));
}

export function parseSourceImport(input: string, extension: string): ParsedSourceImportRow[] {
    const records = extension.toLowerCase() === '.json' ? parseJson(input) :
        extension.toLowerCase() === '.csv' ? parseCsv(input) :
            (() => {
                throw new Error('Select a .csv or .json source import file.');
            })();
    if (records.length === 0) throw new Error('The import file does not contain any source rows.');
    if (records.length > maximumImportRows) {
        throw new Error(`The import file exceeds the ${maximumImportRows}-source prototype limit.`);
    }
    return records;
}

function initialStatus(): SourceImportStatus {
    return {
        running: false,
        fileName: null,
        totalRows: 0,
        completedRows: 0,
        imported: 0,
        updated: 0,
        failed: 0,
        collectionsCreated: 0,
        startedAt: null,
        completedAt: null,
    };
}

export class SourceImportService {
    private status: SourceImportStatus = initialStatus();

    constructor(
        private readonly collectionStore: CollectionStore,
        private readonly sourceImporter: SourceImporter,
    ) {
    }

    getStatus(): SourceImportStatus {
        return {...this.status};
    }

    prepare(): void {
        if (this.status.running) throw new Error('A source import is already running.');
        this.status = initialStatus();
    }

    async importFile(filePath: string): Promise<SourceImportResult> {
        if (this.status.running) throw new Error('A source import is already running.');
        if (statSync(filePath).size > maximumImportBytes) {
            throw new Error('The import file exceeds the 5 MB prototype limit.');
        }
        const fileName = path.basename(filePath);
        const records = parseSourceImport(readFileSync(filePath, 'utf8'), path.extname(filePath));
        this.status = {
            ...initialStatus(),
            running: true,
            fileName,
            totalRows: records.length,
            startedAt: new Date().toISOString(),
        };

        const results: SourceImportRowResult[] = [];
        try {
            const existingCollections = await this.collectionStore.list();
            const collectionIds = new Map(
                existingCollections.map((collection) => [collection.name.trim().toLowerCase(), collection.id]),
            );
            const requestedNames = [...new Set(records.flatMap((record) => record.collectionNames))];
            for (const name of requestedNames) {
                const key = name.toLowerCase();
                if (collectionIds.has(key)) continue;
                const created = await this.collectionStore.create({name, icon: 'folder'});
                collectionIds.set(key, created.id);
                this.status.collectionsCreated += 1;
            }

            let cursor = 0;
            const worker = async (): Promise<void> => {
                while (cursor < records.length) {
                    const record = records[cursor++]!;
                    try {
                        const imported = await this.sourceImporter.importSource({
                            feedUrl: record.url,
                            name: record.name,
                            collectionIds: record.collectionNames.map((name) => collectionIds.get(name.toLowerCase())!),
                        });
                        const status = imported.created ? 'imported' : 'updated';
                        this.status[status] += 1;
                        results.push({
                            row: record.row,
                            url: record.url,
                            name: record.name ?? imported.source.name,
                            status,
                            sourceId: imported.source.id,
                            errorMessage: null,
                        });
                    } catch (error) {
                        this.status.failed += 1;
                        results.push({
                            row: record.row,
                            url: record.url,
                            name: record.name ?? null,
                            status: 'failed',
                            sourceId: null,
                            errorMessage: error instanceof Error ? error.message : 'Unexpected import failure.',
                        });
                    } finally {
                        this.status.completedRows += 1;
                    }
                }
            };
            await Promise.all(
                Array.from({length: Math.min(importConcurrency, records.length)}, () => worker()),
            );
        } finally {
            this.status.running = false;
            this.status.completedAt = new Date().toISOString();
        }

        return {
            canceled: false,
            fileName,
            totalRows: records.length,
            imported: this.status.imported,
            updated: this.status.updated,
            failed: this.status.failed,
            collectionsCreated: this.status.collectionsCreated,
            results: results.sort((left, right) => left.row - right.row),
        };
    }
}
