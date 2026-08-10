import type {
    Collection,
    CreateCollectionInput,
    CreateSourceInput,
    Source,
    UpdateCollectionRequest,
    UpdateSourceRequest,
} from '@rss-reader/contracts';
import type {Selectable, Transaction} from 'kysely';
import {sql} from 'kysely';
import type {
    CollectionsTable,
    Database,
    DatabaseSchema,
    SourcesTable,
} from './database';

type DatabaseExecutor = Database | Transaction<DatabaseSchema>;

function toIsoString(value: Date | string): string {
    return new Date(value).toISOString();
}

export function normalizeFeedUrl(value: string): string {
    const url = new URL(value.trim());

    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Feed URL must use HTTP or HTTPS.');
    }

    if (url.username || url.password) {
        throw new Error('Feed URL must not contain credentials.');
    }

    url.hash = '';
    return url.toString();
}

function defaultSourceName(feedUrl: string): string {
    return new URL(feedUrl).hostname.replace(/^www\./, '').slice(0, 200);
}

function sourceToDto(
    row: Selectable<SourcesTable>,
    collectionIds: string[],
): Source {
    return {
        id: row.id,
        name: row.name,
        feedUrl: row.feed_url,
        siteUrl: row.site_url,
        description: row.description,
        enabled: row.enabled,
        lastFetchedAt: row.last_fetched_at
            ? toIsoString(row.last_fetched_at)
            : null,
        collectionIds,
        createdAt: toIsoString(row.created_at),
        updatedAt: toIsoString(row.updated_at),
    };
}

function collectionToDto(
    row: Selectable<CollectionsTable> & { source_count: number | string },
): Collection {
    return {
        id: row.id,
        name: row.name,
        icon: row.icon as Collection['icon'],
        sourceCount: Number(row.source_count),
        createdAt: toIsoString(row.created_at),
        updatedAt: toIsoString(row.updated_at),
    };
}

async function membershipMap(
    executor: DatabaseExecutor,
    sourceIds?: string[],
): Promise<Map<string, string[]>> {
    let query = executor
        .selectFrom('collection_sources')
        .select(['source_id', 'collection_id']);

    if (sourceIds) {
        query = query.where('source_id', 'in', sourceIds);
    }

    const rows = sourceIds?.length === 0 ? [] : await query.execute();
    const memberships = new Map<string, string[]>();

    for (const row of rows) {
        const current = memberships.get(row.source_id) ?? [];
        current.push(row.collection_id);
        memberships.set(row.source_id, current);
    }

    return memberships;
}

async function replaceMemberships(
    transaction: Transaction<DatabaseSchema>,
    sourceId: string,
    collectionIds: string[],
): Promise<void> {
    await transaction
        .deleteFrom('collection_sources')
        .where('source_id', '=', sourceId)
        .execute();

    const uniqueCollectionIds = [...new Set(collectionIds)];
    if (uniqueCollectionIds.length > 0) {
        await transaction
            .insertInto('collection_sources')
            .values(
                uniqueCollectionIds.map((collectionId) => ({
                    collection_id: collectionId,
                    source_id: sourceId,
                })),
            )
            .execute();
    }
}

function rethrowFriendlyDatabaseError(error: unknown): never {
    if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
    ) {
        throw new Error('A source with this feed URL already exists.');
    }

    if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23503'
    ) {
        throw new Error('A selected source or collection no longer exists.');
    }

    throw error;
}

export class SourcesRepository {
    constructor(private readonly database: Database) {
    }

    async list(): Promise<Source[]> {
        const rows = await this.database
            .selectFrom('sources')
            .selectAll()
            .orderBy('name')
            .orderBy('created_at')
            .execute();
        const memberships = await membershipMap(
            this.database,
            rows.map((row) => row.id),
        );

        return rows.map((row) => sourceToDto(row, memberships.get(row.id) ?? []));
    }

    async get(id: string): Promise<Source> {
        const row = await this.database
            .selectFrom('sources')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        if (!row) throw new Error('Source not found.');
        const memberships = await membershipMap(this.database, [id]);
        return sourceToDto(row, memberships.get(id) ?? []);
    }

    async findByFeedUrl(feedUrl: string): Promise<Source | undefined> {
        const normalized = normalizeFeedUrl(feedUrl);
        const row = await this.database
            .selectFrom('sources')
            .selectAll()
            .where('feed_url', '=', normalized)
            .executeTakeFirst();
        if (!row) return undefined;
        const memberships = await membershipMap(this.database, [row.id]);
        return sourceToDto(row, memberships.get(row.id) ?? []);
    }

    async create(input: CreateSourceInput): Promise<Source> {
        const feedUrl = normalizeFeedUrl(input.feedUrl);

        try {
            return await this.database.transaction().execute(async (transaction) => {
                const row = await transaction
                    .insertInto('sources')
                    .values({
                        name: input.name?.trim() || defaultSourceName(feedUrl),
                        feed_url: feedUrl,
                        site_url: null,
                        description: null,
                        etag: null,
                        last_modified: null,
                        last_fetched_at: null,
                    })
                    .returningAll()
                    .executeTakeFirstOrThrow();
                await replaceMemberships(transaction, row.id, input.collectionIds);
                return sourceToDto(row, [...new Set(input.collectionIds)]);
            });
        } catch (error) {
            rethrowFriendlyDatabaseError(error);
        }
    }

