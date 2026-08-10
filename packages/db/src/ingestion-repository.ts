import type {
    CreateSourceInput,
    FetchErrorCategory,
    UpdateSourceRequest,
} from '@rss-reader/contracts';
import type {
    NormalizedFeed,
    NormalizedFeedItem,
    ResolvedFeed,
} from '@rss-reader/feeds';
import {selectInitialFeedItems} from '@rss-reader/feeds';
import type {Selectable, Transaction} from 'kysely';
import type {
    Database,
    DatabaseSchema,
    ItemsTable,
    SourcesTable,
} from './database';

export interface FetchableSource {
    id: string;
    name: string;
    feedUrl: string;
    etag: string | null;
    lastModified: string | null;
    lastFetchedAt: string | null;
}

export interface FetchRunStart {
    id: string;
    startedAt: string;
}

export interface FeedPersistenceResult {
    sourceName: string;
    completedAt: string;
    itemsReceived: number;
    itemsInserted: number;
    itemsUpdated: number;
    itemsSkipped: number;
}

export interface InitialFeedPersistenceResult extends FeedPersistenceResult {
    sourceId: string;
    startedAt: string;
    httpStatus: number;
}

export interface FeedResponseMetadata {
    httpStatus: number;
    etag: string | null;
    lastModified: string | null;
}

function iso(value: Date | string): string {
    return new Date(value).toISOString();
}

function sourceToFetchable(row: Selectable<SourcesTable>): FetchableSource {
    return {
        id: row.id,
        name: row.name,
        feedUrl: row.feed_url,
        etag: row.etag,
        lastModified: row.last_modified,
        lastFetchedAt: row.last_fetched_at ? iso(row.last_fetched_at) : null,
    };
}

function storedDate(value: Date | string | null): string | null {
    return value ? iso(value) : null;
}

function itemChanged(
    stored: Pick<
        Selectable<ItemsTable>,
        | 'canonical_url'
        | 'title'
        | 'author'
        | 'published_at'
        | 'source_updated_at'
        | 'summary'
        | 'feed_content_html'
    >,
    incoming: NormalizedFeedItem,
): boolean {
    return (
        stored.canonical_url !== incoming.canonicalUrl ||
        stored.title !== incoming.title ||
        stored.author !== incoming.author ||
        storedDate(stored.published_at) !== incoming.publishedAt ||
        storedDate(stored.source_updated_at) !== incoming.sourceUpdatedAt ||
        stored.summary !== incoming.summary ||
        stored.feed_content_html !== incoming.contentHtml
    );
}

async function upsertItems(
    transaction: Transaction<DatabaseSchema>,
    sourceId: string,
    items: NormalizedFeedItem[],
    observedAt: Date,
): Promise<{ inserted: number; updated: number }> {
    if (items.length === 0) return {inserted: 0, updated: 0};

    const existingRows = await transaction
        .selectFrom('items')
        .select([
            'external_id',
            'canonical_url',
            'title',
            'author',
            'published_at',
            'source_updated_at',
            'summary',
            'feed_content_html',
        ])
        .where('source_id', '=', sourceId)
        .where(
            'external_id',
            'in',
            items.map((item) => item.externalId),
        )
        .execute();
    const existingByIdentity = new Map(
        existingRows.map((item) => [item.external_id, item]),
    );

    let inserted = 0;
    let updated = 0;

    for (const item of items) {
        const existing = existingByIdentity.get(item.externalId);
        if (!existing) {
            await transaction
                .insertInto('items')
                .values({
                    source_id: sourceId,
                    external_id: item.externalId,
                    canonical_url: item.canonicalUrl,
                    title: item.title,
                    author: item.author,
                    published_at: item.publishedAt,
                    source_updated_at: item.sourceUpdatedAt,
                    summary: item.summary,
                    feed_content_html: item.contentHtml,
                    first_seen_at: observedAt,
                    last_seen_at: observedAt,
                    read_at: null,
                    created_at: observedAt,
                    updated_at: observedAt,
                })
                .execute();
            inserted += 1;
            continue;
        }

        const changed = itemChanged(existing, item);
        await transaction
            .updateTable('items')
            .set({
                canonical_url: item.canonicalUrl,
                title: item.title,
                author: item.author,
                published_at: item.publishedAt,
                source_updated_at: item.sourceUpdatedAt,
                summary: item.summary,
                feed_content_html: item.contentHtml,
                last_seen_at: observedAt,
                ...(changed ? {updated_at: observedAt} : {}),
            })
            .where('source_id', '=', sourceId)
            .where('external_id', '=', item.externalId)
            .execute();
        if (changed) updated += 1;
    }

    return {inserted, updated};
}

async function persistInitialItems(
    transaction: Transaction<DatabaseSchema>,
    sourceId: string,
    items: NormalizedFeedItem[],
    observedAt: Date,
): Promise<{inserted: number; updated: number; skipped: number}> {
    const settings = await transaction
        .selectFrom('application_settings')
        .select('initial_article_limit')
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
    const selection = selectInitialFeedItems(items, settings.initial_article_limit);

    if (selection.skipped.length > 0) {
        await transaction
            .insertInto('initial_item_suppressions')
            .values(selection.skipped.map((item) => ({
                source_id: sourceId,
                external_id: item.externalId,
                created_at: observedAt,
            })))
            .onConflict((conflict) => conflict.doNothing())
            .execute();
    }

    const counts = await upsertItems(transaction, sourceId, selection.imported, observedAt);
    return {...counts, skipped: selection.skipped.length};
}

async function upsertUnsuppressedItems(
    transaction: Transaction<DatabaseSchema>,
    sourceId: string,
    items: NormalizedFeedItem[],
    observedAt: Date,
): Promise<{inserted: number; updated: number; skipped: number}> {
    if (items.length === 0) return {inserted: 0, updated: 0, skipped: 0};
    const suppressions = await transaction
        .selectFrom('initial_item_suppressions')
        .select('external_id')
        .where('source_id', '=', sourceId)
        .where('external_id', 'in', items.map((item) => item.externalId))
        .execute();
    const suppressedIds = new Set(suppressions.map(({external_id}) => external_id));
    const accepted = items.filter((item) => !suppressedIds.has(item.externalId));
    const counts = await upsertItems(transaction, sourceId, accepted, observedAt);
    return {...counts, skipped: items.length - accepted.length};
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
    const uniqueIds = [...new Set(collectionIds)];
    if (uniqueIds.length > 0) {
        await transaction
            .insertInto('collection_sources')
            .values(uniqueIds.map((collectionId) => ({
                source_id: sourceId,
                collection_id: collectionId,
            })))
            .execute();
    }
}

function initialSourceName(resolved: ResolvedFeed): string {
    return (
        resolved.feed.title?.trim().slice(0, 200) ||
        new URL(resolved.siteUrl ?? resolved.feedUrl).hostname
            .replace(/^www\./, '')
            .slice(0, 200)
    );
}

function friendlyPersistenceError(error: unknown): never {
    if (typeof error === 'object' && error !== null && 'code' in error) {
        if (error.code === '23505') {
            throw new Error('A source with this confirmed feed URL already exists.');
        }
        if (error.code === '23503') {
            throw new Error('A selected collection no longer exists.');
        }
    }
    throw error;
}

export class IngestionRepository {
    constructor(private readonly database: Database) {
    }

    async getSource(id: string): Promise<FetchableSource> {
        const row = await this.database
            .selectFrom('sources')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();
        if (!row) throw new Error('Source not found.');
        return sourceToFetchable(row);
    }

    async listEnabledSources(): Promise<FetchableSource[]> {
        const rows = await this.database
            .selectFrom('sources')
            .selectAll()
            .where('enabled', '=', true)
            .orderBy('name')
            .execute();
        return rows.map(sourceToFetchable);
    }