    async update(request: UpdateSourceRequest): Promise<Source> {
        const feedUrl = normalizeFeedUrl(request.input.feedUrl);

        try {
            return await this.database.transaction().execute(async (transaction) => {
                const existing = await transaction
                    .selectFrom('sources')
                    .select(['feed_url', 'etag', 'last_modified'])
                    .where('id', '=', request.id)
                    .executeTakeFirst();
                if (!existing) throw new Error('Source not found.');
                const feedUrlChanged = existing.feed_url !== feedUrl;
                const row = await transaction
                    .updateTable('sources')
                    .set({
                        name: request.input.name.trim(),
                        feed_url: feedUrl,
                        enabled: request.input.enabled,
                        etag: feedUrlChanged ? null : existing.etag,
                        last_modified: feedUrlChanged ? null : existing.last_modified,
                        updated_at: sql`now()`,
                    })
                    .where('id', '=', request.id)
                    .returningAll()
                    .executeTakeFirst();

                if (!row) throw new Error('Source not found.');
                await replaceMemberships(
                    transaction,
                    request.id,
                    request.input.collectionIds,
                );
                return sourceToDto(row, [...new Set(request.input.collectionIds)]);
            });
        } catch (error) {
            rethrowFriendlyDatabaseError(error);
        }
    }

    async delete(id: string): Promise<void> {
        const result = await this.database
            .deleteFrom('sources')
            .where('id', '=', id)
            .executeTakeFirst();
        if (Number(result.numDeletedRows) === 0) throw new Error('Source not found.');
    }

    async deleteMany(ids: readonly string[]): Promise<void> {
        const uniqueIds = [...new Set(ids)];
        if (uniqueIds.length === 0) throw new Error('Select at least one source to delete.');
        await this.database.transaction().execute(async (transaction) => {
            const existing = await transaction
                .selectFrom('sources')
                .select('id')
                .where('id', 'in', uniqueIds)
                .execute();
            if (existing.length !== uniqueIds.length) throw new Error('One or more selected sources no longer exist.');
            await transaction.deleteFrom('sources').where('id', 'in', uniqueIds).execute();
        });
    }
}

export class CollectionsRepository {
    constructor(private readonly database: Database) {
    }

    async list(): Promise<Collection[]> {
        const rows = await this.database
            .selectFrom('collections')
            .leftJoin(
                'collection_sources',
                'collection_sources.collection_id',
                'collections.id',
            )
            .select([
                'collections.id',
                'collections.name',
                'collections.icon',
                'collections.created_at',
                'collections.updated_at',
                sql<number>`count(collection_sources.source_id)::integer`.as(
                    'source_count',
                ),
            ])
            .groupBy('collections.id')
            .orderBy('collections.name')
            .execute();

        return rows.map(collectionToDto);
    }

    async create(input: CreateCollectionInput): Promise<Collection> {
        const row = await this.database
            .insertInto('collections')
            .values({name: input.name.trim(), icon: input.icon})
            .returningAll()
            .executeTakeFirstOrThrow();
        return collectionToDto({...row, source_count: 0});
    }

    async update(request: UpdateCollectionRequest): Promise<Collection> {
        const sourceIds = [...new Set(request.input.sourceIds)];

        try {
            return await this.database.transaction().execute(async (transaction) => {
                const row = await transaction
                    .updateTable('collections')
                    .set({name: request.input.name.trim(), icon: request.input.icon, updated_at: sql`now()`})
                    .where('id', '=', request.id)
                    .returningAll()
                    .executeTakeFirst();

                if (!row) throw new Error('Collection not found.');

                await transaction
                    .deleteFrom('collection_sources')
                    .where('collection_id', '=', request.id)
                    .execute();

                if (sourceIds.length > 0) {
                    await transaction
                        .insertInto('collection_sources')
                        .values(sourceIds.map((sourceId) => ({
                            collection_id: request.id,
                            source_id: sourceId,
                        })))
                        .execute();
                }

                return collectionToDto({...row, source_count: sourceIds.length});
            });
        } catch (error) {
            rethrowFriendlyDatabaseError(error);
        }
    }

    async delete(id: string): Promise<void> {
        const result = await this.database
            .deleteFrom('collections')
            .where('id', '=', id)
            .executeTakeFirst();
        if (Number(result.numDeletedRows) === 0)
            throw new Error('Collection not found.');
    }

    async addSource(collectionId: string, sourceId: string): Promise<void> {
        try {
            await this.database
                .insertInto('collection_sources')
                .values({collection_id: collectionId, source_id: sourceId})
                .onConflict((conflict) => conflict.doNothing())
                .execute();
        } catch (error) {
            rethrowFriendlyDatabaseError(error);
        }
    }

    async removeSource(collectionId: string, sourceId: string): Promise<void> {
        await this.database
            .deleteFrom('collection_sources')
            .where('collection_id', '=', collectionId)
            .where('source_id', '=', sourceId)
            .execute();
    }
}