    async createResolvedSource(
        input: CreateSourceInput,
        resolved: ResolvedFeed,
    ): Promise<InitialFeedPersistenceResult> {
        try {
            return await this.database.transaction().execute(async (transaction) => {
                const observedAt = new Date();
                const source = await transaction
                    .insertInto('sources')
                    .values({
                        name: input.name?.trim() || initialSourceName(resolved),
                        feed_url: resolved.feedUrl,
                        site_url: resolved.siteUrl,
                        description: resolved.feed.description,
                        etag: resolved.response.etag,
                        last_modified: resolved.response.lastModified,
                        last_fetched_at: observedAt,
                        created_at: observedAt,
                        updated_at: observedAt,
                    })
                    .returningAll()
                    .executeTakeFirstOrThrow();
                await replaceMemberships(transaction, source.id, input.collectionIds);
                const counts = await persistInitialItems(
                    transaction,
                    source.id,
                    resolved.feed.items,
                    observedAt,
                );
                await transaction
                    .insertInto('fetch_runs')
                    .values({
                        source_id: source.id,
                        started_at: observedAt,
                        completed_at: observedAt,
                        status: 'success',
                        http_status: resolved.response.httpStatus,
                        items_received: resolved.feed.items.length,
                        items_inserted: counts.inserted,
                        items_updated: counts.updated,
                        items_skipped: counts.skipped,
                        error_category: null,
                        error_message: null,
                    })
                    .execute();
                return {
                    sourceId: source.id,
                    sourceName: source.name,
                    startedAt: observedAt.toISOString(),
                    completedAt: observedAt.toISOString(),
                    httpStatus: resolved.response.httpStatus,
                    itemsReceived: resolved.feed.items.length,
                    itemsInserted: counts.inserted,
                    itemsUpdated: counts.updated,
                    itemsSkipped: counts.skipped,
                };
            });
        } catch (error) {
            friendlyPersistenceError(error);
        }
    }

    async replaceResolvedSource(
        request: UpdateSourceRequest,
        resolved: ResolvedFeed,
    ): Promise<InitialFeedPersistenceResult> {
        try {
            return await this.database.transaction().execute(async (transaction) => {
                const observedAt = new Date();
                const existing = await transaction
                    .selectFrom('sources')
                    .selectAll()
                    .where('id', '=', request.id)
                    .forUpdate()
                    .executeTakeFirst();
                if (!existing) throw new Error('Source not found.');
                await transaction
                    .updateTable('sources')
                    .set({
                        name: request.input.name.trim(),
                        feed_url: resolved.feedUrl,
                        site_url: resolved.siteUrl,
                        description: resolved.feed.description,
                        enabled: request.input.enabled,
                        etag: resolved.response.etag,
                        last_modified: resolved.response.lastModified,
                        last_fetched_at: observedAt,
                        updated_at: observedAt,
                    })
                    .where('id', '=', request.id)
                    .execute();
                await replaceMemberships(
                    transaction,
                    request.id,
                    request.input.collectionIds,
                );
                await transaction
                    .deleteFrom('initial_item_suppressions')
                    .where('source_id', '=', request.id)
                    .execute();
                const counts = await persistInitialItems(
                    transaction,
                    request.id,
                    resolved.feed.items,
                    observedAt,
                );
                await transaction
                    .insertInto('fetch_runs')
                    .values({
                        source_id: request.id,
                        started_at: observedAt,
                        completed_at: observedAt,
                        status: 'success',
                        http_status: resolved.response.httpStatus,
                        items_received: resolved.feed.items.length,
                        items_inserted: counts.inserted,
                        items_updated: counts.updated,
                        items_skipped: counts.skipped,
                        error_category: null,
                        error_message: null,
                    })
                    .execute();
                return {
                    sourceId: request.id,
                    sourceName: request.input.name.trim(),
                    startedAt: observedAt.toISOString(),
                    completedAt: observedAt.toISOString(),
                    httpStatus: resolved.response.httpStatus,
                    itemsReceived: resolved.feed.items.length,
                    itemsInserted: counts.inserted,
                    itemsUpdated: counts.updated,
                    itemsSkipped: counts.skipped,
                };
            });
        } catch (error) {
            friendlyPersistenceError(error);
        }
    }

    async startRun(sourceId: string): Promise<FetchRunStart> {
        const row = await this.database
            .insertInto('fetch_runs')
            .values({
                source_id: sourceId,
                status: 'fetching',
                completed_at: null,
                http_status: null,
                error_category: null,
                error_message: null,
            })
            .returning(['id', 'started_at'])
            .executeTakeFirstOrThrow();
        return {id: row.id, startedAt: iso(row.started_at)};
    }

    async completeFeed(
        runId: string,
        sourceId: string,
        feed: NormalizedFeed,
        metadata: FeedResponseMetadata,
    ): Promise<FeedPersistenceResult> {
        return this.database.transaction().execute(async (transaction) => {
            const source = await transaction
                .selectFrom('sources')
                .selectAll()
                .where('id', '=', sourceId)
                .forUpdate()
                .executeTakeFirst();
            if (!source) throw new Error('Source not found.');

            const completedAt = new Date();
            const itemCounts = source.last_fetched_at === null
                ? await persistInitialItems(transaction, sourceId, feed.items, completedAt)
                : await upsertUnsuppressedItems(transaction, sourceId, feed.items, completedAt);
            const sourceName =
                source.last_fetched_at === null && feed.title
                    ? feed.title.slice(0, 200)
                    : source.name;

            await transaction
                .updateTable('sources')
                .set({
                    name: sourceName,
                    site_url: feed.siteUrl ?? source.site_url,
                    description: feed.description ?? source.description,
                    etag: metadata.etag,
                    last_modified: metadata.lastModified,
                    last_fetched_at: completedAt,
                    updated_at: completedAt,
                })
                .where('id', '=', sourceId)
                .execute();

            await transaction
                .updateTable('fetch_runs')
                .set({
                    status: 'success',
                    completed_at: completedAt,
                    http_status: metadata.httpStatus,
                    items_received: feed.items.length,
                    items_inserted: itemCounts.inserted,
                    items_updated: itemCounts.updated,
                    items_skipped: itemCounts.skipped,
                    error_category: null,
                    error_message: null,
                })
                .where('id', '=', runId)
                .execute();

            return {
                sourceName,
                completedAt: completedAt.toISOString(),
                itemsReceived: feed.items.length,
                itemsInserted: itemCounts.inserted,
                itemsUpdated: itemCounts.updated,
                itemsSkipped: itemCounts.skipped,
            };
        });
    }

    async completeNotModified(
        runId: string,
        sourceId: string,
        metadata: FeedResponseMetadata,
    ): Promise<{ sourceName: string; completedAt: string }> {
        return this.database.transaction().execute(async (transaction) => {
            const source = await transaction
                .selectFrom('sources')
                .selectAll()
                .where('id', '=', sourceId)
                .forUpdate()
                .executeTakeFirst();
            if (!source) throw new Error('Source not found.');
            const completedAt = new Date();

            await transaction
                .updateTable('sources')
                .set({
                    etag: metadata.etag ?? source.etag,
                    last_modified: metadata.lastModified ?? source.last_modified,
                    last_fetched_at: completedAt,
                    updated_at: completedAt,
                })
                .where('id', '=', sourceId)
                .execute();
            await transaction
                .updateTable('fetch_runs')
                .set({
                    status: 'unchanged',
                    completed_at: completedAt,
                    http_status: metadata.httpStatus,
                })
                .where('id', '=', runId)
                .execute();

            return {sourceName: source.name, completedAt: completedAt.toISOString()};
        });
    }

    async failRun(
        runId: string,
        category: FetchErrorCategory,
        message: string,
        httpStatus: number | null,
    ): Promise<string> {
        const completedAt = new Date();
        await this.database
            .updateTable('fetch_runs')
            .set({
                status: 'failed',
                completed_at: completedAt,
                http_status: httpStatus,
                error_category: category,
                error_message: message,
            })
            .where('id', '=', runId)
            .execute();
        return completedAt.toISOString();
    }
}
